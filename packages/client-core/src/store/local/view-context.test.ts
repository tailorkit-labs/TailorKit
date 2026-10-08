import { describe, expect, it, vi } from "vite-plus/test";
import { createTailorKitFetchClient } from "../../client/fetch-client";
import { createViewContextStore } from "./view-context";

function createStore() {
  const client = createTailorKitFetchClient({ baseUrl: "https://host.test" });
  client.meta().setData(() => ({
    assetsBaseUrl: null,
    schema: { version: 1, actions: {}, components: {}, slots: {}, views: {} },
  }));
  return createViewContextStore(client);
}

describe("view context store", () => {
  it("publishes nested view registration once after synchronous updates settle", async () => {
    const registry = createStore();
    const parent = Symbol("parent");
    const child = Symbol("child");
    const listener = vi.fn();
    const stop = registry.subscribe(listener);
    registry.register({ id: parent, view: "/home", context: { parent: true } });
    registry.register({
      id: child,
      view: "/home/detail",
      context: { child: true },
      loading: true,
    });
    expect(registry.getSnapshot()).toBeNull();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
    expect(registry.getSnapshot()).toEqual({
      view: "/home/detail",
      layers: [
        { path: "/home", context: { parent: true }, status: "ready" },
        { path: "/home/detail", context: undefined, status: "loading" },
      ],
    });
    expect(registry.state.get()).toBe(registry.getSnapshot());
    registry.unregister(child);
    await Promise.resolve();
    expect(registry.getSnapshot()?.view).toBe("/home");
    registry.unregister(parent);
    await Promise.resolve();
    expect(registry.getSnapshot()).toBeNull();
    stop();
  });

  it("preserves mount order when entries update and isolates registries", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = createStore();
      const other = createStore();
      const first = Symbol("first");
      const last = Symbol("last");
      registry.register({ id: first, view: "/first", context: {} });
      registry.register({ id: last, view: "/last", context: {} });
      registry.register({ id: first, view: "/first", context: { updated: true } });
      await Promise.resolve();
      expect(registry.getSnapshot()?.view).toBe("/last");
      expect(warning).toHaveBeenCalledOnce();
      expect(other.getSnapshot()).toBeNull();
    } finally {
      warning.mockRestore();
    }
  });
});
