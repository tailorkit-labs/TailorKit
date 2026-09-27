import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createActions } from "../schema/index";
import { createTailorKitClient } from "./client";
import { createTailorKitServer } from "./handler";

const userAction = createActions().context<{ userId: string }>();
const orgAction = createActions().context<{ orgId: string; userId: string }>();
const untypedAction = createActions();

const tailor = createTailorKitServer({
  actions: {
    todo: {
      create: orgAction
        .input(z.object({ title: z.string().min(1) }))
        .output(z.object({ id: z.string(), orgId: z.string(), title: z.string() }))
        .handler(({ input, context }) => ({
          id: `${context.userId}:1`,
          orgId: context.orgId,
          title: input.title,
        })),
    },
  },
  components: {},
});

const inferredTailor = createTailorKitServer({
  actions: {
    ping: userAction
      .input(z.object({}))
      .output(z.object({ userId: z.string() }))
      .handler(({ context }) => ({ userId: context.userId })),
  },
  components: {},
});

const optionalSchemaTailor = createTailorKitServer({
  actions: {
    nested: {
      ping: untypedAction.handler(() => ({ ping: "pong" as const })),
    },
    invalidOutput: untypedAction
      .output(z.object({ ok: z.literal(true) }))
      .handler(() => ({ ok: false }) as unknown as { ok: true }),
  },
  components: {},
});

optionalSchemaTailor.handler(new Request("https://example.com/api/tailorkit/schema"), {
  authenticate: () => ({
    // @ts-expect-error actionContext is never when actions do not call .context<...>()
    actionContext: {},
    scopeId: "test",
  }),
});

