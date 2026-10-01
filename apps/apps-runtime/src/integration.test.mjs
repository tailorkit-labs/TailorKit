// Disposable local workerd/R2 test. No Cloudflare account or deployed resources are used.
/* eslint-disable unicorn/no-await-expression-member, no-restricted-properties */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { issueAppToken, APP_RUNTIME_AUDIENCE } from "@tailorkit/apps-server/auth";

import { createClient, reference } from "@tailorkit/apps-server/client";

import { it } from "vite-plus/test";

it("runs isolated app backends with persistent SQLite and two-client realtime updates", async () => {
  // Exercise precisely the workerd/Miniflare version bundled with this project's Wrangler.
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler"))(
    "miniflare",
  );
  const state = await mkdtemp(path.join(tmpdir(), "tailorkit-apps-runtime-"));
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const signing = {
    issuer: "https://platform.test/api/platform",
    audience: APP_RUNTIME_AUDIENCE,
    keyId: "test",
    privateKey: keys.privateKey,
  };
  const publicKeys = {
    keys: [{ ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "test" }],
  };
  let published;
  let externalCalls = 0;
  let releaseExternal;
  let pendingExternal;
  let metadataReads = 0;
  const options = {
    name: "tailorkit-runtime-test",
    modules: true,
    scriptPath: path.resolve(import.meta.dirname, "../dist/index.js"),
    compatibilityDate: "2026-09-21",
    workerLoaders: { LOADER: {} },
    durableObjects: { STORES: { className: "AppInstallation", useSQLite: true } },
    resourcePersistencePath: state,
    r2Buckets: { BUNDLES: "private-apps" },
    bindings: {
      PLATFORM_URL: "https://platform.test/api/platform",
      RUNTIME_SERVICE_TOKEN: "private-key",
    },
    outboundService: async (request) => {
      if (request.url.startsWith("https://third-party.test/")) {
        externalCalls++;
        assert.equal(request.headers.get("authorization"), null);
        if (request.url.endsWith("/redirect"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/private" },
          });
        if (request.url.endsWith("/slow")) await pendingExternal;
        return Response.json({ title: "Imported from external API" });
      }
      if (request.url === `${signing.issuer}/runtime/keys`) return Response.json(publicKeys);
      assert.equal(request.url, "https://platform.test/api/platform/apps/app/runtime");
      assert.equal(request.headers.get("authorization"), "Bearer private-key");
      metadataReads++;
      return Response.json({ body: published });
    },
  };
  let mf;
  function bundle(version) {
    return `import { DurableObject, env } from "cloudflare:workers";
let globals = 0;
export class AppFacet extends DurableObject {
  async fetch(request) {
    if (new URL(request.url).pathname.endsWith("/stream")) {
      let timer;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("open")); timer = setInterval(() => c.enqueue(new TextEncoder().encode("tick")), 100); }, cancel() { clearInterval(timer); } }));
    }
    let networkBlocked = false;
    try { await fetch("https://example.com"); } catch { networkBlocked = true; }
    const writes = (this.ctx.storage.kv.get("writes") || 0) + 1;
    this.ctx.storage.kv.put("writes", writes);
    return Response.json({ writes, globals: ++globals, version: ${version}, networkBlocked,
      bindings: Object.keys(env), parentVersion: this.ctx.storage.kv.get("version") || null,
      token: request.headers.get("authorization"), identity: JSON.parse(request.headers.get("x-tailorkit-identity")) });
  }
}`;
  }
  async function publish(version) {
    const code = bundle(version);
    const objectKey = `private/v${version}/server/server.js`;
    const bucket = await mf.getR2Bucket("BUNDLES");
    await bucket.put(objectKey, code);
    published = {
      projectId: "project",
      appId: "app",
      deploymentId: `v${version}`,
      objectKey,
      checksum: createHash("sha256").update(code).digest("hex"),
      contentLength: Buffer.byteLength(code),
    };
  }
  async function invoke(
    installationId,
    deploymentId = published.deploymentId,
    overrides = {},
    endpoint = "probe",
  ) {
    const session = await issueAppToken(signing, {
      userId: "user",
      projectId: "project",
      appId: "app",
      installationId,
      deploymentId,
      ...overrides,
    });
    return mf.dispatchFetch(`https://runtime.test/rpc/${endpoint}`, {
      method: "POST",
      body: "{}",
      headers: {
        authorization: `Bearer ${session.token}`,
        "x-tailorkit-identity": "forged",
        "content-type": "application/json",
      },
    });
  }
  async function checkRpc() {
    const repo = path.resolve(import.meta.dirname, "../../..");
    const sql = await readFile(path.join(import.meta.dirname, "fixtures/todos.sql"), "utf-8");
    const entry = path.join(state, "fixture.ts");
    // Only this disposable fixture initializes its schema with existing Drizzle-generated SQL.
    const setup = `import app from ${JSON.stringify(path.join(repo, "examples/apps/backend-todo/src/server.ts"))};
import { createAppFacet } from ${JSON.stringify(path.join(repo, "apps/apps-runtime/src/facet.ts"))};
import { createAppActions } from ${JSON.stringify(path.join(repo, "apps/apps-runtime/src/action-worker.ts"))};
import { defineApp, action, AppError } from ${JSON.stringify(path.join(repo, "packages/apps-server/dist/index.js"))};
import { env } from "cloudflare:workers";
let globals = 0;
const actionApp = defineApp({ ...app.functions,
  isolation: action({ args: app.functions.list.args, handler: context => ({ bindings: Object.keys(env), db: "db" in context, globals: ++globals, userId: context.identity.userId }) }),
  failAfterWrite: action({ functions: app.functions, args: app.functions.list.args, async handler(ctx) {
    await ctx.mutations.add({ text: "Committed before the action failed" });
    throw new AppError("CONFLICT", "Intentional action failure");
  } }),
  forgedScope: action({ args: app.functions.list.args, handler: () => env.DATABASE.runMutation({ name: "add", args: { text: "Forged" }, requestId: crypto.randomUUID(), installationId: "another-installation" }) }),
});
export default class AppActions extends createAppActions(actionApp) {}
export class AppFacet extends createAppFacet(app) {
  async fetch(request) {
    for (const statement of ${JSON.stringify(sql.split("--> statement-breakpoint"))}) this.ctx.storage.sql.exec(statement.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "));
    return super.fetch(request);
  }
}`;
    await writeFile(entry, setup);
    await build({
      configFile: false,
      root: repo,
      logLevel: "error",
      ssr: { target: "webworker", noExternal: true },
      build: {
        minify: true,
        ssr: entry,
        outDir: path.join(state, "fixture"),
        target: "esnext",
        rollupOptions: {
          external: ["cloudflare:workers"],
          output: { entryFileNames: "server.js" },
        },
      },
    });
    const code = await readFile(path.join(state, "fixture/server.js"), "utf-8");
    const bucket = await mf.getR2Bucket("BUNDLES");
    await bucket.put("private/todo/server/server.js", code);
    published = {
      projectId: "project",
      appId: "app",
      deploymentId: "backend",
      objectKey: "private/todo/server/server.js",
      checksum: createHash("sha256").update(code).digest("hex"),
      contentLength: Buffer.byteLength(code),
    };
    let renewals = 0;
    const makeClient = (installationId = "backend-todos") =>
      createClient({
        getSession: async () => {
          renewals++;
          return {
            ...(await issueAppToken(
              { ...signing, lifetimeSeconds: 8 },
              {
                userId: "user",
                projectId: "project",
                appId: "app",
                installationId,
                deploymentId: "backend",
              },
            )),
            url: "https://runtime.test/rpc",
          };
        },
        connect: async (url, protocols) => {
          const response = await mf.dispatchFetch(url.replace("wss:", "https:"), {
            headers: { upgrade: "websocket", "sec-websocket-protocol": protocols.join(", ") },
          });
          if (response.status !== 101)
            throw new Error(`WebSocket handshake ${response.status}: ${await response.text()}`);
          const socket = response.webSocket;
          socket.accept();
          return socket;
        },
        retryDelayMs: 20,
      });
    const first = makeClient();
    const second = makeClient();
    const list = reference("list", "query");
    const add = reference("add", "mutation");
    const snapshots = [[], []];
    const errors = [];
    const stops = [first, second].map((client, index) =>
      client.subscribe(list, {}, (rows) => snapshots[index].push(rows), {
        onError: (error) => errors.push(error),
      }),
    );
    async function wait(predicate, label) {
      const until = Date.now() + 15_000;
      while (!predicate()) {
        if (Date.now() > until)
          throw new Error(`Timeout: ${label}: ${JSON.stringify(errors.slice(-3))}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      await wait(() => snapshots.every((rows) => rows.length), "initial query snapshots");
      const input = { text: "Both clients see this persisted mutation" };
      const saved = await first.mutate(add, input, {
        requestId: "00000000-0000-4000-8000-000000000001",
      });
      assert.deepEqual(
        await second.mutate(add, input, { requestId: "00000000-0000-4000-8000-000000000001" }),
        saved,
      );
      await wait(
        () => snapshots.every((rows) => rows.at(-1).length === 1),
        "table invalidation on both clients",
      );
      assert.equal((await second.query(list, {})).length, 1);
      const oldCount = snapshots.map((rows) => rows.length);
      const oldRenewals = renewals;
      await wait(
        () =>
          renewals > oldRenewals && snapshots.every((rows, index) => rows.length > oldCount[index]),
        "renewed subscriptions receive fresh snapshots",
      );
      assert.equal(errors.length, 0);
      {
        pendingExternal = new Promise((resolve) => {
          releaseExternal = resolve;
        });
        const oldCalls = externalCalls;
        const action = first.action(reference("importTodo", "action"), {
          url: "https://third-party.test/slow",
        });
        await wait(() => externalCalls > oldCalls, "action reaches external API");
        // An external request must not hold the database or realtime queue.
        await second.mutate(add, { text: "While the action waits" });
        await wait(
          () => snapshots.every((rows) => rows.at(-1).length === 2),
          "writes continue while action waits",
        );
        releaseExternal();
        const imported = await action;
        assert.equal(imported.text, "Imported from external API");
        await wait(
          () => snapshots.every((rows) => rows.at(-1).length === 3),
          "action mutation updates both clients",
        );
        const probe = reference("isolation", "action");
        const isolation = await first.action(probe, {});
        assert.deepEqual(isolation, {
          bindings: ["DATABASE"],
          db: false,
          globals: 1,
          userId: "user",
        });
        assert.equal((await second.action(probe, {})).globals, 1);
        await assert.rejects(first.action(reference("forgedScope", "action"), {}));
        assert.equal((await second.query(list, {})).length, 3);
        await assert.rejects(first.action(reference("failAfterWrite", "action"), {}), {
          code: "CONFLICT",
        });
        await wait(
          () => snapshots.every((rows) => rows.at(-1).length === 4),
          "committed mutation survives action failure",
        );
        assert.equal((await second.query(list, {})).length, 4);
        const beforeRedirect = externalCalls;
        await assert.rejects(
          first.action(reference("importTodo", "action"), {
            url: "https://third-party.test/redirect",
          }),
        );
        assert.equal(externalCalls, beforeRedirect + 1);
        const beforeBlocked = externalCalls;
        await assert.rejects(
          first.action(reference("importTodo", "action"), { url: "http://127.0.0.1/private" }),
        );
        assert.equal(externalCalls, beforeBlocked);
        await assert.rejects(
          first.query(reference("importTodo", "query"), { url: "https://third-party.test/title" }),
        );
        await assert.rejects(first.action(reference("list", "action"), {}));
        stops[1]();
        await second.query(list, {}); // Cancellation and this request share an ordered connection.
        const stoppedCount = snapshots[1].length;
        await first.mutate(add, { text: "After unsubscribe" });
        await wait(() => snapshots[0].at(-1).length === 5, "remaining active client updates");
        assert.equal(snapshots[1].length, stoppedCount);
        const isolated = makeClient("another-installation");
        try {
          assert.deepEqual(await isolated.query(list, {}), []);
          await isolated.action(reference("importTodo", "action"), {
            url: "https://third-party.test/title",
          });
          assert.equal((await isolated.query(list, {})).length, 1);
          assert.equal((await first.query(list, {})).length, 5);
        } finally {
          isolated.close();
        }
      }
    } finally {
      stops.forEach((stop) => stop());
      first.close?.();
      second.close?.();
    }
    await mf.dispose();
    mf = new Miniflare(convertV4MiniflareOptions(options));
    const recovered = makeClient();
    try {
      assert.equal((await recovered.query(list, {})).length, 5);
      {
        await recovered.mutate(
          add,
          { text: "Both clients see this persisted mutation" },
          { requestId: "00000000-0000-4000-8000-000000000001" },
        );
        assert.equal((await recovered.query(list, {})).length, 5);
      }
    } finally {
      recovered.close?.();
    }
  }
  try {
    mf = new Miniflare(convertV4MiniflareOptions(options));
    await publish(1);
    const rejected = await mf.dispatchFetch("https://runtime.test/rpc", {
      headers: { upgrade: "websocket", "sec-websocket-protocol": "tailorkit, jwt.forged" },
    });
    assert.equal(rejected.status, 401);
    const response = await invoke("one");
    assert.equal(response.status, 200, await response.clone().text());
    const one = await response.json();
    assert.equal(one.writes, 1);
    assert.equal(one.globals, 1);
    assert.equal(one.networkBlocked, true);
    assert.deepEqual(one.bindings, []);
    assert.equal(one.parentVersion, null);
    assert.equal(one.token, null);
    assert.equal(one.identity.installationId, "one");
    const two = await (await invoke("two")).json();
    assert.equal(two.writes, 1);
    assert.equal(two.globals, 1);
    assert.equal((await (await invoke("one")).json()).writes, 2);
    const before = metadataReads;
    assert.equal((await invoke("one", "v1", { projectId: "other" })).status, 403);
    assert.equal(metadataReads, before + 1);
    published = { ...published, projectId: "other" };
    const otherProject = await (await invoke("one", "v1", { projectId: "other" })).json();
    assert.equal(otherProject.writes, 1);
    assert.equal(otherProject.globals, 1);
    published = { ...published, projectId: "other" };
    assert.equal((await invoke("one")).status, 403);
    await publish(2);
    assert.equal((await invoke("one", "v1")).status, 409);
    const updated = await (await invoke("one")).json();
    assert.equal(updated.writes, 3);
    assert.equal(updated.version, 2);
    assert.equal(updated.globals, 1);
    // Cold supervisor and facet after process restart must recover the same persistent SQLite.
    await mf.dispose();
    mf = new Miniflare(convertV4MiniflareOptions(options));
    const recovered = await (await invoke("one")).json();
    assert.equal(recovered.writes, 4);
    assert.equal(recovered.version, 2);
    const originalHash = published.checksum;
    published = { ...published, checksum: "a".repeat(64) };
    assert.equal((await invoke("one")).status, 500);
    published = { ...published, checksum: originalHash };
    assert.equal((await (await invoke("one")).json()).writes, 5);
    const expiring = await issueAppToken(
      { ...signing, lifetimeSeconds: 2 },
      {
        userId: "user",
        projectId: "project",
        appId: "app",
        installationId: "one",
        deploymentId: "v2",
      },
    );
    const stream = await mf.dispatchFetch("https://runtime.test/rpc/stream", {
      method: "POST",
      body: "{}",
      headers: { authorization: `Bearer ${expiring.token}` },
    });
    const body = await Promise.race([
      stream.text(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("stream expiry timeout")), 4000),
      ),
    ]);
    assert.ok(body.startsWith("open"));
    assert.equal((await (await invoke("one")).json()).writes, 6);
    await checkRpc();
  } finally {
    await mf?.dispose();
    await rm(state, { recursive: true, force: true });
  }
}, 45_000);
