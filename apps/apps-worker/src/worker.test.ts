import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("cloudflare:workers", () => ({
  RpcTarget: class {},
  WorkerEntrypoint: class {},
  DurableObject: class {
    ctx: unknown;
    env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { AppError } from "@tailorkit/app/server";
import { issueAppToken, APP_AUDIENCE } from "@tailorkit/api-utils/app-auth";
import worker from "./worker";
import { AppInstallation } from "./installation";

// Node requires a duplex hint for request streams; workerd does not.
const NativeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const options =
        init instanceof NativeRequest
          ? {
              method: init.method,
              headers: init.headers,
              body: init.body,
              signal: init.signal,
              duplex: "half",
            }
          : { ...init, duplex: "half" };
      super(input, options);
    }
  },
);

afterAll(() => vi.unstubAllGlobals());

const source = vi.hoisted(() => ({ current: vi.fn(), code: vi.fn() }));

const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const signing = {
  issuer: "https://platform.test/api/platform",
  audience: APP_AUDIENCE,
  keyId: "host",
  privateKey: keys.privateKey,
};
const publicKeys = {
  keys: [{ ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "host" }],
};
const identity = {
  publicTeamId: "abc123def45678",
  appPublicId: "app000000001",
  subjectId: "user",
  projectId: "22222222-2222-4222-8222-222222222222",
  scope: { name: "org", value: { id: "tenant" } },
  toolUrl: "https://host.test/api/tailorkit/tools/execute",
  appId: "app",
  installationId: "one",
  deploymentId: "v1",
};
const checksum = async (code: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const codeHash = await checksum("code");
const nextHash = await checksum("new code");
const deployment = {
  projectId: "22222222-2222-4222-8222-222222222222",
  appId: "app",
  deploymentId: "v1",
  checksum: codeHash,
  objectKey:
    "teams/abc123def45678/projects/22222222-2222-4222-8222-222222222222/apps/app000000001/deployments/deploy000001/server/server.js",
  contentLength: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  source.current.mockResolvedValue(deployment);
  source.code.mockResolvedValue("code");
});

function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(await source.current())),
  );
  let version: string | undefined;
  const facetQuery = vi.fn(async (_input: unknown, _identity: unknown) => ({
    result: { ok: true, value: "result" },
    tables: [],
    committed: false,
  }));
  const startup = vi.fn();
  const abort = vi.fn();
  const put = vi.fn((_key: string, value: string) => {
    version = value;
  });
  const get = vi.fn((_name: string, options: () => unknown) => {
    startup(options());
    return { query: facetQuery };
  });
  const id = { toString: () => "installation-id", equals: vi.fn(() => true) };
  const ctx = {
    id,
    getWebSockets: () => [],
    storage: { kv: { get: () => version, put } },
    facets: { get, abort },
  } as unknown as DurableObjectState;

  const getClass = vi.fn(() => "facet-class");
  const load = vi.fn((_name: string, options: () => unknown) => {
    startup(options());
    return { getDurableObjectClass: getClass };
  });

  const routeFetch = vi.fn(async (_request: Request) => new Response("forwarded", { status: 202 }));
  const getByName = vi.fn((_name: string) => ({ fetch: routeFetch }));
  const idFromName = vi.fn(() => id);

  const env = {
    ASSET_DOMAIN: "tailorkit.app",
    DEPLOYMENTS: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
    BUNDLES: { get: async () => ({ body: new Response(await source.code()).body! }) },
    RUNTIME_SERVICE_TOKEN: "private",
    PLATFORM_URL: signing.issuer,
    APP_RUNTIME_PUBLIC_KEYS: publicKeys,
    STORES: { getByName, idFromName },
    LOADER: { get: load },
  } as unknown as Env;

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
    facetQuery,
  };
}

