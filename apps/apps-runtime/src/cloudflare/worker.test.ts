import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { Effect } from "effect";
import { StorageError } from "@tailorkit/app-storage";
import { issueStorageToken } from "@tailorkit/app-storage/auth";
import worker, { AppInstallation, verifier } from "./worker";
import type { RuntimeEnvironment } from "./env";

// Node requires a duplex hint for request streams; workerd does not.
const NativeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const options = { ...init, duplex: "half" };
      super(input, options);
    }
  },
);

afterAll(() => vi.unstubAllGlobals());

const source = vi.hoisted(() => ({ current: vi.fn(), code: vi.fn() }));

vi.mock("./source", () => ({
  deploymentSource: () => ({
    current: () => Effect.tryPromise({ try: () => source.current(), catch: (error) => error }),
    code: () => Effect.tryPromise({ try: () => source.code(), catch: (error) => error }),
  }),
}));

const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const signing = {
  issuer: "https://host.test",
  audience: "runtime",
  keyId: "host",
  privateKey: keys.privateKey,
};
const publicKeys = {
  keys: [{ ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "host" }],
};
const identity = {
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "one",
  deploymentId: "v1",
};
const deployment = {
  projectId: "project",
  appId: "app",
  deploymentId: "v1",
  checksum: "a".repeat(64),
  objectKey: "private/server.js",
  contentLength: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  source.current.mockResolvedValue(deployment);
  source.code.mockResolvedValue("code");
});

function setup() {
  let version: string | undefined;
  const facetFetch = vi.fn(async (_request: Request) => new Response("result"));
  const startup = vi.fn();
  const abort = vi.fn();
  const put = vi.fn((_key: string, value: string) => {
    version = value;
  });
  const get = vi.fn((_name: string, options: () => unknown) => {
    startup(options());
    return { fetch: facetFetch };
  });
  const id = { toString: () => "installation-id", equals: vi.fn(() => true) };
  const ctx = {
    id,
    storage: { kv: { get: () => version, put } },
    facets: { get, abort },
  } as unknown as DurableObjectState;
  const getClass = vi.fn(() => "facet-class");
  const load = vi.fn((_name: string, options: () => unknown) => {
    startup(options());
    return { getDurableObjectClass: getClass };
  });
  const routeFetch = vi.fn(async (_request: Request) => new Response("forwarded", { status: 202 }));
  const getByName = vi.fn(() => ({ fetch: routeFetch }));
  const idFromName = vi.fn(() => id);
  const env = {
    STORAGE_ISSUER: signing.issuer,
    STORAGE_AUDIENCE: signing.audience,
    STORAGE_PROJECT_ID: "project",
    STORAGE_PUBLIC_KEYS: JSON.stringify(publicKeys),
    STORAGE_ORIGINS: '["https://host.test"]',
    STORES: { getByName, idFromName },
    LOADER: { get: load },
  } as unknown as RuntimeEnvironment;

  return {
    env,
    ctx,
    id,
    getByName,
    routeFetch,
    load,
    startup,
    getClass,
    get,
    abort,
    put,
    facetFetch,
  };
}

