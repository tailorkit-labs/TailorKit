import { allTasks } from "nanostores";
import { expect, it, vi } from "vite-plus/test";
import { createTailorKitFetchClient } from "../../client/fetch-client";
import { createTailorKitStore } from "../store";
import { createSlotRuntime } from "./slot-runtime";
import type { SlotRuntimeOptions } from "./slot-runtime";
import type { TailorKitApp } from "../../types";

function setup(multiple = false) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/api/", fetch });
  client.meta().setData(() => ({
    assetsBaseUrl: "https://assets.test/",
    schema: {
      version: 1,
      actions: {},
      components: {},
      views: { "/": {} },
      slots: { page: { views: ["/"], multiple } },
    },
  }));
  const store = createTailorKitStore(client.baseUrl, [], client);
  const app: TailorKitApp = {
    id: "app",
    projectId: "project",
    currentDeployment: { id: "deployment" },
    views: [{ slot: "page", path: "/", ...(multiple ? { instances: true } : {}) }],
  };
  return { client, store, app, fetch };
}

it("waits for an active managed view and constructs deployment URL and hierarchy props in core", async () => {
  const { client, store, app, fetch } = setup();
  client.clear();
  const runtime = createSlotRuntime(store, { mode: "managed", app, slot: "page" });
  const stop = runtime.state.listen(vi.fn());
  expect(runtime.state.get().status).toBe("hidden");
  expect(fetch).not.toHaveBeenCalled();
  client.meta().setData(() => ({
    assetsBaseUrl: "https://assets.test/",
    schema: {
      version: 1,
      components: {},
      actions: {},
      views: { "/": {} },
      slots: { page: { views: ["/"] } },
    },
  }));
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: { customer: "registered" } });
  await Promise.resolve();
  expect(runtime.state.get()).toMatchObject({
    status: "render",
    appUrl: "https://assets.test/projects/project/apps/app/deployments/deployment/client/client.js",
    props: {
      slot: "page",
      view: "/",
      layers: [{ path: "/", status: "ready", context: { customer: "registered" } }],
      declaredViews: ["/"],
      supportedViews: ["/"],
    },
  });
  const stable = runtime.state.get();
  runtime.setInput({ mode: "managed", app: { ...app }, slot: "page" });
  expect(runtime.state.get()).toBe(stable);
  stop();
  store.views.unregister(id);
});

it("selects instances and validates keys without a framework", async () => {
  const { client, store, app } = setup(true);
  const instance = {
    key: "overview",
    metadata: { title: "Overview" },
    data: { record: "customer" },
  };
  const instances = vi.spyOn(client.endpoints, "slotInstances").mockResolvedValue([instance]);
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: { customer: "registered" } });
  await Promise.resolve();
  const options: SlotRuntimeOptions = {
    mode: "managed",
    app,
    slot: "page",
    instanceKey: "overview",
  };
  const runtime = createSlotRuntime(store, options);
  const stop = runtime.state.listen(vi.fn());
  await allTasks();
  expect(runtime.state.get()).toMatchObject({
    status: "render",
    props: { controlled: true, context: { customer: "registered" }, instance },
  });
  runtime.setInput({ ...options, instanceKey: "missing" });
  expect(runtime.state.get()).toMatchObject({
    status: "error",
    error: expect.objectContaining({ message: 'View instance "missing" is unavailable.' }),
  });
  expect(instances).toHaveBeenCalledOnce();
  stop();
  store.views.unregister(id);
});

it("keeps controlled state independent and removes stale context and instances while loading", async () => {
  const { client, store, app } = setup(true);
  const options: SlotRuntimeOptions = {
    mode: "controlled",
    app,
    slot: "page",
    view: "/",
    context: { supplied: true },
    status: "ready",
    instance: { key: "one", metadata: {}, data: {} },
  };
  const runtime = createSlotRuntime(store, options);
  const instances = vi.spyOn(client.endpoints, "slotInstances");
  const stop = runtime.state.listen(vi.fn());
  const initial = runtime.state.get();
  const id = Symbol("other");
  store.views.register({ id, view: "/", context: { unrelated: true } });
  await Promise.resolve();
  expect(runtime.state.get()).toBe(initial);
  runtime.setInput({ ...options, status: "loading" });
  const snapshot = runtime.state.get();
  expect(snapshot).toMatchObject({
    status: "render",
    props: { status: "loading", context: undefined },
  });
  if (snapshot.status !== "render") throw new Error("Expected render");
  expect(snapshot.props).not.toHaveProperty("instance");
  runtime.setInput({ ...options, instance: undefined });
  expect(runtime.state.get()).toMatchObject({ status: "error" });
  expect(instances).not.toHaveBeenCalled();
  stop();
  store.views.unregister(id);
});

