import { describe, expect, it, vi } from "vite-plus/test";
import { NodeStore } from "./node-store";
import type { RemoteNode } from "@tailorkit/sandbox/protocol";

const textNode = (id: string, text: string): RemoteNode => ({ id, kind: "text", text });

const elemNode = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: RemoteNode[] = [],
): RemoteNode => ({ children, id, kind: "element", props, type });

const elementWithCallback = (event: string, inputCount = 1): RemoteNode => ({
  callbacks: [{ callback: "onSelect", inputCount, event }],
  children: [],
  id: "n",
  kind: "element",
  props: {},
  type: "tailorkit-button",
});

describe("NodeStore", () => {
  it("retains unchanged node snapshots when a sibling changes", () => {
    const store = new NodeStore();
    store.setSnapshot(elemNode("root", "div", {}, [textNode("a", "same"), textNode("b", "old")]));
    const unchanged = store.getNode("a");
    const root = store.getNode("root");
    store.setSnapshot(elemNode("root", "div", {}, [textNode("a", "same"), textNode("b", "new")]));
    expect(store.getNode("a")).toBe(unchanged);
    expect(store.getNode("root")).toBe(root);
    expect(store.getNode("b")).toMatchObject({ text: "new" });
  });

  it("notifies removed node subscribers and supports reappearing nodes", () => {
    const store = new NodeStore();
    store.setSnapshot(elemNode("root", "div", {}, [textNode("child", "old")]));
    const values: (RemoteNode | null)[] = [];
    const stop = store.subscribe("child", () => values.push(store.getNode("child")));
    store.setSnapshot(elemNode("root", "div"));
    expect(values).toEqual([null]);
    store.setSnapshot(elemNode("root", "div", {}, [textNode("child", "new")]));
    expect(values[1]).toMatchObject({ text: "new" });
    stop();
  });

  it("clears nodes and root atomically while keeping subscriptions usable", () => {
    const store = new NodeStore();
    store.setSnapshot(textNode("root", "old"));
    const snapshot = () => ({ node: store.getNode("root"), rootId: store.getRootId() });
    const nodeListener = vi.fn(snapshot);
    const rootListener = vi.fn(snapshot);
    const stopNode = store.subscribe("root", nodeListener);
    const stopRoot = store.subscribeRoot(rootListener);
    store.clear();
    expect(nodeListener).toHaveBeenCalledOnce();
    expect(rootListener).toHaveBeenCalledOnce();
    expect(nodeListener).toHaveLastReturnedWith({ node: null, rootId: null });
    expect(rootListener).toHaveLastReturnedWith({ node: null, rootId: null });
    const newRoot = textNode("root", "new");
    store.setSnapshot(newRoot);
    expect(nodeListener).toHaveBeenCalledTimes(2);
    expect(rootListener).toHaveBeenCalledTimes(2);
    expect(nodeListener).toHaveLastReturnedWith({ node: newRoot, rootId: "root" });
    expect(rootListener).toHaveLastReturnedWith({ node: newRoot, rootId: "root" });
    stopNode();
    stopRoot();
    store.setSnapshot(textNode("another-root", "after unsubscribe"));
    expect(nodeListener).toHaveBeenCalledTimes(2);
    expect(rootListener).toHaveBeenCalledTimes(2);
  });

  describe("setSnapshot", () => {
    it("stores all nodes from the tree", () => {
      const store = new NodeStore();
      const tree = elemNode("root", "div", {}, [textNode("t1", "hello")]);
      store.setSnapshot(tree);

      expect(store.getNode("root")).toMatchObject({ id: "root", type: "div" });
      expect(store.getNode("t1")).toMatchObject({ id: "t1", text: "hello" });
    });

    it("flattens nested children", () => {
      const store = new NodeStore();
      const tree = elemNode("root", "div", {}, [
        elemNode("child", "span", {}, [textNode("text", "hi")]),
      ]);
      store.setSnapshot(tree);

      expect(store.getNode("text")).toMatchObject({ text: "hi" });
    });

    it("tracks the root id", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("root", "hi"));
      expect(store.getRootId()).toBe("root");
    });

    it("removes stale nodes when they leave the tree", () => {
      const store = new NodeStore();
      store.setSnapshot(elemNode("root", "div", {}, [textNode("old", "gone")]));
      store.setSnapshot(elemNode("root", "div", {}, []));

      expect(store.getNode("old")).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("notifies listener when a node changes", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("n1", "initial"));

      const listener = vi.fn();
      store.subscribe("n1", listener);

      store.setSnapshot(textNode("n1", "updated"));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when node content is unchanged", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("n1", "same"));

      const listener = vi.fn();
      store.subscribe("n1", listener);

      store.setSnapshot(textNode("n1", "same"));
      expect(listener).not.toHaveBeenCalled();
    });

    it("only notifies the subscriber for its specific node", () => {
      const store = new NodeStore();
      store.setSnapshot(elemNode("root", "div", {}, [textNode("n1", "a"), textNode("n2", "b")]));

      const n1Listener = vi.fn();
      const n2Listener = vi.fn();
      store.subscribe("n1", n1Listener);
      store.subscribe("n2", n2Listener);

      store.setSnapshot(
        elemNode("root", "div", {}, [textNode("n1", "changed"), textNode("n2", "b")]),
      );

      expect(n1Listener).toHaveBeenCalledTimes(1);
      expect(n2Listener).not.toHaveBeenCalled();
    });

    it("does not notify parent when only a child's props change", () => {
      const store = new NodeStore();
      store.setSnapshot(elemNode("root", "div", {}, [textNode("child", "initial")]));

      const rootListener = vi.fn();
      store.subscribe("root", rootListener);

      store.setSnapshot(elemNode("root", "div", {}, [textNode("child", "updated")]));

      expect(rootListener).not.toHaveBeenCalled();
    });

    it("notifies parent when children list changes", () => {
      const store = new NodeStore();
      store.setSnapshot(elemNode("root", "div", {}, [textNode("n1", "a")]));

      const rootListener = vi.fn();
      store.subscribe("root", rootListener);

      store.setSnapshot(elemNode("root", "div", {}, [textNode("n1", "a"), textNode("n2", "b")]));

      expect(rootListener).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes cleanly", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("n1", "a"));

      const listener = vi.fn();
      const unsub = store.subscribe("n1", listener);
      unsub();

      store.setSnapshot(textNode("n1", "b"));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("subscribeRoot", () => {
    it("notifies when root id changes", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("root1", "a"));

      const listener = vi.fn();
      store.subscribeRoot(listener);

      store.setSnapshot(textNode("root2", "b"));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not notify when root id stays the same", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("root", "a"));

      const listener = vi.fn();
      store.subscribeRoot(listener);

      store.setSnapshot(textNode("root", "b"));
      expect(listener).not.toHaveBeenCalled();
    });

    it("unsubscribes cleanly", () => {
      const store = new NodeStore();
      store.setSnapshot(textNode("root1", "a"));

      const listener = vi.fn();
      const unsub = store.subscribeRoot(listener);
      unsub();

      store.setSnapshot(textNode("root2", "b"));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("element node change detection", () => {
    it("detects prop changes", () => {
      const store = new NodeStore();
      store.setSnapshot(elemNode("n", "div", { color: "red" }));

      const listener = vi.fn();
      store.subscribe("n", listener);

      store.setSnapshot(elemNode("n", "div", { color: "blue" }));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("detects type changes", () => {
      const store = new NodeStore();
      store.setSnapshot(elemNode("n", "div"));

      const listener = vi.fn();
      store.subscribe("n", listener);

      store.setSnapshot(elemNode("n", "span"));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("detects callback binding changes", () => {
      const store = new NodeStore();

      store.setSnapshot(elementWithCallback("tailorkitcallbackonselect"));
      const listener = vi.fn();
      store.subscribe("n", listener);

      store.setSnapshot(elementWithCallback("tailorkitcallbackonchange"));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("updates callback bindings when only the input count changes", () => {
      const store = new NodeStore();
      const event = "tailorkitcallbackonselect";
      store.setSnapshot(elementWithCallback(event, 1));
      const previous = store.getNode("n");
      const listener = vi.fn();
      const stop = store.subscribe("n", listener);

      store.setSnapshot(elementWithCallback(event, 2));
      const updated = store.getNode("n");
      expect(updated).not.toBe(previous);
      expect(updated).toMatchObject({
        callbacks: [{ callback: "onSelect", event, inputCount: 2 }],
      });
      expect(listener).toHaveBeenCalledOnce();

      store.setSnapshot(elementWithCallback(event, 2));
      expect(store.getNode("n")).toBe(updated);
      expect(listener).toHaveBeenCalledOnce();
      stop();
    });
  });
});