async function request(overrides = {}, path = "/rpc/query", body = "{}") {
  const session = await issueStorageToken(signing, { ...identity, ...overrides });

  return new Request(`https://runtime.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
      "x-tailorkit-identity": "forged",
      origin: "https://host.test",
    },
    body,
  });
}

it("answers a preflight without accessing authentication or storage", async () => {
  const response = await worker.fetch(
    new Request("https://runtime.test/rpc/query", { method: "OPTIONS" }),
    {
      STORAGE_ORIGINS: "[]",
    } as Parameters<typeof worker.fetch>[1],
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["GET", "POST"])(
  "rejects unsupported %s routes before authentication or storage",
  async (method) => {
    const { env, getByName } = setup();
    const response = await worker.fetch(
      new Request("https://runtime.test/server/server.js", { method }),
      env,
    );

    expect(response.status).toBe(404);
    expect(getByName).not.toHaveBeenCalled();
  },
);

it("rejects disallowed origins before authentication", async () => {
  const { env, getByName } = setup();
  const response = await worker.fetch(
    new Request("https://runtime.test/rpc/query", {
      method: "POST",
      headers: { origin: "https://attacker.test" },
    }),
    env,
  );

  expect(response.status).toBe(403);
  expect(getByName).not.toHaveBeenCalled();
});

it("authenticates and forwards a bounded RPC body with CORS and stable installation routing", async () => {
  const { env, getByName, routeFetch } = setup();
  const response = await worker.fetch(await request(), env);

  expect(response.status).toBe(202);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://host.test");
  expect(response.headers.get("vary")).toBe("Origin");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(getByName).toHaveBeenCalledWith(JSON.stringify([signing.issuer, "project", "app", "one"]));
  expect(await routeFetch.mock.calls[0][0].text()).toBe("{}");
});

it.each([{}, { projectId: "other" }, { deploymentId: undefined }, { projectId: undefined }])(
  "rejects unauthorized or incomplete runtime identities: %j",
  async (access) => {
    const { env, getByName } = setup();
    const incoming = Object.keys(access).length
      ? await request(access)
      : new Request("https://runtime.test/rpc/query", { method: "POST", body: "{}" });
    const response = await worker.fetch(incoming, env);

    expect(response.status).toBe(401);
    expect(getByName).not.toHaveBeenCalled();
  },
);

it("rejects oversized chunked request bodies without forwarding", async () => {
  const { env, getByName } = setup();
  const response = await worker.fetch(
    await request({}, "/rpc/query", "x".repeat(1024 * 1024 + 1)),
    env,
  );

  expect(response.status).toBe(500);
  expect(getByName).not.toHaveBeenCalled();
});

it("maps forwarding failures to a sanitized response with allowed-origin CORS", async () => {
  const { env, routeFetch } = setup();
  routeFetch.mockRejectedValueOnce(new Error("private details"));
  const response = await worker.fetch(await request(), env);

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private details");
  expect(response.headers.get("access-control-allow-origin")).toBe("https://host.test");
});

it("requires trusted project configuration", () => {
  const { env } = setup();

  expect(() => verifier({ ...env, STORAGE_PROJECT_ID: "" })).toThrow("trusted project");
});

it("loads isolated code, strips caller headers and caches a warm deployment", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);
  const response = await installation.fetch(await request());

  expect(await response.text()).toBe("result");
  expect(fixtures.load).toHaveBeenCalledWith(
    `installation-id:v1:${deployment.checksum}`,
    expect.any(Function),
  );
  expect(fixtures.startup).toHaveBeenCalledWith(
    expect.objectContaining({
      modules: { "app.js": "code" },
      globalOutbound: null,
      env: {},
      limits: { cpuMs: 50, subRequests: 0 },
    }),
  );
  expect(fixtures.get).toHaveBeenCalledWith("app", expect.any(Function));
  expect(fixtures.getClass).toHaveBeenCalledWith("AppFacet");
  const forwarded = fixtures.facetFetch.mock.calls[0][0];
  expect(forwarded.headers.get("authorization")).toBeNull();
  expect(forwarded.headers.get("origin")).toBeNull();
  expect(JSON.parse(forwarded.headers.get("x-tailorkit-identity")!)).toMatchObject(identity);
  expect(await forwarded.text()).toBe("{}");

  await (await installation.fetch(await request())).text();

  expect(source.current).toHaveBeenCalledTimes(2);
  expect(source.code).toHaveBeenCalledOnce();
  expect(fixtures.abort).not.toHaveBeenCalled();
});

it("changes code on the same facet and rejects old deployment requests without switching back", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);
  await (await installation.fetch(await request())).text();
  source.current.mockResolvedValue({ ...deployment, deploymentId: "v2", checksum: "b".repeat(64) });
  source.code.mockResolvedValue("new code");

  await (await installation.fetch(await request({ deploymentId: "v2" }))).text();

  expect(fixtures.abort).toHaveBeenCalledOnce();
  expect(fixtures.abort).toHaveBeenCalledWith("app", "App deployment changed");
  expect(fixtures.put).toHaveBeenLastCalledWith("version", `v2:${"b".repeat(64)}`);
  expect(fixtures.get.mock.calls.every(([name]) => name === "app")).toBe(true);
  const loads = source.code.mock.calls.length;

  expect((await installation.fetch(await request())).status).toBe(409);
  expect(source.code).toHaveBeenCalledTimes(loads);
  expect(fixtures.abort).toHaveBeenCalledOnce();
});

it("keeps the running facet when replacement code fails verification", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);
  await (await installation.fetch(await request())).text();
  source.current.mockResolvedValue({ ...deployment, deploymentId: "v2" });
  source.code.mockRejectedValue(new StorageError("NOT_FOUND", "Missing code"));

  expect((await installation.fetch(await request({ deploymentId: "v2" }))).status).toBe(404);
  expect(fixtures.abort).not.toHaveBeenCalled();
  expect(fixtures.put).toHaveBeenCalledOnce();
});

it("rechecks authentication and rejects the wrong supervisor before looking up app code", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);

  expect((await installation.fetch(new Request("https://runtime.test/rpc/query"))).status).toBe(
    401,
  );
  fixtures.id.equals.mockReturnValue(false);
  expect((await installation.fetch(await request())).status).toBe(403);
  expect(source.current).not.toHaveBeenCalled();
  expect(fixtures.load).not.toHaveBeenCalled();
});
