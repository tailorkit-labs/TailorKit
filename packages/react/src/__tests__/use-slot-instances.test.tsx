import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTailorKitServer } from "@tailorkit/core/server";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { Root, createTailorKitClient } from "../index";
import type { TailorKitApp } from "../index";

const schema = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: () => ({ value: {} }),
  },
};
const server = createTailorKitServer({
  scopes: { user: schema },
  components: {},
  views: { "/": schema, "/customers": schema, "/customers/detail": schema },
  slots: {
    page: { views: ["/", "/customers", "/customers/detail"], multiple: true },
    panel: { views: ["/"], multiple: true },
  },
});
const client = createTailorKitClient<typeof server>({
  baseUrl: "https://host.test/api/tailorkit/",
});
const app: TailorKitApp = {
  id: "app_1",
  currentDeployment: { id: "deployment_1" },
  views: [
    { slot: "page", path: "/", instances: true },
    { slot: "page", path: "/customers/detail", instances: true },
  ],
};
const instances = [{ key: "overview", metadata: { title: "Overview" }, data: { reportId: "r1" } }];
let apps: TailorKitApp[] | undefined;
const wrapper = ({ children }: { children: ReactNode }) => (
  <Root client={client} apps={apps}>
    {children}
  </Root>
);
function withApp(instances: { key: string; metadata: object; data: object }[], source = app) {
  return instances.map((instance) => ({ ...instance, app: source }));
}

function url(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : String(input));
}

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = url(input).pathname;
    if (path.endsWith("/apps")) return Response.json([app]);
    if (path.endsWith("/meta"))
      return Response.json({ schema: server.$internal.schema.serialize() });
    if (path.endsWith("/backend/session")) {
      return Response.json({
        token: "app-token",
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      });
    }
    if (path.endsWith("/actions")) return Response.json({ json: instances });
    throw new Error(`Unexpected request: ${path}`);
  });
}

function calls(path: string) {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => url(input).pathname.endsWith(path));
}

beforeEach(() => {
  apps = [app];
  mockFetch();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function useDetail(status: "ready" | "loading" | "error" = "ready", userId = "u1") {
  client.useRegisterView("/", { context: { user: { id: userId } } });
  client.useRegisterView("/customers", { context: { canEdit: true } });
  client.useRegisterView(
    "/customers/detail",
    status === "ready" ? { context: { customer: { id: "c1" } } } : { status },
  );
}

it("fetches the matched view's instances over authenticated HTTP with combined context", async () => {
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual(withApp(instances));
  expect(calls("/meta")).toHaveLength(1);
  expect(calls("/backend/session")[0]?.[1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ appId: "app_1" }),
  });
  const [, options] = calls("/actions")[0]!;
  expect(new Headers(options?.headers).get("authorization")).toBe("Bearer app-token");
  expect(JSON.parse(String(options?.body))).toEqual({
    json: {
      name: "_tailorkit.instances.resolve",
      args: {
        slot: "page",
        path: "/customers/detail",
        context: { user: { id: "u1" }, canEdit: true, customer: { id: "c1" } },
      },
    },
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(3);
});

it("uses the closest supported ancestor and excludes deeper loading context", async () => {
  apps = [{ ...app, views: [{ slot: "panel", path: "/", instances: true }] }];
  const { result } = renderHook(
    () => {
      useDetail("loading");
      return client.useSlotInstances({ slot: "panel" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances, apps![0]!)));
  expect(JSON.parse(String(calls("/actions")[0]?.[1]?.body)).json.args).toEqual({
    slot: "panel",
    path: "/",
    context: { user: { id: "u1" } },
  });
});

it("waits for every required ancestor before fetching instances", async () => {
  const { result, rerender } = renderHook(
    ({ ready }) => {
      client.useRegisterView(
        "/",
        ready ? { context: { user: { id: "u1" } } } : { status: "loading" },
      );
      client.useRegisterView("/customers", { context: { canEdit: true } });
      client.useRegisterView("/customers/detail", { context: { customer: { id: "c1" } } });
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper, initialProps: { ready: false } },
  );
  await waitFor(() => expect(calls("/meta")).toHaveLength(1));
  expect(result.current.isPending).toBe(true);
  expect(result.current.data).toBeUndefined();
  expect(calls("/backend/session")).toHaveLength(0);
  expect(calls("/actions")).toHaveLength(0);
  rerender({ ready: true });
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances)));
});

