import { afterEach, expect, it, vi } from "vite-plus/test";
import { createRemoteUiStore } from "@tailorkit/sandbox/host";
import type { IframeUiHost, IframeUiHostOptions } from "@tailorkit/sandbox/host";
import type { RemoteElementNode } from "@tailorkit/sandbox/protocol";
import { createRemoteElementProps, createRemoteViewStore } from "./remote-view";

const tree: RemoteElementNode = {
  id: "root",
  kind: "element",
  type: "Button",
  props: { label: "Button" },
  children: [],
  callbacks: [{ callback: "onSelect", event: "selected", inputCount: 1 }],
};

function setup() {
  const records: { host: IframeUiHost; options: IframeUiHostOptions; listeners: (() => void)[] }[] =
    [];
  const createHost = vi.fn((_url: string | URL, options: IframeUiHostOptions = {}) => {
    const source = createRemoteUiStore();
    const listeners: (() => void)[] = [];
    const host: IframeUiHost = {
      ...source,
      iframe: {} as HTMLIFrameElement,
      dispatch: vi.fn(),
      destroy: vi.fn(),
      mount: vi.fn(),
      setProps: vi.fn(),
      subscribe: vi.fn((listener) => {
        listeners.push(listener);
        return source.subscribe(listener);
      }),
    };
    records.push({ host, options, listeners });
    return host;
  });
  return { records, createHost };
}
afterEach(() => vi.restoreAllMocks());

it("publishes host status and native node selectors together without a rendering framework", () => {
  const { createHost, records } = setup();
  const store = createRemoteViewStore({}, createHost);
  expect(store.state.get()).toEqual({ status: "starting", error: null, generation: 0 });
  const stop = store.mount({ appUrl: "https://host.test/app.js" });
  const listener = vi.fn(() => ({
    root: store.nodes.root.get(),
    status: store.state.get().status,
  }));
  const stopRoot = store.nodes.root.listen(listener);
  records[0]!.host.setSnapshot(tree, 1);
  expect(listener).toHaveLastReturnedWith({ root: "root", status: "ready" });
  expect(store.nodes.selectNode("root").get()).toEqual(tree);
  const ready = store.state.get();
  records[0]!.host.setSnapshot({ ...tree, props: { label: "Updated" } }, 2);
  expect(store.state.get()).toBe(ready);
  stopRoot();
  stop();
  expect(store.nodes.root.get()).toBeNull();
  expect(records[0]!.host.destroy).toHaveBeenCalledOnce();
});

it("updates only changed component selectors without recreating the host", () => {
  const { createHost, records } = setup();
  const first = () => "first";
  const second = () => "second";
  const store = createRemoteViewStore({ components: { Button: first } }, createHost);
  const stop = store.mount({ appUrl: "https://host.test/app.js" });
  records[0]!.host.setSnapshot(tree, 1);
  const snapshot = store.nodes.state.get();
  const component = store.selectComponent("Button");
  const listener = vi.fn();
  const stopComponent = component.listen(listener);
  store.setComponents({ Button: first, Input: () => null });
  expect(listener).not.toHaveBeenCalled();
  store.setComponents({ Button: second });
  expect(component.get()).toBe(second);
  expect(listener).toHaveBeenCalledOnce();
  expect(createHost).toHaveBeenCalledOnce();
  expect(store.nodes.state.get()).toBe(snapshot);
  stopComponent();
  stop();
});

