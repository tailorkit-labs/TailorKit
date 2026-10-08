import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTailorKitStore } from "@tailorkit/client-core";
import { createTailorKitServer } from "@tailorkit/core/server";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { TailorRootContext } from "../components/context";
import { createTailorKitClient } from "../tailorkit";
import type { ViewState } from "../hooks/use-view-context";

const contextSchema: StandardSchemaV1<unknown, Record<string, unknown> | undefined> &
  StandardJSONSchemaV1<unknown, Record<string, unknown> | undefined> = {
  "~standard": {
    version: 1,
    vendor: "test",
    jsonSchema: { input: () => ({}), output: () => ({}) },
    validate: () => ({ value: {} }),
  },
};
const server = createTailorKitServer({
  scopes: { user: contextSchema },
  components: {},
  views: { "/": contextSchema },
});
type Options = ViewState<{ "/": typeof contextSchema }, "/">;

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ schema: server.$internal.schema.serialize() }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(definition?: TailorKitSchemaSpecType["views"][string]) {
  const client = createTailorKitClient<typeof server>({ baseUrl: "https://host.test" });
  const store = createTailorKitStore(client.baseUrl, [], client.fetchClient);
  if (definition) {
    const schema = server.$internal.schema.serialize();
    schema.views["/"] = definition;
    store.client.meta().setData(() => ({ schema, assetsBaseUrl: null }));
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <TailorRootContext.Provider value={{ client, store }}>{children}</TailorRootContext.Provider>
    </StrictMode>
  );
  return { client, store, wrapper };
}

it.each([
  { options: { context: {} }, status: "ready", context: {} },
  { options: { context: undefined }, status: "ready", context: undefined },
  { options: { context: {}, loading: false, error: null }, status: "ready", context: {} },
  { options: { context: {}, loading: true }, status: "loading", context: undefined },
  { options: { context: {}, error: new Error("Failed") }, status: "error", context: undefined },
  {
    options: { context: {}, loading: true, error: new Error("Failed") },
    status: "error",
    context: undefined,
  },
])(
  "registers $status with context $context from query state",
  async ({ options, status, context }) => {
    const { client, store, wrapper } = setup();
    const { unmount } = renderHook(() => client.useViewContext("/", options), { wrapper });
    await waitFor(() =>
      expect(store.views.getSnapshot()).toEqual({
        view: "/",
        layers: [{ path: "/", status, context }],
      }),
    );
    unmount();
    await waitFor(() => expect(store.views.getSnapshot()).toBeNull());
  },
);

it("updates loading, error, and ready context as query results change", async () => {
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<void, Options>((options) => client.useViewContext("/", options), {
    wrapper,
    initialProps: { context: undefined, loading: true },
  });
  await waitFor(() => expect(store.views.getSnapshot()?.layers[0]?.status).toBe("loading"));
  rerender({ context: {}, loading: true, error: new Error("Failed") });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { path: "/", context: undefined, status: "error" },
    ]),
  );
  rerender({ context: {}, error: null });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { path: "/", context: {}, status: "ready" },
    ]),
  );
  rerender({ context: {}, loading: true });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { path: "/", context: undefined, status: "loading" },
    ]),
  );
  rerender({ context: undefined });
  await waitFor(() =>
    expect(store.views.getSnapshot()?.layers).toEqual([
      { path: "/", context: undefined, status: "ready" },
    ]),
  );
});

it("does not republish equivalent context or changes to ignored query data", async () => {
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<void, Options>((options) => client.useViewContext("/", options), {
    wrapper,
    initialProps: { context: {} },
  });
  await waitFor(() => expect(store.views.getSnapshot()?.layers[0]?.status).toBe("ready"));
  const register = vi.spyOn(store.views, "register");
  await act(() => rerender({ context: {}, loading: false, error: null }));
  expect(register).not.toHaveBeenCalled();

  rerender({ context: {}, error: new Error("First failure") });
  await waitFor(() => expect(store.views.getSnapshot()?.layers[0]?.status).toBe("error"));
  register.mockClear();
  await act(() =>
    rerender({ context: undefined, loading: true, error: new Error("Second failure") }),
  );
  expect(register).not.toHaveBeenCalled();
});