it.each(["missing", "error", "invalid", "duplicate"] as const)(
  "exposes %s ancestor context as an error without calling the resolver",
  async (kind) => {
    const { result } = renderHook(
      () => {
        if (kind !== "missing")
          client.useRegisterView(
            "/",
            kind === "error"
              ? { status: "error" }
              : { context: kind === "invalid" ? null : { user: { id: "u1" } } },
          );
        client.useRegisterView("/customers", {
          context: kind === "duplicate" ? { user: { id: "another" } } : { canEdit: true },
        });
        client.useRegisterView("/customers/detail", { context: { customer: { id: "c1" } } });
        return client.useSlotInstances({ slot: "page" });
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  },
);

it.each([false, undefined] as const)(
  "rejects discovered instances when the host slot multiple flag is %s",
  async (multiple) => {
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      if (url(input).pathname.endsWith("/meta")) {
        const serialized = server.$internal.schema.serialize();
        serialized.slots.page = {
          views: serialized.slots.page!.views,
          ...(multiple === undefined ? {} : { multiple }),
        };
        return Response.json({ schema: serialized });
      }
      return original(input, options);
    });
    const { result } = renderHook(
      () => {
        useDetail();
        return client.useSlotInstances({ slot: "page" });
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Slot "page" does not support instances.');
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  },
);

it("stays idle without a registered view and makes no requests", () => {
  const { result } = renderHook(() => client.useSlotInstances({ slot: "page" }), { wrapper });
  expect(result.current.status).toBe("idle");
  expect(result.current.isPending).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each(["static", "disabled", "unsupported", "legacy"] as const)(
  "returns an empty list for %s views without requesting instances",
  async (kind) => {
    const views =
      kind === "legacy"
        ? undefined
        : [
            { slot: "page", path: "/", instances: true as const },
            {
              slot: "page",
              path: "/customers/detail",
              ...(kind === "static" ? {} : { disabled: true as const }),
            },
          ];
    apps = [{ ...app, views }];
    const { result } = renderHook(
      () => {
        useDetail();
        return client.useSlotInstances({
          slot: kind === "unsupported" ? "panel" : "page",
        });
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(calls("/backend/session")).toHaveLength(0);
    expect(calls("/actions")).toHaveLength(0);
  },
);

it("does not refetch for equivalent inline objects and refetch refreshes instances", async () => {
  const { result, rerender } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  rerender();
  expect(calls("/actions")).toHaveLength(1);
  await act(() => result.current.refetch());
  expect(result.current.data).toEqual(withApp(instances));
  expect(calls("/actions")).toHaveLength(2);
  expect(calls("/backend/session")).toHaveLength(1);
  expect(calls("/meta")).toHaveLength(1);
});

it("clears previous data and ignores late responses after context changes", async () => {
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/actions")
      ? new Promise((resolve) => pending.push({ resolve, signal: options?.signal }))
      : original(input, options),
  );
  const { result, rerender, unmount } = renderHook(
    ({ userId }) => {
      useDetail("ready", userId);
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper, initialProps: { userId: "u1" } },
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  rerender({ userId: "u2" });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0]?.signal?.aborted).toBe(true);
  await act(async () => pending[0]!.resolve(Response.json({ json: instances })));
  expect(result.current.data).toBeUndefined();
  expect(result.current.isPending).toBe(true);
  const fresh = [{ key: "fresh", metadata: {}, data: { userId: "u2" } }];
  await act(async () => pending[1]!.resolve(Response.json({ json: fresh })));
  expect(result.current.data).toEqual(withApp(fresh));
  rerender({ userId: "u3" });
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(result.current.data).toBeUndefined();
  unmount();
  expect(pending[2]?.signal?.aborted).toBe(true);
  await act(async () => pending[2]!.resolve(Response.json({ json: instances })));
});

it("exposes resolver errors and allows retry through refetch", async () => {
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/actions"))
      return Response.json(
        { json: { code: "FORBIDDEN", message: "Reports unavailable", defined: false } },
        { status: 403 },
      );
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.error?.message).toBe("Reports unavailable"));
  expect(result.current.isError).toBe(true);
  fail = false;
  await act(() => result.current.refetch());
  expect(result.current.data).toEqual(withApp(instances));
  expect(result.current.error).toBeNull();
});

it("retries failed metadata without authorizing an app before matching", async () => {
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/meta")) return new Response(null, { status: 503 });
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(calls("/backend/session")).toHaveLength(0);
  fail = false;
  await act(() => result.current.refetch());
  expect(result.current.data).toEqual(withApp(instances));
  expect(calls("/meta")).toHaveLength(2);
});

it("exposes session failures without sending an unauthenticated resolver call", async () => {
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) =>
    url(input).pathname.endsWith("/backend/session")
      ? new Response(null, { status: 401 })
      : original(input, options),
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toMatchObject({ code: "UNAUTHORIZED" });
  expect(calls("/actions")).toHaveLength(0);
});

it("reauthorizes when the discovered app or deployment changes", async () => {
  const { result, rerender } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  apps = [{ ...app, currentDeployment: { id: "deployment_2" } }];
  rerender();
  await waitFor(() => expect(calls("/actions")).toHaveLength(2));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  apps = [{ ...app, id: "app_2", currentDeployment: { id: "deployment_3" } }];
  rerender();
  await waitFor(() =>
    expect(result.current.isSuccess && calls("/actions").length === 3).toBe(true),
  );
  expect(calls("/backend/session")).toHaveLength(3);
  expect(JSON.parse(String(calls("/backend/session")[2]?.[1]?.body))).toEqual({ appId: "app_2" });
  expect(result.current.data?.[0]?.app).toEqual(apps[0]);
});

it("works in Strict Mode and isolates different roots", async () => {
  const strictWrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <Root client={client} apps={apps}>
        {children}
      </Root>
    </StrictMode>
  );
  const first = renderHook(
    () => {
      useDetail("ready", "u1");
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper: strictWrapper },
  );
  const second = renderHook(
    () => {
      useDetail("ready", "u2");
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper: strictWrapper },
  );
  await waitFor(() =>
    expect(first.result.current.isSuccess && second.result.current.isSuccess).toBe(true),
  );
  const users = calls("/actions")
    .map(([, options]) => JSON.parse(String(options?.body)).json.args.context.user.id)
    .sort();
  expect(users).toEqual(["u1", "u2"]);
});

