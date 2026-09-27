import { describe, expect, it, vi } from "vite-plus/test";
import { NodeStore } from "../node-store";
import type { RemoteNode } from "@tailorkit/sandbox/protocol";

const textNode = (id: string, text: string): RemoteNode => ({ id, kind: "text", text });

const elemNode = (
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: RemoteNode[] = [],
): RemoteNode => ({ children, id, kind: "element", props, type });

const elementWithCallback = (event: string): RemoteNode => ({
  callbacks: [{ callback: "onSelect", inputCount: 1, event }],
  children: [],
  id: "n",
  kind: "element",
  props: {},
  type: "tailorkit-button",
});

describe("NodeStore", () => {
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
  });
});
