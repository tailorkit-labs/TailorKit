import { describe, expect, it, vi } from "vite-plus/test";
import type { RemoteNode } from "../protocol.js";
import { createRemoteUiStore } from "./store.js";

const tree = {
  children: [
    {
      children: [{ id: "text", kind: "text", text: "Save" }],
      callbacks: [{ callback: "onClick", inputCount: 0, event: "tailorkitcallbackonclick" }],
      id: "tailorkit-button",
      kind: "element",
      props: { disabled: false },
      type: "tailorkit-button",
    },
  ],
  id: "root",
  kind: "fragment",
} satisfies RemoteNode;

describe("createRemoteUiStore", () => {
  it("stores snapshots", () => {
    const store = createRemoteUiStore();

    store.handleSandboxMessage({
      data: { revision: 1, tree },
      type: "snapshot",
    });

    expect(store.getSnapshot()).toMatchObject(tree);
  });

  it("applies patch batches without replacing the entire remote tree over the wire", () => {
    const store = createRemoteUiStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSnapshot(tree, 1);

    store.handleSandboxMessage({
      data: {
        patches: [
          { nodeId: "text", op: "setText", text: "Saved" },
          { name: "disabled", nodeId: "tailorkit-button", op: "setProp", value: true },
          { callbacks: [], nodeId: "tailorkit-button", op: "setCallbacks" },
        ],
        revision: 2,
      },
      type: "patches",
    });

    expect(store.getRevision()).toBe(2);
    expect(store.getSnapshot()).toMatchObject({
      children: [
        {
          callbacks: [],
          props: { disabled: true },
          children: [{ text: "Saved" }],
        },
      ],
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("can insert and remove nodes by id", () => {
    const store = createRemoteUiStore();
    store.setSnapshot(tree, 1);

    store.applyPatches([
      {
        node: { id: "suffix", kind: "text", text: "!" },
        op: "insert",
        parentId: "tailorkit-button",
      },
      {
        nodeId: "text",
        op: "remove",
      },
    ]);

    expect(store.getSnapshot()).toMatchObject({
      children: [
        {
          children: [{ id: "suffix", text: "!" }],
        },
      ],
    });
  });
});