it("rejects a hook used outside Root or under another client", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => client.useSlotInstances({ slot: "page" }))).toThrow(
    "useSlotInstances must be rendered inside Root",
  );
  const other = createTailorKitClient({ baseUrl: "https://other.test/api/" });
  const wrongWrapper = ({ children }: { children: ReactNode }) => (
    <Root client={other}>{children}</Root>
  );
  expect(() =>
    renderHook(() => client.useSlotInstances({ slot: "page" }), { wrapper: wrongWrapper }),
  ).toThrow("useSlotInstances was created for a different TailorKit client");
});

it("discovers apps through useApps before resolving their instances", async () => {
  apps = undefined;
  let finishApps!: (response: Response) => void;
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/apps")
      ? new Promise((resolve) => {
          finishApps = resolve;
        })
      : original(input, options),
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(calls("/apps")).toHaveLength(1));
  expect(result.current.isLoading).toBe(true);
  expect(calls("/backend/session")).toHaveLength(0);
  await act(async () => finishApps(Response.json([app])));
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances)));
});

it("aggregates apps in discovery order, resolves in parallel, and preserves duplicate keys", async () => {
  const second = {
    ...app,
    id: "app_2",
    views: [{ slot: "page", path: "/", instances: true as const }],
  };
  apps = [app, second, { id: "static", views: [{ slot: "page", path: "/" }] }];
  const pending: { token: string | null; body: string; resolve: (response: Response) => void }[] =
    [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (url(input).pathname.endsWith("/backend/session")) {
      const { appId } = JSON.parse(String(options?.body));
      return Response.json({
        token: appId,
        expiresAt: Date.now() + 300_000,
        url: "https://runtime.test/rpc",
      });
    }
    if (url(input).pathname.endsWith("/actions"))
      return new Promise((resolve) =>
        pending.push({
          token: new Headers(options?.headers).get("authorization"),
          body: String(options?.body),
          resolve,
        }),
      );
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending.map(({ token }) => token)).toEqual(["Bearer app_1", "Bearer app_2"]);
  expect(pending.map(({ body }) => JSON.parse(body).json.args.path)).toEqual([
    "/customers/detail",
    "/",
  ]);
  await act(async () => pending[1]!.resolve(Response.json({ json: instances })));
  expect(result.current.isLoading).toBe(true);
  expect(result.current.data).toBeUndefined();
  await act(async () => pending[0]!.resolve(Response.json({ json: instances })));
  expect(result.current.data).toEqual([...withApp(instances), ...withApp(instances, second)]);
  expect(calls("/meta")).toHaveLength(1);
});

