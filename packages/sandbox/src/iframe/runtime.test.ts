// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { startIframeRuntime } from "./runtime";
import { sandboxMessageType } from "../bridge";
import type { AppClient, ViewRequest } from "./resolve-view";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function setup(module: { default?: unknown; mount?: () => void }) {
  const root = document.createElement("div");
  const parentWindow = { postMessage: vi.fn() };
  const importModule = vi.fn(() => Promise.resolve(module));
  cleanups.push(startIframeRuntime({ root, channel: "test", parentWindow, importModule }));
  function send(payload: unknown) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parentWindow as unknown as Window,
        data: { type: sandboxMessageType, channel: "test", payload },
      }),
    );
  }
  function update(props: ViewRequest) {
    send({
      type: "init",
      data: { appSource: "client", appUrl: "https://apps.test/client.js", props },
    });
  }
  return { root, parentWindow, importModule, update, send };
}

it("imports once, publishes updates, clears unsupported slots, and dispatches callbacks", async () => {
  let clicks = 0;
  const client: AppClient = {
    slots: {
      panel: {
        "/": {
          component: (props) => {
            const button = document.createElement("tailorkit-button");
            button.textContent = String(props.context?.name);
            button.setAttribute(
              "data-tailorkit-callbacks",
              JSON.stringify({ click: { callback: "onClick", inputCount: 0 } }),
            );
            button.addEventListener("click", () => {
              button.textContent = String(++clicks);
            });
            return button;
          },
        },
      },
    },
    $runtime: {
      h: (component, props) => component(props),
      render: (node, root) => root.replaceChildren(...(node ? [node as Node] : [])),
    },
  };
  const runtime = setup({ default: client });
  const request = (name: string): ViewRequest => ({
    slot: "panel",
    view: "/",
    supportedViews: ["/"],
    declaredViews: ["/"],
    layers: [{ path: "/", status: "ready", context: { name } }],
  });
  runtime.update(request("first"));
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("first"));
  const snapshot = runtime.parentWindow.postMessage.mock.calls.find(
    ([message]) => message.payload?.type === "snapshot",
  )?.[0].payload.data.tree;
  expect(snapshot.children[0].callbacks).toEqual([
    { event: "click", callback: "onClick", inputCount: 0 },
  ]);
  runtime.send({
    type: "dispatchCallback",
    data: { nodeId: snapshot.children[0].id, event: "click", args: [] },
  });
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("1"));
  runtime.update(request("second"));
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("second"));
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
  runtime.update({ ...request("second"), slot: "unsupported" });
  await vi.waitFor(() => expect(runtime.root.childNodes).toHaveLength(0));
  expect(
    runtime.parentWindow.postMessage.mock.calls.at(-1)?.[0].payload.data.tree.children,
  ).toEqual([]);
});

it("reports a mount-only module instead of bypassing view resolution", async () => {
  const mount = vi.fn();
  const runtime = setup({ mount });
  runtime.update({ slot: "panel", view: "/", layers: [], declaredViews: [], supportedViews: [] });
  await vi.waitFor(() =>
    expect(runtime.parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { type: "error", data: { message: expect.stringContaining("defineClient()") } },
      }),
      "*",
    ),
  );
  expect(mount).not.toHaveBeenCalled();
});