it("updates the session provider when deployment changes behind the same custom client URL", () => {
  const { store, app } = setup();
  const options: SlotRuntimeOptions = {
    mode: "controlled",
    app: { ...app, clientPath: "/client.js" },
    slot: "page",
    view: "/",
    status: "ready",
    context: {},
  };
  const runtime = createSlotRuntime(store, options);
  const initial = runtime.state.get();
  runtime.setInput({ ...options, app: { ...options.app, currentDeployment: { id: "new" } } });
  const updated = runtime.state.get();
  expect(updated).not.toBe(initial);
  if (initial.status !== "render" || updated.status !== "render")
    throw new Error("Expected render");
  expect(updated.appUrl).toBe(initial.appUrl);
  expect(updated.getBackendSession).not.toBe(initial.getBackendSession);
});

it("keeps preview subscriptions across context changes and switches sessions without accepting old source", async () => {
  const { atom, onStop } = await import("nanostores");
  const { store } = setup();
  const first = atom({ revision: 0, source: null as string | null });
  const second = atom({ revision: 0, source: null as string | null });
  const stopped = vi.fn();
  onStop(first, stopped);
  vi.spyOn(store.previews, "getStore").mockImplementation((getApp) =>
    getApp().preview?.sessionId === "first" ? first : second,
  );
  const app: TailorKitApp = {
    id: "preview",
    preview: {
      sessionId: "first",
      token: "token",
      websocketUrl: "wss://preview.test",
      expiresAt: "later",
    },
  };
  const options: SlotRuntimeOptions = {
    mode: "controlled",
    app,
    slot: "page",
    view: "/",
    context: { customer: "first" },
    status: "ready",
  };
  const runtime = createSlotRuntime(store, options);
  const stop = runtime.state.listen(vi.fn());
  expect(runtime.state.get().status).toBe("hidden");
  stopped.mockClear();
  first.set({ revision: 1, source: "export default 1" });
  expect(runtime.state.get()).toMatchObject({
    status: "render",
    hostKey: 1,
    appUrl: "https://host.test/api/preview/first/client.js",
    sourceText: "export default 1",
  });
  runtime.setInput({ ...options, context: { customer: "second" } });
  expect(stopped).not.toHaveBeenCalled();
  expect(first.lc).toBe(1);
  runtime.setInput({
    ...options,
    app: { ...app, preview: { ...app.preview!, sessionId: "second" } },
  });
  expect(stopped).toHaveBeenCalledOnce();
  const switched = runtime.state.get();
  expect(switched.status).toBe("hidden");
  first.set({ revision: 2, source: "stale" });
  expect(runtime.state.get()).toBe(switched);
  second.set({ revision: 3, source: "export default 3" });
  expect(runtime.state.get()).toMatchObject({
    status: "render",
    hostKey: 3,
    appUrl: "https://host.test/api/preview/second/client.js",
    sourceText: "export default 3",
  });
  stop();
  expect(second.lc).toBe(0);
});

it("does not repeatedly retry failed metadata as a side effect of state updates", async () => {
  const { client, store, app, fetch } = setup();
  client.clear();
  fetch.mockRejectedValue(new Error("offline"));
  const runtime = createSlotRuntime(store, {
    mode: "controlled",
    app,
    slot: "page",
    view: "/",
    status: "ready",
    context: {},
  });
  const stop = runtime.state.listen(vi.fn());
  await allTasks();
  expect(fetch).toHaveBeenCalledOnce();
  expect(runtime.state.get().status).toBe("hidden");
  stop();
});

it("cancels an instance request when switching to a controlled slot", async () => {
  const { client, store, app } = setup(true);
  let signal: AbortSignal | undefined;
  let respond!: (instances: []) => void;
  vi.spyOn(client.endpoints, "slotInstances").mockImplementation((_app, _input, abort) => {
    signal = abort;
    return new Promise((resolve) => {
      respond = resolve;
    });
  });
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: {} });
  await Promise.resolve();
  const runtime = createSlotRuntime(store, {
    mode: "managed",
    app,
    slot: "page",
    instanceKey: "one",
  });
  const stop = runtime.state.listen(vi.fn());
  await vi.waitFor(() => expect(signal).toBeDefined());
  runtime.setInput({
    mode: "controlled",
    app,
    slot: "page",
    view: "/",
    status: "ready",
    context: {},
    instance: { key: "two", metadata: {}, data: {} },
  });
  expect(signal?.aborted).toBe(true);
  const controlled = runtime.state.get();
  expect(controlled).toMatchObject({ status: "render", props: { instance: { key: "two" } } });
  respond([]);
  await allTasks();
  expect(runtime.state.get()).toBe(controlled);
  stop();
  store.views.unregister(id);
});