describe("createTailorKitServer", () => {
  it("preserves hosted bundle URLs without an assetsBaseUrl override", async () => {
    const app = {
      id: "app",
      clientPath:
        "https://abc123def4.tailorkit.app/p/22222222-2222-4222-8222-222222222222/a/33333333-3333-4333-8333-333333333333/d/44444444-4444-4444-8444-444444444444/client.js",
    };
    const server = createTailorKitServer({
      projectKey: "server-only-key",
      components: {},
      $internal: {
        platformFetch: () =>
          Promise.resolve(
            Response.json({ items: [app], pagination: { hasMore: false, page: 1, pageSize: 100 } }),
          ),
      },
    });
    const response = await server.handler(new Request("https://host.test/api/tailorkit/apps"), {
      authenticate: () => ({ scopeId: "workspace" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([app]);
  });
  it("dispatches actions with host context and validated input", async () => {
    const requests: Request[] = [];
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);
        requests.push(hostRequest);

        return Promise.resolve(
          tailor.handler(hostRequest, {
            authenticate: () => ({
              actionContext: { orgId: "org_1", userId: "user_1" },
              scopeId: "org:org_1",
            }),
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(
      client.actions.call({ input: { title: "Ship it" }, path: "todo.create" }),
    ).resolves.toEqual({
      id: "user_1:1",
      orgId: "org_1",
      title: "Ship it",
    });
    expect(requests[0]?.method).toBe("POST");
  });

  it("infers handler context from implemented actions", async () => {
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          inferredTailor.handler(hostRequest, {
            authenticate: () => ({
              actionContext: { userId: "user_1" },
              scopeId: "user:user_1",
            }),
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.actions.call({ input: {}, path: "ping" })).resolves.toEqual({
      userId: "user_1",
    });
  });

  it("dispatches nested actions without input or output schemas", async () => {
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          optionalSchemaTailor.handler(hostRequest, {
            authenticate: () => ({ scopeId: "test" }),
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.actions.call({ input: undefined, path: "nested.ping" })).resolves.toEqual({
      ping: "pong",
    });
  });

  it("rejects action calls when host authentication fails", async () => {
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          optionalSchemaTailor.handler(hostRequest, {
            authenticate: () => null,
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.actions.call({ input: undefined, path: "nested.ping" })).rejects.toThrow(
      /Unauthorized/u,
    );
  });

  it("rejects invalid action input only when an input schema exists", async () => {
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          tailor.handler(hostRequest, {
            authenticate: () => ({
              actionContext: { orgId: "org_1", userId: "user_1" },
              scopeId: "org:org_1",
            }),
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(
      client.actions.call({ input: { title: "" }, path: "todo.create" }),
    ).rejects.toThrow(/Invalid TailorKit payload/u);
  });

  it("rejects invalid action output when an output schema exists", async () => {
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          optionalSchemaTailor.handler(hostRequest, {
            authenticate: () => ({ scopeId: "test" }),
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.actions.call({ input: undefined, path: "invalidOutput" })).rejects.toThrow(
      /Invalid TailorKit payload/u,
    );
  });

  it("serializes action definitions without handlers or omitted schemas", () => {
    const serialized = optionalSchemaTailor.$internal.schema.serialize(() => ({ type: "object" }));

    expect(serialized.actions?.nested).toMatchObject({ ping: {} });
    expect(serialized.actions?.invalidOutput).toEqual({
      output: { type: "object" },
    });
    expect(JSON.stringify(serialized)).not.toContain("handler");
  });

  it("serves the serialized schema from the handler", async () => {
    const response = await optionalSchemaTailor.handler(
      new Request("https://example.com/api/tailorkit/schema"),
      { authenticate: () => ({ scopeId: "test" }) },
    );

    await expect(response.json()).resolves.toMatchObject({
      actions: {
        nested: { ping: {} },
      },
      components: {},
      version: 1,
    });
  });

  it("serves a built-in CLI auth approval page", async () => {
    const response = await optionalSchemaTailor.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"),
      { authenticate: () => ({ scopeId: "test" }) },
    );

    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Approve CLI login");
    expect(html).toContain('value="ABC-123-XYZ"');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("redirects unauthenticated CLI approvals to the host sign-in page", async () => {
    const server = createTailorKitServer({
      cliAuth: { signInPath: "/admin/sign-in?source=tailorkit" },
      components: {},
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"),
      { authenticate: () => null },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("location")).toBe(
      "https://example.com/admin/sign-in?source=tailorkit&returnTo=%2Fapi%2Ftailorkit%2Fcli-auth%2Fapprove%3Fcode%3DABC-123-XYZ",
    );
  });

  it("renders configured CLI approvals for authenticated users", async () => {
    const server = createTailorKitServer({
      cliAuth: { signInPath: "/admin/sign-in" },
      components: {},
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"),
      { authenticate: () => ({ scopeId: "test" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Approve CLI login");
  });

  it("rejects cross-origin CLI sign-in redirects", async () => {
    const server = createTailorKitServer({
      cliAuth: { signInPath: "//evil.example/sign-in" },
      components: {},
    });

    await expect(
      server.handler(
        new Request("https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"),
        { authenticate: () => null },
      ),
    ).rejects.toThrow("TailorKit cliAuth.signInPath must be a same-origin path.");
  });

  it("approves CLI auth from the built-in approval page", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: (request, init) => {
          const platformRequest = request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          return Promise.resolve(Response.json({ id: "cli_auth_session_1" }));
        },
        platformHeaders: { authorization: "Bearer host-token" },
      },
      components: {},
    });
    const body = new URLSearchParams({
      intent: "approve",
      userCode: "ABC-123-XYZ",
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve", {
        body,
        method: "POST",
      }),
      { authenticate: () => ({ scopeId: "org:org_1" }) },
    );

    const html = await response.text();
    expect(html).toContain("CLI login approved");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/platform/cli-auth/approve");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
    await expect(requests[0]?.json()).resolves.toEqual({
      scopeId: "org:org_1",
      userCode: "ABC-123-XYZ",
    });
  });

  it("uses projectKey as the default platform authorization header", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: (request, init) => {
          const platformRequest = request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          return Promise.resolve(Response.json({ id: "cli_auth_session_1" }));
        },
      },
      components: {},
      projectKey: "project-key",
    });
    const body = new URLSearchParams({
      intent: "approve",
      userCode: "ABC-123-XYZ",
    });

    await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve", {
        body,
        method: "POST",
      }),
      { authenticate: () => ({ scopeId: "org:org_1" }) },
    );

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer project-key");
  });

  it("surfaces rejected project keys during CLI auth start", async () => {
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: () => Promise.resolve(new Response("Unauthorized", { status: 401 })),
      },
      components: {},
      projectKey: "invalid-project-key",
    });
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          server.handler(hostRequest, {
            authenticate: () => ({ scopeId: "org:org_1" }),
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.cliAuth.start({})).rejects.toThrow(
      "TailorKit platform rejected the host project key. Check TAILORKIT_PROJECT_KEY.",
    );
  });

  it("calls the platform client with authorization headers", async () => {
    const requests: Request[] = [];
    const hostRequests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: (request, init) => {
          const platformRequest = request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          if (platformRequest.url.endsWith("/cli-auth/verify-token")) {
            return Promise.resolve(Response.json({ scopeId: "org:org_1" }));
          }

          return Promise.resolve(
            Response.json({
              items: [],
              pagination: { hasMore: false, page: 1, pageSize: 20 },
            }),
          );
        },
        platformHeaders: { authorization: "Bearer host-token" },
      },
      components: {},
    });
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest =
          request instanceof Request
            ? new Request(request, { headers: { authorization: "Bearer host-token" } })
            : new Request(request, {
                ...init,
                headers: { ...init?.headers, authorization: "Bearer host-token" },
              });
        hostRequests.push(hostRequest);

        return Promise.resolve(
          server.handler(hostRequest, {
            authenticate: () => {
              throw new Error("Host authentication should not run for deploy-token routes.");
            },
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.apps.list({ page: 1 })).resolves.toEqual({
      items: [],
      pagination: { hasMore: false, page: 1, pageSize: 20 },
    });
    expect(hostRequests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/platform/cli-auth/verify-token");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
    expect(requests[1]?.url).toBe(
      "http://localhost:3000/api/platform/apps?page=1&scopeId=org%3Aorg_1",
    );
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer host-token");
  });

  it("attaches the handler scope id when creating platform apps", async () => {
    const requests: Request[] = [];
    const hostRequests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: (request, init) => {
          const platformRequest = request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          if (platformRequest.url.endsWith("/cli-auth/verify-token")) {
            return Promise.resolve(Response.json({ scopeId: "org:org_1" }));
          }

          return Promise.resolve(Response.json({ id: "app_1" }));
        },
        platformHeaders: { authorization: "Bearer host-token" },
      },
      components: {},
    });
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest =
          request instanceof Request
            ? new Request(request, { headers: { authorization: "Bearer cli-token" } })
            : new Request(request, {
                ...init,
                headers: { ...init?.headers, authorization: "Bearer cli-token" },
              });
        hostRequests.push(hostRequest);

        return Promise.resolve(
          server.handler(hostRequest, {
            authenticate: () => {
              throw new Error("Host authentication should not run for deploy-token routes.");
            },
          }),
        );
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.apps.create({ description: null, name: "Calendar" })).resolves.toEqual({
      id: "app_1",
    });
    expect(hostRequests[0]?.method).toBe("POST");
    await expect(requests[1]?.json()).resolves.toEqual({
      description: null,
      name: "Calendar",
      scopeId: "org:org_1",
    });
  });
});