const requiredContext = {
  context: {
    type: "object",
    properties: {
      customer: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    required: ["customer"],
  },
};

it("reports missing ready context once, then again after recovery", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { client, wrapper } = setup(requiredContext);
  const { rerender } = renderHook<void, Options>((options) => client.useViewContext("/", options), {
    wrapper,
    initialProps: { context: undefined },
  });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('useViewContext("/") is ready without its required context'),
  );
  await act(() => rerender({ context: undefined, loading: false, error: null }));
  expect(error).toHaveBeenCalledOnce();
  await act(() => rerender({ context: { customer: { id: "c1" } } }));
  expect(error).toHaveBeenCalledOnce();
  await act(() => rerender({ context: undefined }));
  expect(error).toHaveBeenCalledTimes(2);
});

it.each([{}, { contextOptional: false }])(
  "allows ready undefined context when the view has no context schema: %j",
  async (definition) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, store, wrapper } = setup(definition);
    const { rerender } = renderHook<void, Options>(
      (options) => client.useViewContext("/", options),
      {
        wrapper,
        initialProps: { context: undefined },
      },
    );
    await waitFor(() =>
      expect(store.views.getSnapshot()?.layers).toEqual([
        { path: "/", context: undefined, status: "ready" },
      ]),
    );
    await act(() => rerender({ context: undefined, loading: false }));
    expect(error).not.toHaveBeenCalled();
  },
);

it("allows optional undefined context and skips validation during loading or explicit errors", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { client, wrapper } = setup({ ...requiredContext, contextOptional: true });
  const { rerender } = renderHook<void, Options>((options) => client.useViewContext("/", options), {
    wrapper,
    initialProps: { context: undefined },
  });
  await act(() => rerender({ context: { customer: { id: 123 } }, loading: true }));
  await act(() => rerender({ context: {}, error: new Error("Query failed") }));
  await act(() => rerender({ context: undefined }));
  expect(error).not.toHaveBeenCalled();
});

it("reports schema issue paths without mutating context or changing the registered state", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { client, store, wrapper } = setup(requiredContext);
  const context = { customer: { id: 123 } };
  const { rerender } = renderHook<void, Options>((options) => client.useViewContext("/", options), {
    wrapper,
    initialProps: { context },
  });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("does not match the view's schema"),
    expect.arrayContaining([expect.objectContaining({ path: ["customer", "id"] })]),
  );
  await waitFor(() => expect(store.views.getSnapshot()?.layers[0]?.context).toBe(context));
  expect(store.views.getSnapshot()?.layers[0]?.status).toBe("ready");
  await act(() => rerender({ context: { customer: { id: 123 } } }));
  expect(error).toHaveBeenCalledOnce();
  await act(() => rerender({ context: { customer: { id: 456 } } }));
  expect(error).toHaveBeenCalledTimes(2);
});

it.each([null, [], "invalid", 123])("reports non-object ready context: %j", async (context) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { client, wrapper } = setup(requiredContext);
  renderHook(
    () => {
      // @ts-expect-error Exercise invalid context from untyped JavaScript callers.
      client.useViewContext("/", { context });
    },
    { wrapper },
  );
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("requires an object context"),
  );
});

it("reports unavailable schema validation separately from an invalid context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { client, wrapper } = setup({
    context: { type: "object", not: { required: ["customer"] } },
  });
  renderHook(() => client.useViewContext("/", { context: {} }), { wrapper });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("could not validate context"),
    expect.any(Error),
  );
});

it("validates after metadata arrives using the current context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  let respond!: (response: Response) => void;
  vi.mocked(globalThis.fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const { client, store, wrapper } = setup();
  const { rerender } = renderHook<void, Options>((options) => client.useViewContext("/", options), {
    wrapper,
    initialProps: { context: undefined },
  });
  expect(error).not.toHaveBeenCalled();
  await act(() => rerender({ context: { customer: { id: 123 } } }));
  const schema = server.$internal.schema.serialize();
  schema.views["/"] = requiredContext;
  await act(async () => {
    respond(Response.json({ schema }));
    await store.fetchMeta();
  });
  await waitFor(() =>
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("does not match the view's schema"),
      expect.arrayContaining([expect.objectContaining({ path: ["customer", "id"] })]),
    ),
  );
});
