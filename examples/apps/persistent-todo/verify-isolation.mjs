// Local test harnesses read development process settings and await values directly in assertions.
/* eslint-disable unicorn/no-await-expression-member, no-restricted-properties */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { issueStorageToken } from "@tailorkit/app-storage/auth";
import { inspectIsolated } from "../../../apps/apps-cloud/src/inspect.ts";
import { wranglerBinary } from "@tailorkit/apps-cloud/tooling";

const root = import.meta.dirname;
const temporary = await mkdtemp(path.join(tmpdir(), "tailorkit-isolation-"));
const runtime = path.join(temporary, "runtime");
const state = path.join(temporary, "state");
await mkdir(state);
await mkdir(runtime);
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const config = JSON.parse(
  await readFile(path.join(root, ".tailorkit-storage/wrangler.json"), "utf-8"),
);
const privateKey = JSON.parse(
  await readFile(path.join(root, ".tailorkit-storage/dev-host-key.json"), "utf-8"),
);
const packageEntry = path.resolve(root, "../../../apps/apps-cloud/src/worker.ts");
let child;
let logs = "";
async function bundle(version) {
  // Deliberately adversarial code may bypass the app API; it must still be trapped in its installation.
  const code = `import { DurableObject, env } from "cloudflare:workers";
let globals = 0;
export class AppFacet extends DurableObject {
  async fetch(request) {
    if (new URL(request.url).pathname.endsWith("/stream")) {
      let timer;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("open")); timer = setInterval(() => controller.enqueue(new TextEncoder().encode("tick")), 100); }, cancel() { clearInterval(timer); } }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    }
    let networkBlocked = false;
    try { await fetch("https://example.com"); } catch { networkBlocked = true; }
    const writes = (this.ctx.storage.kv.get("writes") || 0) + 1;
    this.ctx.storage.kv.put("writes", writes);
    return Response.json({ globals: ++globals, writes, networkBlocked, bindings: Object.keys(env),
      parentVersion: this.ctx.storage.kv.get("codeHash") || null,
      token: request.headers.get("authorization"), identity: JSON.parse(request.headers.get("x-tailorkit-identity")), version: ${version} });
  }
}`;
  const artifact = {
    code,
    codeHash: createHash("sha256").update(code).digest("hex"),
    apiVersion: 1,
    migrations: [],
  };
  await writeFile(
    path.join(temporary, "entry.ts"),
    `import { Effect } from ${JSON.stringify(createRequire(path.resolve(root, "../../../apps/apps-cloud/package.json")).resolve("effect"))};
import { createStorageDurableObject, createStorageWorker } from ${JSON.stringify(packageEntry)};
const artifact = ${JSON.stringify(artifact)};
export class AppStorage extends createStorageDurableObject(() => ({ get: () => Effect.succeed(artifact) }), true) {}
export default createStorageWorker(artifact);`,
  );
  await build({
    configFile: false,
    root,
    logLevel: "error",
    ssr: { target: "webworker", noExternal: true },
    build: {
      ssr: path.join(temporary, "entry.ts"),
      outDir: runtime,
      emptyOutDir: true,
      target: "esnext",
      minify: false,
      rollupOptions: { external: ["cloudflare:workers"], output: { entryFileNames: "worker.js" } },
    },
  });
  await writeFile(
    path.join(temporary, "wrangler.json"),
    JSON.stringify({
      ...config,
      name: "tailorkit-isolation-check",
      main: "runtime/worker.js",
      alias: {},
    }),
  );
}
async function start() {
  child = spawn(
    process.execPath,
    [
      wranglerBinary(),
      "dev",
      "--local",
      "--config",
      path.join(temporary, "wrangler.json"),
      "--persist-to",
      state,
      "--port",
      String(port),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: path.join(temporary, "wrangler.log"),
      },
    },
  );
  child.stdout.on("data", (data) => {
    logs = (logs + String(data)).slice(-4000);
  });
  child.stderr.on("data", (data) => {
    logs = (logs + String(data)).slice(-4000);
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(logs);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${port}/_tailorkit/storage`)).ok) {
        return;
      }
    } catch {
      /* Wait for the local runtime listener. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Runtime start timeout: ${logs}`);
}
async function stop() {
  if (!child || child.exitCode !== null) {
    return;
  }
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await ended;
}
async function invoke(installationId) {
  const { token } = await issueStorageToken(
    {
      issuer: config.vars.STORAGE_ISSUER,
      audience: config.vars.STORAGE_AUDIENCE,
      privateKey,
      keyId: "local-dev",
    },
    { appId: config.vars.STORAGE_APP_ID, installationId, userId: "verified-user" },
  );
  const response = await fetch(`http://127.0.0.1:${port}/rpc/probe`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-tailorkit-identity": JSON.stringify({ installationId: "forged" }),
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
try {
  const inspectCode = path.join(temporary, "inspect.js");
  await writeFile(
    inspectCode,
    `globalThis.__tailorkitInspectLeak = true;
let blocked = false; try { await fetch("https://example.com"); } catch { blocked = true; }
if (!blocked) throw new Error("Network was not disabled");
export default { fetch: () => Response.json({ schema: {}, functions: {}, apiVersion: 1 }) };`,
  );
  assert.equal((await inspectIsolated(inspectCode)).apiVersion, 1);
  assert.equal(globalThis.__tailorkitInspectLeak, undefined);
  await bundle(1);
  await start();
  const first = await invoke("first");
  assert.equal(first.globals, 1);
  assert.equal(first.writes, 1);
  assert.equal(first.networkBlocked, true);
  assert.deepEqual(first.bindings, []);
  assert.equal(first.parentVersion, null);
  assert.equal(first.token, null);
  assert.equal(first.identity.installationId, "first");
  assert.equal(first.identity.userId, "verified-user");
  const second = await invoke("second");
  assert.equal(second.globals, 1); // Even module globals cannot communicate between installations.
  assert.equal(second.writes, 1);
  assert.equal((await invoke("first")).writes, 2);
  const { token: expiringToken } = await issueStorageToken(
    {
      issuer: config.vars.STORAGE_ISSUER,
      audience: config.vars.STORAGE_AUDIENCE,
      privateKey,
      keyId: "local-dev",
      lifetimeSeconds: 2,
    },
    { appId: config.vars.STORAGE_APP_ID, installationId: "first", userId: "verified-user" },
  );
  const started = Date.now();
  const stream = await fetch(`http://127.0.0.1:${port}/rpc/stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${expiringToken}` },
    signal: AbortSignal.timeout(5000),
  });
  const reader = stream.body.getReader();
  let text = new TextDecoder().decode((await reader.read()).value);
  assert.ok(text.startsWith("open"));
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      text += new TextDecoder().decode(chunk.value);
    }
  } catch (error) {
    assert.notEqual(error.name, "TimeoutError");
  }
  // Transport buffers may coalesce chunks; check messages rather than packet boundaries.
  assert.ok(
    (text.match(/tick/gu) ?? []).length > 2,
    "Adversarial stream remained active before expiry",
  );
  assert.ok(Date.now() - started < 3000, "Supervisor terminates unauthenticated streams");
  await stop();
  await bundle(2);
  await start();
  const updated = await invoke("first");
  assert.equal(updated.version, 2);
  assert.equal(updated.globals, 1);
  assert.equal(updated.writes, 3); // Stable facet database survives a code update.
  console.log(
    "PASS: isolated build inspection, blocked egress, empty bindings, stripped JWT, verified identity, separate globals/storage, enforced stream expiry, and persistent facets across code updates.",
  );
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
