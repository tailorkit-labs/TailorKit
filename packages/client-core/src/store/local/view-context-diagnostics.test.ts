import { afterEach, expect, it, vi } from "vite-plus/test";
import type { TailorKitSchemaSpecType } from "@tailorkit/core/spec";
import { createTailorKitFetchClient } from "../../client/fetch-client";
import { createViewContextStore } from "./view-context";

const requiredContext = {
  context: {
    type: "object",
    properties: {
      customer: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    required: ["customer"],
  },
};
function setup(definition: TailorKitSchemaSpecType["views"][string] = requiredContext) {
  const schema: TailorKitSchemaSpecType = {
    version: 1,
    actions: {},
    components: {},
    slots: {},
    views: { "/": definition },
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ schema }));
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test", fetch });
  const metadata = client.meta();
  metadata.setData(() => ({ assetsBaseUrl: null, schema }));
  const store = createViewContextStore(client);
  return { client, store, metadata, schema, fetch };
}
afterEach(() => vi.restoreAllMocks());

it("logs missing required context once across updates and synchronous cleanup/remount", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup();
  const id = Symbol("view");
  const entry = { id, view: "/", context: undefined };
  store.register(entry);
  store.unregister(id);
  store.register(entry);
  store.register({ ...entry, loading: false, error: null });
  await Promise.resolve();
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('view "/" is ready without its required context'),
  );
  store.register({ ...entry, context: { customer: { id: "c1" } } });
  store.register(entry);
  expect(error).toHaveBeenCalledTimes(2);
  store.unregister(id);
  await Promise.resolve();
});

it.each([{}, { contextOptional: false }, { ...requiredContext, contextOptional: true }])(
  "allows undefined context when no schema requires it: %j",
  async (definition) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = setup(definition);
    const id = Symbol("view");
    store.register({ id, view: "/", context: undefined });
    await Promise.resolve();
    expect(store.state.get()?.layers).toEqual([{ path: "/", context: undefined, status: "ready" }]);
    expect(error).not.toHaveBeenCalled();
    store.unregister(id);
    await Promise.resolve();
  },
);

it("skips ignored query data and lets errors take precedence over loading", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup();
  const id = Symbol("view");
  store.register({ id, view: "/", context: { customer: { id: 123 } }, loading: true });
  await Promise.resolve();
  expect(store.state.get()?.layers).toEqual([{ path: "/", context: undefined, status: "loading" }]);
  store.register({ id, view: "/", context: {}, loading: true, error: new Error("Failed") });
  await Promise.resolve();
  expect(store.state.get()?.layers).toEqual([{ path: "/", context: undefined, status: "error" }]);
  expect(error).not.toHaveBeenCalled();
  store.unregister(id);
  await Promise.resolve();
});

it("reports issue paths without transforming context or changing the ready state", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup();
  const id = Symbol("view");
  const context = { customer: { id: 123 } };
  store.register({ id, view: "/", context });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("does not match the view's schema"),
    expect.arrayContaining([expect.objectContaining({ path: ["customer", "id"] })]),
  );
  await Promise.resolve();
  const snapshot = store.state.get();
  const listener = vi.fn();
  const stop = store.state.listen(listener);
  expect(snapshot?.layers[0]?.context).toBe(context);
  expect(snapshot?.layers[0]?.status).toBe("ready");
  store.register({ id, view: "/", context: { customer: { id: 123 } } });
  await Promise.resolve();
  expect(store.state.get()).toBe(snapshot);
  expect(listener).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledOnce();
  store.register({ id, view: "/", context: { customer: { id: 456 } } });
  expect(error).toHaveBeenCalledTimes(2);
  stop();
  store.unregister(id);
  await Promise.resolve();
});

const userContext = {
  context: {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
        additionalProperties: false,
      },
    },
    required: ["user"],
    additionalProperties: false,
  },
};

it("publishes only declared user fields without logging errors or mutating the session", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup(userContext);
  const id = Symbol("view");
  const context = {
    user: { id: "u1", name: "Alfie", email: "a@example.com", emailVerified: true },
  };
  store.register({ id, view: "/", context });
  await Promise.resolve();
  expect(store.getSnapshot()?.layers).toEqual([
    { path: "/", status: "ready", context: { user: { id: "u1", name: "Alfie" } } },
  ]);
  expect(context.user.email).toBe("a@example.com");
  expect(error).not.toHaveBeenCalled();
  store.unregister(id);
  await Promise.resolve();
});