it("retains the latest props and shares callback payload construction", () => {
  const { createHost, records } = setup();
  const store = createRemoteViewStore({ props: { value: "old" } }, createHost);
  const latest = { value: "latest" };
  store.setProps(latest);
  const stop = store.mount({ appUrl: "https://host.test/app.js", sourceText: "source" });
  expect(records[0]!.options).toMatchObject({ props: latest, sourceText: "source" });
  store.setProps(undefined);
  expect(records[0]!.host.setProps).toHaveBeenCalledWith(undefined);
  const props = createRemoteElementProps(tree, store.dispatch);
  (props.onSelect as (...args: unknown[]) => void)("selected value", { synthetic: "event" });
  expect(records[0]!.host.dispatch).toHaveBeenCalledExactlyOnceWith({
    type: "dispatchCallback",
    data: { nodeId: "root", event: "selected", args: ["selected value"] },
  });
  expect(tree.props).toEqual({ label: "Button" });
  stop();
  (props.onSelect as (...args: unknown[]) => void)("after stop");
  expect(records[0]!.host.dispatch).toHaveBeenCalledOnce();
});

it("isolates dispatch, component registries, and trees between remote views", () => {
  const { createHost, records } = setup();
  const first = createRemoteViewStore({ components: { Button: "first" } }, createHost);
  const second = createRemoteViewStore({ components: { Button: "second" } }, createHost);
  const stopFirst = first.mount({ appUrl: "https://host.test/first.js" });
  const stopSecond = second.mount({ appUrl: "https://host.test/second.js" });
  records[0]!.host.setSnapshot(tree, 1);
  expect(second.nodes.root.get()).toBeNull();
  const callback = createRemoteElementProps(tree, second.dispatch).onSelect as (
    ...args: unknown[]
  ) => void;
  callback("second");
  expect(records[0]!.host.dispatch).not.toHaveBeenCalled();
  expect(records[1]!.host.dispatch).toHaveBeenCalledOnce();
  expect(first.components.get()).toEqual({ Button: "first" });
  expect(second.components.get()).toEqual({ Button: "second" });
  stopFirst();
  stopSecond();
});

it("ignores stale host events and cleanup after a replacement mount", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { createHost, records } = setup();
  const store = createRemoteViewStore({}, createHost);
  const stopFirst = store.mount({ appUrl: "https://host.test/first.js" });
  records[0]!.host.setSnapshot(tree, 1);
  const stopSecond = store.mount({ appUrl: "https://host.test/second.js" });
  expect(records[0]!.host.destroy).toHaveBeenCalledOnce();
  expect(store.nodes.root.get()).toBeNull();
  records[0]!.listeners[0]!();
  records[0]!.options.onError!(new Error("Stale failure"));
  stopFirst();
  expect(error).not.toHaveBeenCalled();
  expect(store.state.get().status).toBe("starting");
  expect(records[1]!.host.destroy).not.toHaveBeenCalled();
  records[1]!.host.setSnapshot(tree, 1);
  expect(store.state.get()).toMatchObject({ status: "ready", generation: 2 });
  stopSecond();
  stopSecond();
  expect(records[1]!.host.destroy).toHaveBeenCalledOnce();
});

it("reports startup failures, releases partial hosts, and recovers on the next mount", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { createHost, records } = setup();
  const failure = new Error("Failed to start");
  createHost.mockImplementationOnce((_url, options = {}) => {
    const source = createRemoteUiStore();
    const host: IframeUiHost = {
      ...source,
      iframe: {} as HTMLIFrameElement,
      dispatch: vi.fn(),
      destroy: vi.fn(),
      mount: () => {
        throw failure;
      },
      setProps: vi.fn(),
    };
    records.push({ host, options, listeners: [] });
    return host;
  });
  const store = createRemoteViewStore({}, createHost);
  store.mount({ appUrl: "https://host.test/first.js" });
  expect(store.state.get()).toMatchObject({ status: "error", error: failure });
  expect(error).toHaveBeenCalledExactlyOnceWith("TailorKit remote app failed", failure);
  expect(records[0]!.host.destroy).toHaveBeenCalledOnce();
  const stop = store.mount({ appUrl: "https://host.test/second.js" });
  records[1]!.host.setSnapshot(tree, 1);
  expect(store.state.get()).toMatchObject({ status: "ready", error: null });
  stop();
});
