import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createActions } from "../schema/index";
import { createTailorKitClient } from "./client";
import { createTailorKitServer } from "./handler";

const userAction = createActions().context<{ userId: string }>();
const orgAction = createActions().context<{ orgId: string; userId: string }>();
const untypedAction = createActions();
const testScopeSchema = z.record(z.string(), z.string().min(1));

const tailor = createTailorKitServer({
  scopes: { org: testScopeSchema },
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
  scopes: { org: testScopeSchema },
  actions: {
    ping: userAction
      .input(z.object({}))
      .output(z.object({ userId: z.string() }))
      .handler(({ context }) => ({ userId: context.userId })),
  },
  components: {},
});

const optionalSchemaTailor = createTailorKitServer({
  scopes: { org: testScopeSchema },
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
    scopes: { org: { tenant: "test" } },
  }),
});

describe("createTailorKitServer", () => {
  it("selects only requested authenticated scope names for host app reads", async () => {
    const platformBodies: unknown[] = [];
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema, userOrg: testScopeSchema },
      components: {},
      $internal: {
        platformFetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          platformBodies.push(await request.json());
          return Response.json({
            items: [],
            pagination: { hasMore: false, page: 1, pageSize: 100 },
          });
        },
      },
    });
    const authenticate = () => ({
      scopes: {
        org: { tenant: "org" },
        userOrg: { tenant: "user_org" },
      },
    });

    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/apps?scopes=userOrg&scopes=userOrg"),
      { authenticate },
    );
    expect(response.status).toBe(200);
    expect(platformBodies).toEqual([
      {
        page: 1,
        pageSize: 100,
        scopes: [{ name: "userOrg", value: { tenant: "user_org" } }],
      },
    ]);

    const invalid = await server.handler(
      new Request("https://example.com/api/tailorkit/apps?scopes=missing"),
      { authenticate },
    );
    expect(invalid.status).toBe(400);
    expect(platformBodies).toHaveLength(1);
  });

  it("treats scopes= as an empty app and preview selection", async () => {
    let platformCalls = 0;
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
      components: {},
      $internal: {
        platformFetch: () => {
          platformCalls += 1;
          return Promise.resolve(Response.json({ items: [] }));
        },
      },
    });
    const authenticate = () => ({ scopes: { org: { tenant: "workspace" } } });
    const apps = await server.handler(
      new Request("https://example.com/api/tailorkit/apps?scopes="),
      { authenticate },
    );
    expect(apps.status).toBe(200);
    await expect(apps.json()).resolves.toEqual([]);

    const metadata = await server.handler(
      new Request("https://example.com/api/tailorkit/preview/metadata?sessionId=test&scopes="),
      { authenticate },
    );
    expect(metadata.status).toBe(404);
    expect(platformCalls).toBe(0);
  });

  it("preserves hosted bundle URLs without an assetsBaseUrl override", async () => {
    const app = {
      id: "app",
      clientPath:
        "https://abc123def4.tailorkit.app/p/22222222-2222-4222-8222-222222222222/a/33333333-3333-4333-8333-333333333333/d/44444444-4444-4444-8444-444444444444/client.js",
    };
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
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
      authenticate: () => ({ scopes: { org: { tenant: "workspace" } } }),
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
              scopes: { org: { orgId: "org_1" } },
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
              scopes: { org: { userId: "user_1" } },
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

  it.each(["https://example.com/api/tailorkit?deployment=test", "/api/tailorkit?deployment=test"])(
    "preserves the RPC URL and headers for %s",
    async (url) => {
      const requests: Request[] = [];
      const client = createTailorKitClient({
        url,
        headers: () => ({ authorization: "Bearer host-token" }),
        fetch: (input, init) => {
          const request = new Request(new URL(String(input), "https://example.com"), init);
          requests.push(request);
          return Promise.resolve(
            optionalSchemaTailor.handler(request, {
              authenticate: () => ({ scopes: { org: { tenant: "test" } } }),
            }),
          );
        },
      });

      await expect(client.actions.call({ path: "nested.ping" })).resolves.toEqual({ ping: "pong" });
      expect(requests[0]?.url).toBe(
        "https://example.com/api/tailorkit/actions/call?deployment=test",
      );
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
      expect(requests[0]?.headers.get("content-type")).toContain("application/json");
    },
  );

  it("dispatches nested actions without input or output schemas", async () => {
    const client = createTailorKitClient({
      fetch: (request, init) => {
        const hostRequest = request instanceof Request ? request : new Request(request, init);

        return Promise.resolve(
          optionalSchemaTailor.handler(hostRequest, {
            authenticate: () => ({ scopes: { org: { tenant: "test" } } }),
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
              scopes: { org: { orgId: "org_1" } },
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
            authenticate: () => ({ scopes: { org: { tenant: "test" } } }),
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
      { authenticate: () => ({ scopes: { org: { tenant: "test" } } }) },
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
      { authenticate: () => ({ scopes: { org: { tenant: "test" } } }) },
    );

    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Approve CLI login");
    expect(html).toContain('value="ABC-123-XYZ"');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("redirects unauthenticated CLI approvals to the host sign-in page", async () => {
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
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
      scopes: { org: testScopeSchema, userOrg: testScopeSchema },
      cliAuth: { signInPath: "/admin/sign-in" },
      components: {},
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"),
      {
        authenticate: () => ({
          scopes: { org: { tenant: "test" }, userOrg: { tenant: "user" } },
        }),
      },
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Approve CLI login");
    expect(html).toContain('<form method="post">');
    expect(html).toContain('name="scope" required');
    expect(html).not.toContain('<form method="post" novalidate>');
  });

  it("preserves the scope selection when a CLI approval code is missing", async () => {
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema, userOrg: testScopeSchema },
      components: {},
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ intent: "approve", userCode: "", scope: "userOrg" }),
      }),
      {
        authenticate: () => ({
          scopes: { org: { tenant: "test" }, userOrg: { tenant: "user" } },
        }),
      },
    );

    const html = await response.text();
    expect(html).toContain("Enter the code shown in your terminal.");
    expect(html).toContain('<option value="org">org</option>');
    expect(html).toContain('<option value="userOrg" selected>userOrg</option>');
  });

  it("rejects cross-origin CLI sign-in redirects", async () => {
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
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

  it("rejects host scopes that fail Standard Schema validation before platform access", async () => {
    const server = createTailorKitServer({
      cliAuth: { signInPath: "/sign-in" },
      scopes: { org: z.object({ orgId: z.string().min(1) }) },
      components: {},
    });

    await expect(
      server.handler(
        new Request("https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"),
        { authenticate: () => ({ scopes: { org: { orgId: "" } } }) },
      ),
    ).rejects.toThrow(/failed its Standard Schema validation/u);
  });

  it("approves CLI auth from the built-in approval page", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
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
      { authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }) },
    );

    const html = await response.text();
    expect(html).toContain("CLI login approved");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/platform/cli-auth/approve");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
    await expect(requests[0]?.json()).resolves.toEqual({
      scope: { name: "org", value: { orgId: "org_1" } },
      userCode: "ABC-123-XYZ",
    });
  });

  it("uses projectKey as the default platform authorization header", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
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
      { authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }) },
    );

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer project-key");
  });

  it("surfaces rejected project keys during CLI auth start", async () => {
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
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
            authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }),
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
      scopes: { org: testScopeSchema },
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: (request, init) => {
          const platformRequest = request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          if (platformRequest.url.endsWith("/cli-auth/verify-token")) {
            return Promise.resolve(
              Response.json({ scope: { name: "org", value: { orgId: "org_1" } } }),
            );
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
                headers: new Headers([
                  ...new Headers(init?.headers).entries(),
                  ["authorization", "Bearer host-token"],
                ]),
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

    await expect(client.cliAuth.verifyToken({})).resolves.toEqual({
      scope: { name: "org", value: { orgId: "org_1" } },
    });
    await expect(client.apps.list({ page: 1 })).resolves.toEqual({
      items: [],
      pagination: { hasMore: false, page: 1, pageSize: 20 },
    });
    expect(hostRequests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:3000/api/platform/cli-auth/verify-token");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
    expect(requests[1]?.url).toBe("http://localhost:3000/api/platform/cli-auth/verify-token");
    expect(requests[2]?.url).toBe("http://localhost:3000/api/platform/apps/list");
    expect(requests[2]?.headers.get("authorization")).toBe("Bearer host-token");
  });

  it("attaches the validated CLI deploy token scope when creating platform apps", async () => {
    const requests: Request[] = [];
    const hostRequests: Request[] = [];
    const server = createTailorKitServer({
      scopes: { org: testScopeSchema },
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        platformFetch: (request, init) => {
          const platformRequest = request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          if (platformRequest.url.endsWith("/cli-auth/verify-token")) {
            return Promise.resolve(
              Response.json({ scope: { name: "org", value: { orgId: "org_1" } } }),
            );
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
                headers: new Headers([
                  ...new Headers(init?.headers).entries(),
                  ["authorization", "Bearer cli-token"],
                ]),
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
      scope: { name: "org", value: { orgId: "org_1" } },
    });
  });

  it("accepts a CLI token containing a transformed scope output", async () => {
    const platformBodies: unknown[] = [];
    const server = createTailorKitServer({
      scopes: {
        org: z.object({ raw: z.string() }).transform(({ raw }) => ({ canonical: raw.trim() })),
      },
      components: {},
      $internal: {
        platformFetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          if (request.url.endsWith("/cli-auth/verify-token")) {
            return Response.json({ scope: { name: "org", value: { canonical: "org_1" } } });
          }
          platformBodies.push(await request.json());
          return Response.json({ id: "app_1" });
        },
      },
    });
    const client = createTailorKitClient({
      fetch: (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        request.headers.set("authorization", "Bearer cli-token");
        return Promise.resolve(server.handler(request, { authenticate: () => null }));
      },
      url: "https://example.com/api/tailorkit",
    });
    await expect(client.apps.create({ name: "Calendar", description: null })).resolves.toEqual({
      id: "app_1",
    });
    expect(platformBodies).toEqual([
      {
        name: "Calendar",
        description: null,
        scope: { name: "org", value: { canonical: "org_1" } },
      },
    ]);
  });
});
