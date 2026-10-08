import { allTasks } from "nanostores";
import { expect, it, vi } from "vite-plus/test";
import { createTailorKitFetchClient } from "../client/fetch-client";
import { createTailorKitStore } from "./store";
import { createAppsQuery, createAppViewsQuery, createViewsQuery } from "./query";
import type { TailorKitApp } from "../types";

function setup(multiple = true, apps?: TailorKitApp[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test/api/", fetch });
  client.meta().setData(() => ({
    assetsBaseUrl: null,
    schema: {
      version: 1,
      actions: {},
      components: {},
      views: { "/": {} },
      slots: { page: { views: ["/"], multiple } },
    },
  }));
  const store = createTailorKitStore(client.baseUrl, apps, client);
  const app: TailorKitApp = {
    id: "app",
    views: [{ slot: "page", path: "/", ...(multiple ? { instances: true } : {}) }],
  };
  return { fetch, client, store, app };
}

it("starts discovery only when observed and supplies filtered results and shared status flags", async () => {
  const { fetch, store } = setup();
  let resolve!: (response: Response) => void;
  fetch.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const query = createAppsQuery(store, { scopes: ["user"], appIds: ["included"] });
  expect(query.state.get()).toMatchObject({ isPending: true, isLoading: false, data: undefined });
  expect(fetch).not.toHaveBeenCalled();
  const stop = query.state.listen(vi.fn());
  expect(query.state.get()).toMatchObject({ isPending: true, isLoading: true, isFetching: true });
  await Promise.resolve();
  resolve(
    Response.json([
      { id: "included", scope: { name: "user", context: {} } },
      { id: "excluded", scope: { name: "user", context: {} } },
      { id: "other", scope: { name: "organization", context: {} } },
    ]),
  );
  await allTasks();
  expect(query.state.get()).toMatchObject({
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: [{ id: "included" }],
  });
  store.setProvidedApps([]);
  expect(query.state.get().data).toEqual([]);
  await query.refetch();
  expect(fetch).toHaveBeenCalledOnce();
  stop();
});

it("updates single-slot results from provided apps without observing context or resolving instances", async () => {
  const { client, fetch, store, app } = setup(false, []);
  const instances = vi.spyOn(client.endpoints, "slotInstances");
  const query = createViewsQuery(store, { slot: "page" });
  const stop = query.state.listen(vi.fn());
  await allTasks();
  expect(query.state.get().data).toEqual([]);
  store.setProvidedApps([app]);
  await allTasks();
  const ready = query.state.get();
  expect(ready.data).toEqual([{ app }]);
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: undefined, loading: true });
  await Promise.resolve();
  expect(query.state.get()).toBe(ready);
  expect(fetch).not.toHaveBeenCalled();
  expect(instances).not.toHaveBeenCalled();
  stop();
  store.views.unregister(id);
});

it("switches instance queries on context changes and immediately cancels unobserved requests", async () => {
  const { client, store, app } = setup(true, []);
  store.setProvidedApps([app]);
  const requests: {
    signal: AbortSignal;
    resolve: (value: { key: string; metadata: {}; data: {} }[]) => void;
  }[] = [];
  vi.spyOn(client.endpoints, "slotInstances").mockImplementation(
    (_app, _input, signal) =>
      new Promise((resolve) => {
        requests.push({ signal, resolve });
      }),
  );
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: { customer: "first" } });
  await Promise.resolve();
  const query = createViewsQuery(store, { slot: "page" });
  const stop = query.state.listen(vi.fn());
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  store.views.register({ id, view: "/", context: { customer: "second" } });
  await Promise.resolve();
  expect(requests[0]?.signal.aborted).toBe(true);
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(query.state.get().data).toBeUndefined();
  requests[1]?.resolve([{ key: "second", metadata: {}, data: {} }]);
  await vi.waitFor(() => expect(query.state.get().data?.[0]).toMatchObject({ key: "second", app }));
  requests[0]?.resolve([{ key: "late", metadata: {}, data: {} }]);
  await allTasks();
  expect(query.state.get().data?.[0]).toMatchObject({ key: "second" });
  const pending = query.refetch();
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  stop();
  expect(requests[2]?.signal.aborted).toBe(true);
  requests[2]?.resolve([{ key: "stopped", metadata: {}, data: {} }]);
  await pending;
  store.views.unregister(id);
});

it("refetches an unobserved explicit app with the latest registered context without discovery", async () => {
  const { client, fetch, store, app } = setup();
  const instances = vi.spyOn(client.endpoints, "slotInstances").mockResolvedValue([]);
  const query = createAppViewsQuery(store, app, "page");
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: { customer: "latest" } });
  await Promise.resolve();
  await query.refetch();
  expect(instances).toHaveBeenCalledWith(
    app,
    expect.objectContaining({ context: { customer: "latest" } }),
    expect.any(AbortSignal),
  );
  expect(fetch).not.toHaveBeenCalled();
  store.views.unregister(id);
});
