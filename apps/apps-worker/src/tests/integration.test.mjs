import { gzipSync } from "node:zlib";
// Disposable local workerd/R2 test. No Cloudflare account or deployed resources are used.
/* eslint-disable unicorn/no-await-expression-member, no-restricted-properties */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { issueAppToken, appTokenVerifier, APP_AUDIENCE } from "@tailorkit/api-utils/app-auth";

import { createClient, createApi, reference } from "@tailorkit/app/client";

import { it } from "vite-plus/test";
import { readAppMigrations } from "../../../../packages/app/src/builder/migrations.ts";

it("runs isolated app backends with persistent SQLite and two-client realtime updates", async () => {
  // Exercise precisely the workerd/Miniflare version bundled with this project's Wrangler.
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve("wrangler"))(
    "miniflare",
  );

  const state = await mkdtemp(path.join(tmpdir(), "tailorkit-apps-worker-"));

  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const signing = {
    issuer: "https://platform.test/api/platform",
    audience: APP_AUDIENCE,
    keyId: "test",
    privateKey: keys.privateKey,
  };
  const publicKeys = {
    keys: [{ ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "test" }],
  };

  const projectId = "22222222-2222-4222-8222-222222222222";
  const otherProjectId = "33333333-3333-4333-8333-333333333333";
  const publicTeamId = "abc123def45678";
  const appPublicId = "app000000001";
  const rpcUrl = `https://${publicTeamId}.tailorkit.app/p/${projectId}/a/${appPublicId}/rpc`;
  let published;
  const appTokens = new Set();
  let externalCalls = 0;
  let releaseExternal;
  let pendingExternal;
  let metadataReads = 0;

  const dist = path.resolve(import.meta.dirname, "../../dist");
  const options = {
    name: "tailorkit-runtime-test",
    modulesRoot: dist,
    modules: [
      { type: "ESModule", path: path.join(dist, "index.js") },
      ...(await readdir(dist))
        .filter((name) => name.endsWith(".txt"))
        .map((name) => ({ type: "Text", path: path.join(dist, name) })),
    ],
    compatibilityDate: "2026-10-01",
    workerLoaders: { LOADER: {} },
    durableObjects: { STORES: { className: "AppInstallation", useSQLite: true } },
    resourcePersistencePath: state,
    kvNamespaces: ["DEPLOYMENTS"],
    r2Buckets: { BUNDLES: "private-apps" },
    bindings: {
      PLATFORM_URL: "https://platform.test/api/platform",
      APP_RUNTIME_PUBLIC_KEYS: publicKeys,
      RUNTIME_SERVICE_TOKEN: "x".repeat(32),
      ASSET_DOMAIN: "tailorkit.app",
    },
    outboundService: async (request) => {
      if (request.url === "https://host.test/api/tailorkit/tools/execute") {
        const { path: toolPath, input, requestId } = await request.json();
        assert.match(requestId, /^[0-9a-f-]{36}$/u);
        const token = request.headers.get("authorization").slice(7);
        assert.ok(appTokens.has(token), "tool calls reuse an issued app execution JWT");
        const verified = await appTokenVerifier({ ...signing, publicKeys })(token);
        if (toolPath === "echo") return Response.json({ output: input });
        return Response.json({
          output: {
            subjectId: verified.subjectId,
            installationId: verified.installationId,
            scope: verified.scope,
          },
        });
      }

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

      assert.equal(request.url, "https://platform.test/api/platform/apps/app/runtime");
      assert.equal(request.headers.get("authorization"), `Bearer ${"x".repeat(32)}`);
      metadataReads++;
      return Response.json(published);
    },
  };

  let mf;

  function bundle(version) {
    return `import { env } from "cloudflare:workers";
let globals = 0;
export const runtimeManifest = { apiVersion: 1, requires: ["database", "actions"] };
export const migrations = [];
export default { functions: { probe: {
 kind: "query", args: { safeParse: value => ({ success: true, data: value }) },
 handler({ identity }) {
   let networkBlocked = false;
   try { fetch("https://example.com"); } catch { networkBlocked = true; }
   return { globals: ++globals, version: ${version}, networkBlocked,
     bindings: Object.keys(env), token: null, identity };
 }
} } }`;
  }

  async function publish(version) {
    const code = bundle(version);
    const objectKey = `teams/${publicTeamId}/projects/${projectId}/apps/${appPublicId}/deployments/deploy00000${version}/server/server.js`;
    const bucket = await mf.getR2Bucket("BUNDLES");
    const bytes = version === 1 ? Buffer.from(code) : gzipSync(code);
    await bucket.put(objectKey, bytes, {
      httpMetadata: version === 1 ? {} : { contentEncoding: "gzip" },
    });
    published = {
      projectId,
      appId: "app",
      deploymentId: `v${version}`,
      objectKey,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      contentLength: bytes.byteLength,
      ...(version === 1 ? {} : { contentEncoding: "gzip" }),
    };
    const response = await mf.dispatchFetch(
      `https://internal.tailorkit.app/p/${projectId}/a/${appPublicId}/new-deployment`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${"x".repeat(32)}`, "content-type": "application/json" },
        body: JSON.stringify(published),
      },
    );
    assert.equal(response.status, 204, await response.text());
  }

  async function invoke(
    installationId,
    deploymentId = published.deploymentId,
    overrides = {},
    endpoint = "queries",
    input = { name: "probe" },
  ) {
    const session = await issueAppToken(signing, {
      publicTeamId,
      appPublicId,
      scope: { name: "org", value: { id: "tenant" } },
      toolUrl: "https://host.test/api/tailorkit/tools/execute",
      subjectId: "user",
      projectId,
      appId: "app",
      installationId,
      deploymentId,
      ...overrides,
    });
    return mf.dispatchFetch(
      `${rpcUrl.replace(projectId, overrides.projectId ?? projectId)}/${endpoint}`,
      {
        method: "POST",
        body: JSON.stringify({ json: input }),
        headers: {
          authorization: `Bearer ${session.token}`,
          "x-tailorkit-identity": "forged",
          "content-type": "application/json",
        },
      },
    );
  }

  async function checkRpc() {
    const repo = path.resolve(import.meta.dirname, "../../../..");
    const { migrations } = await readAppMigrations(
      path.join(repo, "examples/apps/backend-todo/src/db/migrations"),
    );

    const entry = path.join(state, "fixture.ts");

    async function publishRpc(history, deploymentId) {
      // Use the same migration bootstrap bundled into production server artifacts.
      const setup = `import app from ${JSON.stringify(path.join(repo, "examples/apps/backend-todo/src/server.ts"))};
import { defineServer, action, query, table, text, integer, AppError } from ${JSON.stringify(path.join(repo, "packages/app/dist/server.js"))};
import { env } from "cloudflare:workers";

let globals = 0;
const migratedTodos = table("todos", { id: text(), priority: integer() });
const nested = { read: app.functions.list, add: app.functions.add };
const actionApp = defineServer({ ...app.functions,
  toolProbe: action({ args: app.functions.list.args, handler: ctx => ctx.tools.product.identity() }),
  nested,
  tasks: { read: action({ functions: { nested }, args: app.functions.list.args, handler: ctx => ctx.queries.nested.read() }) },
  migrationProbe: query({ args: app.functions.list.args, handler: ({ db }) => db.select().from(migratedTodos).all() }),
  isolation: action({ args: app.functions.list.args, handler: context => ({ bindings: Object.keys(env), db: "db" in context, globals: ++globals, subjectId: context.identity.subjectId }) }),
  failAfterWrite: action({ functions: app.functions, args: app.functions.list.args, async handler(ctx) {
    await ctx.mutations.add({ text: "Committed before the action failed" });
    throw new AppError("CONFLICT", "Intentional action failure");
  } }),
  readTodos: action({ functions: app.functions, args: app.functions.list.args, handler: ctx => ctx.queries.list() }),
  manyDatabaseCalls: action({ functions: app.functions, args: app.functions.list.args, async handler(ctx) {
    for (let call = 0; call < 100; call++) await ctx.queries.list();
    return "ok";
  } }),
});
export default actionApp;
export const runtimeManifest = { apiVersion: 1, requires: ["database", "actions"] };
export const migrations = ${JSON.stringify(history)};`;
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

      const bytes = gzipSync(code);
      await bucket.put("private/todo/server/server.js", bytes, {
        httpMetadata: { contentEncoding: "gzip" },
      });

      published = {
        projectId,
        appId: "app",
        deploymentId,
        objectKey: "private/todo/server/server.js",
        checksum: createHash("sha256").update(bytes).digest("hex"),
        contentLength: bytes.byteLength,
        contentEncoding: "gzip",
      };
      await (
        await mf.getKVNamespace("DEPLOYMENTS")
      ).put(JSON.stringify([published.projectId, published.appId]), JSON.stringify(published));
    }

    await publishRpc(migrations, "backend");

    let renewals = 0;
    const makeClient = (installationId = "backend-todos") =>
      createClient({
        getSession: async () => {
          renewals++;
          const session = await issueAppToken(
            // Renew after five seconds while keeping the production one-minute renewal window.
            { ...signing, lifetimeSeconds: 65 },
            {
              publicTeamId,
              appPublicId,
              scope: { name: "org", value: { id: "tenant" } },
              toolUrl: "https://host.test/api/tailorkit/tools/execute",
              subjectId: "user",
              projectId,
              appId: "app",
              installationId,
              deploymentId: published.deploymentId,
            },
          );
          appTokens.add(session.token);
          return { ...session, url: rpcUrl };
        },
        fetch: (url, init) => mf.dispatchFetch(String(url), init),
        connect: async (url, protocols) => {
          assert.equal(new URL(url).pathname, new URL(rpcUrl).pathname + "/queries");
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
      client.subscribe(list, undefined, (rows) => snapshots[index].push(rows), {
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
      assert.deepEqual(await first.query(list), await second.query(list));
      const nestedApi = createApi();
      assert.deepEqual(await first.query(nestedApi.nested.read), []);
      assert.deepEqual(await first.action(nestedApi.tasks.read), []);
      assert.deepEqual(await first.action(reference("toolProbe", "action")), {
        subjectId: "user",
        installationId: "backend-todos",
        scope: { name: "org", value: { id: "tenant" } },
      });

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
      assert.equal((await second.query(list)).length, 1);

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
        await Promise.race([
          wait(() => externalCalls > oldCalls, "action reaches external API"),
          action,
        ]);

        // An external request must not hold the database or realtime queue.
        await second.mutate(add, { text: "While the action waits" });
        await wait(
          () => snapshots.every((rows) => rows.at(-1).length === 2),
          "writes continue while action waits",
        );

        releaseExternal();
        const imported = await action;
        assert.equal(imported.text, "Imported from external API");
        assert.equal((await second.query(list)).length, 3);
        await wait(
          () => snapshots.every((rows) => rows.at(-1).length === 3),
          "action mutation updates both clients",
        );
        const actionSnapshots = snapshots.map((rows) => rows.length);

        // Action queries use the trusted bridge and recheck publication.
        const beforeDirect = metadataReads;
        const actionRows = await first.action(reference("readTodos", "action"));
        assert.equal(actionRows.length, 3);
        // Admission checks the deployment once; the nested query stays in the facet.
        assert.equal(metadataReads, beforeDirect);
        assert.deepEqual(
          snapshots.map((rows) => rows.length),
          actionSnapshots,
        );

        const probe = reference("isolation", "action");
        const isolation = await first.action(probe);
        assert.deepEqual(isolation, {
          bindings: [],
          db: false,
          globals: 1,
          subjectId: "user",
        });
        assert.equal((await second.action(probe)).globals, 2);

        // Local action calls retain the installation database and verified identity.
        assert.equal((await second.query(list)).length, 3);

        // Local calls do not consume RPC subrequests or application call allowances.
        assert.equal(await first.action(reference("manyDatabaseCalls", "action")), "ok");

        await assert.rejects(first.action(reference("failAfterWrite", "action")), {
          code: "CONFLICT",
        });
        assert.equal((await second.query(list)).length, 4);
        await wait(
          () => snapshots.every((rows) => rows.at(-1).length === 4),
          "committed action mutation updates clients even when action fails",
        );

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
        await second.query(list); // Cancellation and this request share an ordered connection.
        const stoppedCount = snapshots[1].length;
        await first.mutate(add, { text: "After unsubscribe" });
        await wait(() => snapshots[0].at(-1).length === 5, "remaining active client updates");
        assert.equal(snapshots[1].length, stoppedCount);

        const isolated = makeClient("another-installation");

        try {
          assert.deepEqual(await isolated.query(list), []);
          await isolated.action(reference("importTodo", "action"), {
            url: "https://third-party.test/title",
          });
          assert.equal((await isolated.query(list)).length, 1);
          assert.equal((await first.query(list)).length, 5);
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
      assert.equal((await recovered.query(list)).length, 5);

      {
        await recovered.mutate(
          add,
          { text: "Both clients see this persisted mutation" },
          { requestId: "00000000-0000-4000-8000-000000000001" },
        );
        assert.equal((await recovered.query(list)).length, 5);
      }
    } finally {
      recovered.close?.();
    }

    const upgradeSql = await readFile(
      path.join(import.meta.dirname, "fixtures/todos-priority.sql"),
      "utf8",
    );
    const upgrade = {
      id: "20261002000000_priority",
      hash: createHash("sha256").update(upgradeSql).digest("hex"),
      statements: [upgradeSql],
    };

    const live = makeClient();
    const liveSnapshots = [];
    const stopLive = live.subscribe(list, undefined, (rows) => liveSnapshots.push(rows), {
      onError: (error) => errors.push(error),
    });
    await wait(() => liveSnapshots.length === 1, "subscription before deployment change");
    pendingExternal = new Promise((resolve) => {
      releaseExternal = resolve;
    });
    const beforeUpgradeCalls = externalCalls;
    const oldAction = live.action(reference("importTodo", "action"), {
      url: "https://third-party.test/slow",
    });
    const oldActionResult = oldAction.then(
      () => "unexpected",
      (error) => error.code,
    );
    await wait(() => externalCalls > beforeUpgradeCalls, "action before deployment replacement");
    await publishRpc([...migrations, upgrade], "backend-upgrade");

    // Activate the deployment over HTTP: version changes close existing WebSocket connections.
    const upgradeResponse = await invoke("backend-todos", published.deploymentId, {}, "queries", {
      name: "list",
    });
    assert.equal(upgradeResponse.status, 200, await upgradeResponse.clone().text());
    assert.equal(await oldActionResult, "UNAVAILABLE");
    releaseExternal();
    try {
      await wait(() => liveSnapshots.length > 1, "facet restart reconnects active subscriptions");
      assert.equal(liveSnapshots.at(-1).length, 5);
    } finally {
      stopLive();
      live.close();
    }

    const upgraded = makeClient();

    try {
      assert.equal((await upgraded.query(list)).length, 5);
      const rows = await upgraded.query(reference("migrationProbe", "query"));
      assert.equal(rows.length, 5);
      assert.ok(rows.every((row) => row.priority === 0));
    } finally {
      upgraded.close();
    }

    const requiredSql = await readFile(
      path.join(import.meta.dirname, "fixtures/todos-required.sql"),
      "utf8",
    );
    const failed = {
      id: "20261003000000_required",
      hash: createHash("sha256").update(requiredSql).digest("hex"),
      statements: [requiredSql],
    };

    await publishRpc([...migrations, upgrade, failed], "backend-failed");

    const failedResponse = await invoke("backend-todos", published.deploymentId, {}, "queries", {
      name: "list",
    });
    assert.equal(failedResponse.status, 500);

    await publishRpc([...migrations, upgrade], "backend-retry");

    await mf.dispose();
    mf = new Miniflare(convertV4MiniflareOptions(options));

    const retryResponse = await invoke("backend-todos", published.deploymentId, {}, "queries", {
      name: "list",
    });
    assert.equal(retryResponse.status, 200, await retryResponse.clone().text());

    const retried = makeClient();
    const fresh = makeClient("created-after-upgrade");

    try {
      assert.equal((await retried.query(list)).length, 5);
      assert.ok(
        (await retried.query(reference("migrationProbe", "query"))).every(
          (row) => row.priority === 0,
        ),
      );
      assert.deepEqual(await fresh.query(reference("migrationProbe", "query")), []);
      await fresh.mutate(add, { text: "Initialized with the full history" });
      assert.equal((await fresh.query(reference("migrationProbe", "query")))[0].priority, 0);
    } finally {
      retried.close();
      fresh.close();
    }
  }

  try {
    mf = new Miniflare(convertV4MiniflareOptions(options));
    await publish(1);

    // Assets and app code share one R2 binding, but public routes cannot expose server code.
    const assets = await mf.getR2Bucket("BUNDLES");
    const assetBase = `${rpcUrl.replace(/\/rpc$/u, "")}/d/deploy000001`;
    const clientKey = `teams/${publicTeamId}/projects/${projectId}/apps/${appPublicId}/deployments/deploy000001/client/client.js`;
    const clientBytes = gzipSync("export default 'client';");
    await assets.put(clientKey, clientBytes, { httpMetadata: { contentEncoding: "gzip" } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const compressed = await mf.dispatchFetch(`${assetBase}/client/client.js`, {
        headers: { "Accept-Encoding": "gzip" },
      });
      assert.equal(compressed.headers.get("mf-content-encoding"), "gzip");
      assert.equal(compressed.headers.get("vary"), "Accept-Encoding");
      // Miniflare dispatchFetch decodes HTTP gzip and preserves its header here.
      assert.equal(await compressed.text(), "export default 'client';", `gzip request ${attempt}`);
    }
    const client = await mf.dispatchFetch(`${assetBase}/client/client.js`, {
      headers: { "Accept-Encoding": "identity" },
    });
    assert.equal(client.status, 200);
    assert.equal(await client.text(), "export default 'client';");
    assert.equal(client.headers.get("cache-control"), "private, max-age=3600");
    const clientHead = await mf.dispatchFetch(`${assetBase}/client/client.js`, {
      method: "HEAD",
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(clientHead.headers.get("mf-content-encoding"), "gzip");
    assert.equal(clientHead.headers.get("content-length"), String(clientBytes.byteLength));
    assert.equal((await mf.dispatchFetch(`${assetBase}/client.js`)).status, 404);
    const logoHash = "a".repeat(64);
    await assets.put(
      `teams/${publicTeamId}/projects/${projectId}/apps/${appPublicId}/logos/${logoHash}.svg`,
      "<svg/>",
    );
    const logo = await mf.dispatchFetch(`${assetBase}/logos/${logoHash}.svg`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/svg+xml");
    assert.equal((await mf.dispatchFetch(`${assetBase}/server/server.js`)).status, 404);

    const rejected = await mf.dispatchFetch(`${rpcUrl}/queries`, {
      headers: { upgrade: "websocket", "sec-websocket-protocol": "tailorkit, jwt.forged" },
    });
    assert.equal(rejected.status, 401);

    const response = await invoke("one");
    assert.equal(response.status, 200, await response.clone().text());
    const one = (await response.json()).json;
    assert.equal(one.globals, 1);
    assert.equal(one.networkBlocked, true);
    assert.deepEqual(one.bindings, []);
    assert.equal(one.token, null);
    assert.equal(one.identity.installationId, "one");

    const two = await (await invoke("two")).json().then((result) => result.json);
    assert.equal(two.globals, 1);
    assert.equal((await (await invoke("one")).json().then((result) => result.json)).globals, 2);

    const before = metadataReads;
    assert.equal((await invoke("one", "v1", { projectId: otherProjectId })).status, 403);
    assert.equal(metadataReads, before + 1);

    published = { ...published, projectId: otherProjectId };
    const otherProject = await (
      await invoke("one", "v1", { projectId: otherProjectId })
    )
      .json()
      .then((result) => result.json);
    assert.equal(otherProject.globals, 1);

    published = { ...published, projectId: otherProjectId };
    await (await mf.getKVNamespace("DEPLOYMENTS")).delete(JSON.stringify([projectId, "app"]));
    assert.equal((await invoke("one")).status, 403);

    await publish(2);
    assert.equal((await invoke("one", "v1")).status, 200);

    const updated = await (await invoke("one")).json().then((result) => result.json);
    assert.equal(updated.version, 2);
    assert.equal(updated.globals, 2);

    // Cold supervisor and facet after process restart must recover the same persistent SQLite.
    await mf.dispose();
    mf = new Miniflare(convertV4MiniflareOptions(options));

    const recovered = await (await invoke("one")).json().then((result) => result.json);
    assert.equal(recovered.globals, 1);
    assert.equal(recovered.version, 2);

    const originalHash = published.checksum;
    published = { ...published, checksum: "a".repeat(64) };
    await (await mf.getKVNamespace("DEPLOYMENTS")).delete(JSON.stringify([projectId, "app"]));
    assert.equal((await invoke("one")).status, 500);
    published = { ...published, checksum: originalHash };
    await (
      await mf.getKVNamespace("DEPLOYMENTS")
    ).put(JSON.stringify([projectId, "app"]), JSON.stringify(published));
    assert.equal((await (await invoke("one")).json().then((result) => result.json)).globals, 2);

    await checkRpc();
  } finally {
    await mf?.dispose();
    await rm(state, { recursive: true, force: true });
  }
}, 45_000);
