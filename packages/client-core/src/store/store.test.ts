import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createTailorKitStore } from "./store";
import { toBaseUrl } from "../client/url";
import type { TailorKitApp } from "../types";

afterEach(() => vi.unstubAllGlobals());

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("client stores", () => {
  it("normalizes endpoints without changing the input URL", () => {
    const input = new URL("https://host.test/api/tailorkit?token=test");
    expect(toBaseUrl(input).href).toBe("https://host.test/api/tailorkit/?token=test");
    expect(input.pathname).toBe("/api/tailorkit");
  });

  it("shares discovery requests and retains snapshots across subscription lifecycles", async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    const store = createTailorKitStore("https://host.test/api/tailorkit");
    const listener = vi.fn();
    const stop = store.subscribeApps(listener);
    const first = store.fetchApps();
    expect(store.fetchApps()).toBe(first);
    expect(store.getAppsSnapshot().status).toBe("loading");
    response.resolve(Response.json([{ id: "app", views: [{ path: "/home", slot: "panel" }] }]));
    await first;
    const ready = store.getAppsSnapshot();
    expect(ready.status).toBe("ready");
    expect(ready.views[0]?.app).toBe(ready.apps[0]);
    expect(store.fetch.apps.getSnapshot()).toBe(ready);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    stop();
    const stopAgain = store.subscribeApps(listener);
    await store.fetchApps();
    expect(store.getAppsSnapshot()).toBe(ready);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://host.test/api/tailorkit/apps"),
      expect.objectContaining({ credentials: "same-origin", signal: expect.any(AbortSignal) }),
    );
    stopAgain();
  });

  it("ignores stale discovery responses when a forced request finishes first", async () => {
    const old = deferredResponse();
    const current = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise),
    );
    const store = createTailorKitStore("https://host.test/");
    const first = store.fetchApps();
    const second = store.fetchApps({ force: true });
    current.resolve(Response.json([{ id: "current" }]));
    await second;
    const ready = store.getAppsSnapshot();
    old.resolve(Response.json([{ id: "old" }]));
    await first;
    expect(store.getAppsSnapshot()).toBe(ready);
    expect(ready.apps).toEqual([{ id: "current" }]);
  });

  it("keeps provided apps authoritative while discovery is pending", async () => {
    const response = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );
    const store = createTailorKitStore("https://host.test/");
    const pending = store.fetchApps();
    const apps: TailorKitApp[] = [{ id: "provided" }];
    store.setProvidedApps(apps);
    response.resolve(Response.json([{ id: "remote" }]));
    await pending;
    await store.fetchApps({ force: true });
    expect(store.getAppsSnapshot().apps).toBe(apps);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("resumes discovery when provided apps are removed with an active subscriber", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([{ id: "remote" }]));
    vi.stubGlobal("fetch", fetchMock);
    const store = createTailorKitStore("https://host.test/", [{ id: "provided" }]);
    const firstStop = store.subscribeApps(vi.fn());
    const stop = store.subscribeApps(vi.fn());
    await store.fetchApps();
    firstStop();
    firstStop();
    store.setProvidedApps(undefined);
    expect(fetchMock).toHaveBeenCalledOnce();
    await store.fetchApps();
    expect(store.getAppsSnapshot().apps).toEqual([{ id: "remote" }]);
    stop();
  });

  it("does not seed discovery from preview updates before apps are available", async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn<typeof fetch>(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    const store = createTailorKitStore("https://host.test/");
    const views = [{ slot: "panel", path: "/preview" }];

    store.fetch.apps.updateViews("app", views);
    expect(store.getAppsSnapshot().status).toBe("idle");
    const pending = store.fetchApps();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    store.fetch.apps.updateViews("app", views);
    expect(store.getAppsSnapshot().status).toBe("loading");
    expect(signal?.aborted).toBe(false);
    expect(store.fetchApps()).toBe(pending);
    response.resolve(Response.json([{ id: "app", views: [{ slot: "panel", path: "/remote" }] }]));
    await pending;
    expect(store.getAppsSnapshot().apps[0]?.views).toEqual([{ slot: "panel", path: "/remote" }]);
    expect(fetchMock).toHaveBeenCalledOnce();

    store.fetch.apps.updateViews("app", views);
    expect(store.getAppsSnapshot().apps[0]?.views).toEqual(views);
  });

  it("supports TanStack selectors without publishing unrelated metadata changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ assetsBaseUrl: "https://assets.test/", schema: {} })),
    );
    const store = createTailorKitStore("https://host.test/", [{ id: "provided" }]);
    const listener = vi.fn();
    const unsubscribe = store.subscribeApps(listener);
    const snapshot = store.getAppsSnapshot();
    await store.fetchMeta();
    expect(store.getMetaSnapshot()).toMatchObject({
      assetsBaseUrl: "https://assets.test/",
      status: "ready",
    });
    expect(store.getAppsSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("deduplicates metadata requests and ignores superseded responses", async () => {
    const old = deferredResponse();
    const current = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise),
    );
    const store = createTailorKitStore("https://host.test/");
    const first = store.fetchMeta();
    expect(store.fetchMeta()).toBe(first);
    const second = store.fetchMeta({ force: true });
    current.resolve(Response.json({ assetsBaseUrl: "https://current.test/", schema: {} }));
    await second;
    const ready = store.getMetaSnapshot();
    old.resolve(Response.json({ assetsBaseUrl: "https://old.test/", schema: {} }));
    await first;
    expect(store.getMetaSnapshot()).toBe(ready);
    expect(ready.assetsBaseUrl).toBe("https://current.test/");
  });

  it("recovers from failed requests and keeps client instances isolated", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce("offline")
      .mockResolvedValueOnce(Response.json([{ id: "remote" }]));
    vi.stubGlobal("fetch", fetchMock);
    const first = createTailorKitStore("https://host.test/");
    const second = createTailorKitStore("https://other.test/");
    await first.fetchApps();
    expect(first.getAppsSnapshot().error?.message).toBe("offline");
    expect(first.getAppsSnapshot().status).toBe("error");
    await first.fetchApps({ force: true });
    expect(first.getAppsSnapshot()).toMatchObject({ error: null, status: "ready" });
    expect(second.getAppsSnapshot()).toMatchObject({ apps: [], status: "idle" });
  });
});