async function request(overrides = {}, path = "/rpc/queries", body = '{"json":{"name":"list"}}') {
  const session = await issueAppToken(signing, { ...identity, ...overrides });

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

// Gateway tests use hosted paths; installation tests retain the private normalized /rpc paths.
async function fetchWorker(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.hostname === "runtime.test" && url.pathname.startsWith("/rpc")) {
    const token = request.headers.get("authorization")?.slice(7);
    const payload = token
      ? JSON.parse(atob(token.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/")))
      : identity;
    url.hostname = `${identity.publicTeamId}.tailorkit.app`;
    url.pathname = `/p/${payload.projectId}/a/${identity.appPublicId}${url.pathname}`;
  }
  return worker.fetch(
    new Request(url, request),
    { ...env, ASSET_DOMAIN: env.ASSET_DOMAIN ?? "tailorkit.app" },
    {} as ExecutionContext,
  );
}

it("answers a preflight without accessing authentication or storage", async () => {
  const response = await fetchWorker(
    new Request("https://runtime.test/rpc/queries", { method: "OPTIONS" }),
    {} as Parameters<typeof worker.fetch>[1],
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["GET", "POST"])(
  "rejects unsupported %s routes before authentication or storage",
  async (method) => {
    const { env, getByName } = setup();
    const response = await fetchWorker(
      new Request("https://runtime.test/server/server.js", { method }),
      env,
    );

    expect(response.status).toBe(404);
    expect(getByName).not.toHaveBeenCalled();
  },
);

it.each(["/rpc", "/rpc/query", "/rpc/unknown", "/rpc/queries/extra"])(
  "rejects unknown RPC route %s",
  async (path) => {
    const { env, getByName } = setup();
    expect(
      (await fetchWorker(new Request(`https://runtime.test${path}`, { method: "POST" }), env))
        .status,
    ).toBe(404);
    expect(getByName).not.toHaveBeenCalled();
  },
);

it.each(["actions", "mutations", "queries"])(
  "forwards authenticated HTTP %s calls",
  async (kind) => {
    const { env, routeFetch } = setup();
    await fetchWorker(await request({}, `/rpc/${kind}`), env);
    expect(routeFetch.mock.calls[0]![0].url).toBe(
      `https://${identity.publicTeamId}.tailorkit.app/rpc/${kind}`,
    );
  },
);

it("requires a token even when any origin is allowed", async () => {
  const { env, getByName } = setup();
  const response = await fetchWorker(
    new Request("https://runtime.test/rpc/queries", {
      method: "POST",
      headers: { origin: "https://attacker.test" },
    }),
    env,
  );

  expect(response.status).toBe(401);
  expect(getByName).not.toHaveBeenCalled();
});

it("authenticates and forwards an RPC body with CORS and stable installation routing", async () => {
  const { env, getByName, routeFetch } = setup();
  const response = await fetchWorker(await request(), env);

  expect(response.status).toBe(202);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(getByName).toHaveBeenCalledWith(
    JSON.stringify([signing.issuer, identity.projectId, "app", "one"]),
  );
  expect(await routeFetch.mock.calls[0][0].text()).toBe('{"json":{"name":"list"}}');
});

it("maps forwarding failures to a sanitized response with allowed-origin CORS", async () => {
  const { env, routeFetch } = setup();
  routeFetch.mockRejectedValueOnce(new Error("private details"));
  const response = await fetchWorker(await request(), env);

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private details");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
});

it("accepts different signed projects and routes them to distinct installations", async () => {
  const { env, getByName } = setup();

  expect((await fetchWorker(await request(), env)).status).toBe(202);
  expect(
    (await fetchWorker(await request({ projectId: "33333333-3333-4333-8333-333333333333" }), env))
      .status,
  ).toBe(202);
  expect(getByName.mock.calls.map(([name]) => name)).toEqual([
    JSON.stringify([signing.issuer, identity.projectId, "app", "one"]),
    JSON.stringify([signing.issuer, "33333333-3333-4333-8333-333333333333", "app", "one"]),
  ]);
});

it("loads isolated code, passes only the verified identity and caches a warm deployment", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);
  const response = await installation.fetch(await request());

  expect(await response.json()).toEqual({ json: "result" });
  expect(fixtures.load).toHaveBeenCalledWith(
    `installation-id:v1:${deployment.checksum}`,
    expect.any(Function),
  );
  expect(fixtures.startup).toHaveBeenCalledWith(
    expect.objectContaining({
      modules: expect.objectContaining({
        "application.js": "code",
        "bootstrap.js": expect.any(String),
      }),
      globalOutbound: null,
      env: {},
      limits: { cpuMs: 10, subRequests: 64 },
    }),
  );
  expect(fixtures.get).toHaveBeenCalledWith("app", expect.any(Function));
  expect(fixtures.getClass).toHaveBeenCalledWith("AppFacet");

  expect(fixtures.facetQuery).toHaveBeenCalledWith(
    { name: "list" },
    expect.objectContaining(identity),
  );

  await (await installation.fetch(await request())).text();

  expect(source.current).toHaveBeenCalledTimes(2);
  expect(source.code).toHaveBeenCalledOnce();
  expect(fixtures.abort).not.toHaveBeenCalled();
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

it("changes code on the same facet and accepts old client tokens without switching back", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);
  await (await installation.fetch(await request())).text();

  source.current.mockResolvedValue({
    ...deployment,
    deploymentId: "v2",
    checksum: nextHash,
    contentLength: "new code".length,
  });
  source.code.mockResolvedValue("new code");

  await (await installation.fetch(await request({ deploymentId: "v2" }))).text();

  expect(fixtures.abort).toHaveBeenCalledOnce();
  expect(fixtures.abort).toHaveBeenCalledWith("app", "App deployment changed");
  expect(fixtures.put).toHaveBeenLastCalledWith("version", `v2:${nextHash}`);
  expect(fixtures.get.mock.calls.every(([name]) => name === "app")).toBe(true);

  const loads = source.code.mock.calls.length;

  expect((await installation.fetch(await request())).status).toBe(200);
  expect(source.code).toHaveBeenCalledTimes(loads);
  expect(fixtures.abort).toHaveBeenCalledOnce();
});

it("keeps the running facet when replacement code fails verification", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);
  await (await installation.fetch(await request())).text();

  source.current.mockResolvedValue({ ...deployment, deploymentId: "v2" });
  source.code.mockRejectedValue(new AppError("NOT_FOUND", "Missing code"));

  expect((await installation.fetch(await request({ deploymentId: "v2" }))).status).toBe(404);
  expect(fixtures.abort).not.toHaveBeenCalled();
  expect(fixtures.put).toHaveBeenCalledOnce();
});