it("strips delayed metadata and reprocesses original input when schema fields change", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store, metadata, schema } = setup({});
  const id = Symbol("view");
  const context = { user: { id: "u1", name: "Alfie", email: "a@example.com" } };
  store.register({ id, view: "/", context });
  await Promise.resolve();
  expect(store.getSnapshot()?.layers[0]?.context).toBe(context);
  metadata.setData(() => ({
    assetsBaseUrl: null,
    schema: { ...schema, views: { "/": userContext } },
  }));
  await Promise.resolve();
  expect(store.getSnapshot()?.layers[0]?.context).toEqual({ user: { id: "u1", name: "Alfie" } });
  metadata.setData(() => ({
    assetsBaseUrl: null,
    schema: {
      ...schema,
      views: {
        "/": {
          context: {
            ...userContext.context,
            properties: {
              user: {
                ...userContext.context.properties.user,
                properties: { id: { type: "string" }, email: { type: "string" } },
                required: ["id", "email"],
              },
            },
          },
        },
      },
    },
  }));
  await Promise.resolve();
  expect(store.getSnapshot()?.layers[0]?.context).toEqual({
    user: { id: "u1", email: "a@example.com" },
  });
  expect(error).not.toHaveBeenCalled();
  store.unregister(id);
  await Promise.resolve();
});

it.each([null, [], "invalid", 123])("reports non-object context: %j", async (context) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup();
  const id = Symbol("view");
  store.register({ id, view: "/", context });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("requires an object context"),
  );
  store.unregister(id);
  await Promise.resolve();
});

it("reports unsupported schema validation separately from a context mismatch", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup({ context: { type: "object", not: { required: ["customer"] } } });
  const id = Symbol("view");
  store.register({ id, view: "/", context: {} });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("could not validate context"),
    expect.any(Error),
  );
  store.unregister(id);
  await Promise.resolve();
});

it("distinguishes optional undefined context from invalid null context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store } = setup({ ...requiredContext, contextOptional: true });
  const id = Symbol("view");
  store.register({ id, view: "/", context: undefined });
  store.register({ id, view: "/", context: null });
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("requires an object context"),
  );
  store.unregister(id);
  await Promise.resolve();
});

it("validates the latest registrations when delayed metadata arrives", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store, client, schema, fetch } = setup();
  client.clear();
  let respond!: (response: Response) => void;
  fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const id = Symbol("view");
  store.register({ id, view: "/", context: undefined });
  await Promise.resolve();
  store.register({ id, view: "/", context: { customer: { id: 123 } } });
  expect(error).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(respond).toBeTypeOf("function"));
  respond(Response.json({ schema }));
  await client.meta().fetch();
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("does not match the view's schema"),
    expect.arrayContaining([expect.objectContaining({ path: ["customer", "id"] })]),
  );
  expect(fetch).toHaveBeenCalledOnce();
  store.unregister(id);
  await Promise.resolve();
});

it("revalidates metadata refreshes and stops observing after the last unregister", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { client, schema, metadata } = setup({ context: { type: "object" } });
  const originalSubscribe = metadata.subscribe;
  const stop = vi.fn();
  vi.spyOn(metadata, "subscribe").mockImplementation((listener) => {
    const unsubscribe = originalSubscribe(listener);
    return () => {
      stop();
      unsubscribe();
    };
  });
  vi.spyOn(client, "meta").mockReturnValue(metadata);
  const store = createViewContextStore(client);
  const id = Symbol("view");
  store.register({ id, view: "/", context: {} });
  expect(error).not.toHaveBeenCalled();
  metadata.setData(() => ({
    assetsBaseUrl: null,
    schema: { ...schema, views: { "/": requiredContext } },
  }));
  expect(error).toHaveBeenCalledOnce();
  store.unregister(id);
  expect(stop).toHaveBeenCalledOnce();
  metadata.setData(() => ({ assetsBaseUrl: null, schema }));
  await Promise.resolve();
  expect(error).toHaveBeenCalledOnce();
});

it("does not fetch metadata when registration is removed before the scheduled request", async () => {
  const { store, client, fetch } = setup();
  client.clear();
  const id = Symbol("view");
  store.register({ id, view: "/", context: undefined, loading: true });
  store.unregister(id);
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(store.state.get()).toBeNull();
});
