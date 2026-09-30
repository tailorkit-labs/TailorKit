// Local test harnesses read development process settings and await values directly in assertions.
/* eslint-disable unicorn/no-await-expression-member, no-restricted-properties */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStorageClient, functionReference } from "@tailorkit/app-storage";
import { issueStorageToken, issueStorageMigrationToken } from "@tailorkit/app-storage/auth";
import { storageTool } from "@tailorkit/app-storage/tooling";

// Runs only local workerd, with a disposable state directory separate from the demo's data.
const provider = process.argv.includes("--docker") ? "docker" : "cloudflare";
const containerName = `tailorkit-verify-${crypto.randomUUID()}`;
const root = import.meta.dirname;
const privateKey = JSON.parse(
  await readFile(path.join(root, ".tailorkit-storage/dev-host-key.json"), "utf-8"),
);
const state = await mkdtemp(path.join(tmpdir(), "tailorkit-storage-check-"));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const url = `http://127.0.0.1:${port}/rpc`;
const list = functionReference("list", "query", 1);
const add = functionReference("add", "mutation", 1);
const toggle = functionReference("toggle", "mutation", 1);
let child;
let logs = "";
const stops = [];
const wait = async (predicate, label) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}\n${logs.slice(-3000)}`);
};
async function start() {
  child =
    provider === "docker"
      ? spawn(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            containerName,
            "--user",
            `${process.getuid()}:${process.getgid()}`,
            "--read-only",
            "--tmpfs",
            "/tmp:rw,size=16m",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--memory=256m",
            "--cpus=1",
            "--pids-limit=64",
            "-p",
            `127.0.0.1:${port}:8787`,
            "-v",
            `${path.join(root, ".tailorkit-storage/docker")}:/app:ro`,
            "-v",
            `${state}:/data`,
            "tailorkit-storage:local",
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        )
      : spawn(
          process.execPath,
          [
            storageTool("wrangler"),
            "dev",
            path.resolve(root, "../../../apps/app-storage-cloud/src/index.ts"),
            "--local",
            "--config",
            path.join(root, ".tailorkit-storage/wrangler.json"),
            "--persist-to",
            state,
            "--port",
            String(port),
          ],
          {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              WRANGLER_SEND_METRICS: "false",
              WRANGLER_LOG_PATH: path.join(state, "wrangler.log"),
            },
          },
        );
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  await wait(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited: ${logs.slice(-3000)}`);
    }
    try {
      return (
        await fetch(`http://127.0.0.1:${port}/_tailorkit/storage`, {
          signal: AbortSignal.timeout(500),
        })
      ).ok;
    } catch {
      return false;
    }
  }, "Wrangler startup");
}
async function stopRuntime() {
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (provider === "docker") {
    const stopper = spawn("docker", ["stop", "--time=2", containerName], { stdio: "ignore" });
    await new Promise((resolve) => stopper.once("exit", resolve));
  } else {
    child.kill("SIGTERM");
  }
  await exited;
}
function client(installationId, lifetimeSeconds = 120, overrides = {}) {
  let sessions = 0;
  const sdk = createStorageClient({
    retryDelayMs: 50,
    getSession: async () => {
      sessions++;
      return {
        ...(await issueStorageToken(
          {
            issuer: "http://localhost:5011",
            audience: "tailorkit-storage",
            privateKey,
            keyId: "local-dev",
            lifetimeSeconds,
            ...overrides,
          },
          {
            userId: "test-user",
            appId: "persistent-todo-demo",
            installationId,
          },
        )),
        url,
      };
    },
  });
  return { sdk, sessions: () => sessions };
}
try {
  await start();
  const first = client("shared", 3);
  const second = client("shared");
  const isolated = client("isolated");
  const firstValues = [];
  const manifest = JSON.parse(
    await readFile(path.join(root, ".tailorkit-storage/storage-manifest.json"), "utf-8"),
  );
  const body = JSON.stringify({
    codeHash: manifest.codeHash,
    apiVersion: manifest.apiVersion,
    migrations: manifest.migrations,
  });
  const migrate = async (installationId, ordinary = false, wrongBody = body) => {
    const signing = {
      issuer: "http://localhost:5011",
      audience: "tailorkit-storage",
      privateKey,
      keyId: "local-dev",
    };
    const { token } = await (ordinary ? issueStorageToken : issueStorageMigrationToken)(signing, {
      userId: "operator",
      appId: "persistent-todo-demo",
      installationId,
    });
    return fetch(`http://127.0.0.1:${port}/_tailorkit/migrate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: wrongBody,
    });
  };
  await assert.rejects(first.sdk.query(list, {}), { code: "INCOMPATIBLE_VERSION" });
  assert.equal((await migrate("shared", true)).status, 401);
  assert.equal(
    (await migrate("shared", false, JSON.stringify({ ...manifest, codeHash: "old" }))).status,
    409,
  );
  const cli = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@tailorkit/cli")),
      "storage",
      "migrate",
      "--installation",
      "shared",
      "--url",
      `http://127.0.0.1:${port}`,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let cliLogs = "";
  cli.stdout.on("data", (data) => {
    cliLogs += data;
  });
  cli.stderr.on("data", (data) => {
    cliLogs += data;
  });
  assert.equal(await new Promise((resolve) => cli.once("exit", resolve)), 0, cliLogs);
  const migrated = await migrate("shared");
  assert.equal(migrated.status, 200, await migrated.text());
  assert.equal((await migrate("isolated")).status, 200);
  assert.equal((await migrate("shared")).status, 200); // Replay migrations without changing data.
  const secondValues = [];
  stops.push(first.sdk.subscribe(list, {}, (value) => firstValues.push(value)));
  stops.push(second.sdk.subscribe(list, {}, (value) => secondValues.push(value)));
  await wait(() => firstValues.length && secondValues.length, "initial snapshots");
  assert.deepEqual(firstValues[0], []);
  assert.deepEqual(secondValues[0], []);
  const requestId = crypto.randomUUID();
  const accepted = await first.sdk.mutate(add, { text: "written once" }, { requestId });
  assert.deepEqual(await first.sdk.mutate(add, { text: "written once" }, { requestId }), accepted);
  await wait(
    () => firstValues.at(-1)?.length === 1 && secondValues.at(-1)?.length === 1,
    "two-client realtime invalidation",
  );
  await second.sdk.mutate(toggle, { id: accepted.id });
  await wait(
    () => firstValues.at(-1)?.[0]?.done && secondValues.at(-1)?.[0]?.done,
    "second-client mutation",
  );
  assert.deepEqual(await isolated.sdk.query(list, {}), []);
  await assert.rejects(first.sdk.mutate(add, { text: "different" }, { requestId }), {
    code: "CONFLICT",
  });
  await assert.rejects(
    client("shared", 120, { issuer: "https://untrusted-host.test" }).sdk.query(list, {}),
    { code: "UNAUTHORIZED" },
  );
  await assert.rejects(client("shared", 120, { audience: "wrong-audience" }).sdk.query(list, {}), {
    code: "UNAUTHORIZED",
  });
  await assert.rejects(first.sdk.query(functionReference("list", "query", 99), {}), {
    code: "INCOMPATIBLE_VERSION",
  });
  const previousSessions = first.sessions();
  const previousSnapshots = firstValues.length;
  await wait(
    () => first.sessions() > previousSessions && firstValues.length > previousSnapshots,
    "subscription token renewal",
  );
  const before = firstValues.length;
  await stopRuntime();
  await start();
  await wait(() => firstValues.length > before, "subscription reconnect after runtime restart");
  assert.equal(firstValues.at(-1)[0].done, true);
  assert.deepEqual(await first.sdk.mutate(add, { text: "written once" }, { requestId }), accepted);
  assert.equal((await second.sdk.query(list, {})).length, 1);
  console.log(
    `PASS (${provider}): facet SQLite, CLI migration gate and authorization, isolated installations, two clients, atomic receipts, JWT rejection, token renewal, persistence and reconnect after restart.`,
  );
} finally {
  for (const stop of stops) {
    stop();
  }
  await stopRuntime();
  await rm(state, { recursive: true, force: true });
}