it("rechecks authentication and rejects the wrong supervisor before looking up app code", async () => {
  const fixtures = setup();
  const installation = new AppInstallation(fixtures.ctx, fixtures.env);

  expect((await installation.fetch(new Request("https://runtime.test/rpc/queries"))).status).toBe(
    401,
  );

  fixtures.id.equals.mockReturnValue(false);
  expect((await installation.fetch(await request())).status).toBe(403);
  expect(source.current).not.toHaveBeenCalled();
  expect(fixtures.load).not.toHaveBeenCalled();
});

it("accepts metadata publication only with the shared service credential", async () => {
  const { env, getByName } = setup();
  env.RUNTIME_SERVICE_TOKEN = "x".repeat(32);
  const publish = (token: string, body: unknown = deployment) =>
    fetchWorker(
      new Request(
        `https://internal.tailorkit.app/p/${identity.projectId}/a/${identity.appPublicId}/new-deployment`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      env,
    );
  expect((await publish("wrong")).status).toBe(401);
  expect((await publish(env.RUNTIME_SERVICE_TOKEN, {})).status).toBe(400);
  expect((await publish(env.RUNTIME_SERVICE_TOKEN)).status).toBe(204);
  expect(env.DEPLOYMENTS.put).toHaveBeenCalledWith(
    JSON.stringify([deployment.projectId, deployment.appId]),
    expect.any(String),
    { expirationTtl: 300 },
  );
  expect(JSON.parse((env.DEPLOYMENTS.put as ReturnType<typeof vi.fn>).mock.calls[0]![1])).toEqual(
    deployment,
  );
  expect(getByName).not.toHaveBeenCalled();
});
