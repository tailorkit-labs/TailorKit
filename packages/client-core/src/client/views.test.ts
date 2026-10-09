import { testContract } from "../test-contract";
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

it("joins discovery and resolves single slots from the imported contract without metadata", async () => {
  const discovery = deferredResponse();
  const fetch = vi.fn<typeof globalThis.fetch>(() => discovery.promise);
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test", fetch });
  const contract = testContract();
  const store = createTailorKitStore({ baseUrl: client.baseUrl, client, contract });
  const app = { id: "app", views: [{ slot: "page", path: "/" }] };
  const pending = refetchViews(store, { slot: "page" });
  discovery.resolve(Response.json([app]));
  await pending;
  const result = createSlotStore(client, contract, { apps: [app], slot: "page", activeView: null });
  expect(result.getSnapshot()).toMatchObject({ status: "ready", data: [{ app }] });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL("https://host.test/apps"),
    expect.anything(),
  );
});

it("refreshes instances using the current registered context without refreshing discovery", async () => {
  const instanceFetch = vi.fn().mockResolvedValue([{ key: "overview", metadata: {}, data: {} }]);
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test", fetch: vi.fn() });
  const app = { id: "app", views: [{ slot: "page", path: "/", instances: true as const }] };
  const store = createTailorKitStore({
    baseUrl: client.baseUrl,
    apps: [app],
    client,
    contract: testContract(true),
  });
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
