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
  const listener = vi.fn();
  const stop = store.views.state.listen(listener);
  const snapshot = store.views.getSnapshot();
  await act(() => rerender({ context: {}, loading: false, error: null }));
  expect(listener).not.toHaveBeenCalled();
  expect(store.views.getSnapshot()).toBe(snapshot);

  rerender({ context: {}, error: new Error("First failure") });
  await waitFor(() => expect(store.views.getSnapshot()?.layers[0]?.status).toBe("error"));
  listener.mockClear();
  const errorSnapshot = store.views.getSnapshot();
  await act(() =>
    rerender({ context: undefined, loading: true, error: new Error("Second failure") }),
  );
  expect(listener).not.toHaveBeenCalled();
  expect(store.views.getSnapshot()).toBe(errorSnapshot);
  stop();
});