it("returns an empty result when there are no discovered apps", async () => {
  apps = [];
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.data).toEqual([]));
  expect(result.current.isSuccess).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("exposes app discovery failures and retries them through refetch", async () => {
  apps = undefined;
  let fail = true;
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
    if (fail && url(input).pathname.endsWith("/apps")) return new Response(null, { status: 503 });
    return original(input, options);
  });
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toContain("Unable to fetch TailorKit apps");
  expect(calls("/actions")).toHaveLength(0);
  fail = false;
  await act(() => result.current.refetch());
  await waitFor(() => expect(result.current.data).toEqual(withApp(instances)));
  expect(calls("/apps")).toHaveLength(2);
});

it("cancels every app resolver and ignores late results when the app list changes", async () => {
  const second = { ...app, id: "app_2" };
  apps = [app, second];
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/actions")
      ? new Promise((resolve) => pending.push({ resolve, signal: options?.signal }))
      : original(input, options),
  );
  const { result, rerender, unmount } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  apps = [second];
  rerender();
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(pending.slice(0, 2).every(({ signal }) => signal?.aborted)).toBe(true);
  await act(async () => {
    for (const request of pending.slice(0, 2)) request.resolve(Response.json({ json: instances }));
  });
  expect(result.current.data).toBeUndefined();
  await act(async () => pending[2]!.resolve(Response.json({ json: instances })));
  expect(result.current.data).toEqual(withApp(instances, second));
  await act(() => {
    void result.current.refetch();
  });
  await waitFor(() => expect(pending).toHaveLength(4));
  unmount();
  expect(pending[3]?.signal?.aborted).toBe(true);
});

it("clears the aggregate and cancels remaining resolvers when any app fails", async () => {
  apps = [app, { ...app, id: "app_2" }];
  const pending: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.mocked(globalThis.fetch).mockImplementation((input, options) =>
    url(input).pathname.endsWith("/actions")
      ? new Promise((resolve) => pending.push({ resolve, signal: options?.signal }))
      : original(input, options),
  );
  const { result } = renderHook(
    () => {
      useDetail();
      return client.useSlotInstances({ slot: "page" });
    },
    { wrapper },
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () =>
    pending[0]!.resolve(
      Response.json(
        { json: { code: "FORBIDDEN", message: "App unavailable", defined: false } },
        { status: 403 },
      ),
    ),
  );
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toBe("App unavailable");
  expect(result.current.data).toBeUndefined();
  expect(pending[1]?.signal?.aborted).toBe(true);
});
