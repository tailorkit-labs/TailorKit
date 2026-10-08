import { expect, it, vi } from "vite-plus/test";
import { createTailorKitFetchClient } from "./fetch-client";
import { createTailorKitStore } from "../store/store";
import { createSlotStore } from "../store/fetch/slot";
import { refetchViews } from "./views";

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("joins discovery and the normalized single-slot query when delayed metadata arrives", async () => {
  const discovery = deferredResponse();
  const metadata = deferredResponse();
  const fetch = vi.fn<typeof globalThis.fetch>((input) =>
    String(input).endsWith("/apps") ? discovery.promise : metadata.promise,
  );
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test", fetch });
  const store = createTailorKitStore(client.baseUrl, undefined, client);
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: {} });
  await Promise.resolve();
  const app = { id: "app", views: [{ slot: "page", path: "/" }] };
  let settled = false;
  const pending = refetchViews(store, { slot: "page" }).then(() => {
    settled = true;
  });
  discovery.resolve(Response.json([app]));
  await vi.waitFor(() => expect(store.getAppsSnapshot().status).toBe("ready"));
  expect(settled).toBe(false);
  metadata.resolve(
    Response.json({
      schema: { views: { "/": {} }, slots: { page: { views: ["/"], multiple: false } } },
    }),
  );
  await pending;
  const result = createSlotStore(client, { apps: [app], slot: "page", activeView: null });
  expect(result.getSnapshot()).toMatchObject({ status: "ready", data: [{ app }] });
  expect(fetch).toHaveBeenCalledTimes(2);
  store.views.unregister(id);
  await Promise.resolve();
});

it("refreshes instances using the current registered context without refreshing discovery", async () => {
  const instanceFetch = vi.fn().mockResolvedValue([{ key: "overview", metadata: {}, data: {} }]);
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test", fetch: vi.fn() });
  const app = { id: "app", views: [{ slot: "page", path: "/", instances: true as const }] };
  const store = createTailorKitStore(client.baseUrl, [app], client);
  client.meta().setData(() => ({
    assetsBaseUrl: null,
    schema: {
      version: 1,
      actions: {},
      components: {},
      views: { "/": {} },
      slots: { page: { views: ["/"], multiple: true } },
    },
  }));
  const apps = vi.spyOn(store, "fetchApps");
  vi.spyOn(client.endpoints, "slotInstances").mockImplementation(instanceFetch);
  const id = Symbol("view");
  store.views.register({ id, view: "/", context: { customer: "first" } });
  await Promise.resolve();
  await refetchViews(store, { slot: "page" });
  store.views.register({ id, view: "/", context: { customer: "second" } });
  await Promise.resolve();
  await refetchViews(store, { slot: "page" });
  expect(instanceFetch.mock.calls.map(([, input]) => input.context)).toEqual([
    { customer: "first" },
    { customer: "second" },
  ]);
  expect(apps).not.toHaveBeenCalled();
  store.views.unregister(id);
  await Promise.resolve();
});
