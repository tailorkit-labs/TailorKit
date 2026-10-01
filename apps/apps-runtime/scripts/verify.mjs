// Disposable local workerd/R2 test. No Cloudflare account or deployed resources are used.
/* eslint-disable unicorn/no-await-expression-member, no-restricted-properties */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { createStorageClient, functionReference } from "@tailorkit/app-storage";
import { issueStorageToken, APP_RUNTIME_AUDIENCE } from "@tailorkit/app-storage/auth";

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
  const session = await issueStorageToken(signing, {
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
async function verifyRpc() {
  const repo = path.resolve(import.meta.dirname, "../../..");
  const sql = await readFile(
    path.join(
      repo,
      "examples/apps/persistent-todo/storage/migrations/20260930072357_initial/migration.sql",
    ),
    "utf-8",
  );
  const migrations = [
    {
      id: "test-initial",
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint"),
    },
  ];
  const entry = path.join(state, "fixture.ts");
  // Only this disposable fixture initializes its schema. Production uploads carry no migrations.
  await writeFile(
    entry,
    `import store from ${JSON.stringify(path.join(repo, "examples/apps/persistent-todo/src/server.ts"))};
import { createStorageFacet } from ${JSON.stringify(path.join(repo, "apps/apps-cloud/src/facet.ts"))};
export class AppFacet extends createStorageFacet(store, ${JSON.stringify(migrations)}) {
  #ready = false;
  async fetch(request) {
    if (!this.#ready) {
      const migrated = await super.fetch(new Request("https://fixture.test/_tailorkit/migrate", { method: "POST", headers: request.headers }));
      if (!migrated.ok) return migrated;
      this.#ready = true;
    }
    return super.fetch(request);
  }
}`,
  );
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
      rollupOptions: { external: ["cloudflare:workers"], output: { entryFileNames: "server.js" } },
    },
  });
  const code = await readFile(path.join(state, "fixture/server.js"), "utf-8");
  const bucket = await mf.getR2Bucket("BUNDLES");
  await bucket.put("private/todo/server/server.js", code);
  published = {
    projectId: "project",
    appId: "app",
    deploymentId: "todo",
    objectKey: "private/todo/server/server.js",
    checksum: createHash("sha256").update(code).digest("hex"),
    contentLength: Buffer.byteLength(code),
  };
  let renewals = 0;
  const makeClient = () =>
    createStorageClient({
      getSession: async () => {
        renewals++;
        return {
          ...(await issueStorageToken(
            { ...signing, lifetimeSeconds: 8 },
            {
              userId: "user",
              projectId: "project",
              appId: "app",
              installationId: "todos",
              deploymentId: "todo",
            },
          )),
          url: "https://runtime.test/rpc",
        };
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        return mf.dispatchFetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: await request.arrayBuffer(),
          signal: request.signal,
        });
      },
      retryDelayMs: 20,
    });
  const first = makeClient();
  const second = makeClient();
  const list = functionReference("list", "query", 1);
  const add = functionReference("add", "mutation", 1);
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
  } finally {
    stops.forEach((stop) => stop());
  }
  await mf.dispose();
  mf = new Miniflare(convertV4MiniflareOptions(options));
  assert.equal((await makeClient().query(list, {})).length, 1);
  console.log(
    "Passed: oRPC v2 queries/mutations, deduplicated accepted writes, two-client table invalidation, token refresh/reconnect snapshots and persistent app rows after restart.",
  );
}
try {
  mf = new Miniflare(convertV4MiniflareOptions(options));
  await publish(1);
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
  const expiring = await issueStorageToken(
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
    new Promise((_, reject) => setTimeout(() => reject(new Error("stream expiry timeout")), 4000)),
  ]);
  assert.ok(body.startsWith("open"));
  assert.equal((await (await invoke("one")).json()).writes, 6);
  await verifyRpc();
  console.log(
    "Passed: private R2 loading, JWT/project checks, installation isolation, blocked egress/credentials, deployment switching, stale tokens, checksum rejection, cold SQLite recovery, subscription expiry and renewal.",
  );
} finally {
  await mf?.dispose();
  await rm(state, { recursive: true, force: true });
}
