// Test fixtures use promise-shaped callbacks and assertions on known fixture values.
/* eslint-disable require-await, typescript/no-non-null-assertion, unicorn/no-await-expression-member */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createIframeUiHost } from "./index";
import { iframeReadyType, sandboxMessageType } from "../bridge";
import type { StorageClient } from "@tailorkit/app-storage";

function fixture() {
  const stop = vi.fn();
  const query = vi.fn(async (_reference: unknown, _input: unknown) => [{ id: "1" }]);
  const mutate = vi.fn(
    async (_reference: unknown, _input: unknown, _options: unknown) => "accepted",
  );
  let listener: ((value: unknown) => void) | undefined;
  const subscribe = vi.fn(
    (_reference: unknown, _input: unknown, callback: (value: unknown) => void) => {
      listener = callback;
      return stop;
    },
  );
  const storage = { query, mutate, subscribe } as unknown as StorageClient;
  const host = createIframeUiHost("https://assets.test/app.js", {
    sourceText: "// client",
    storage,
  });
  host.mount();
  const channel = /data-tailorkit-channel="([a-f0-9]+)"/u.exec(host.iframe.srcdoc)![1];
  const send = (data: unknown) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: host.iframe.contentWindow,
        data: { channel, type: sandboxMessageType, payload: { type: "storageRequest", data } },
      }),
    );
  const post = vi.spyOn(host.iframe.contentWindow!, "postMessage");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: host.iframe.contentWindow,
      data: { channel, type: iframeReadyType },
    }),
  );
  return {
    host,
    query,
    mutate,
    subscribe,
    stop,
    send,
    post,
    channel,
    push: (value: unknown) => listener?.(value),
  };
}
const request = { id: "request", op: "query", name: "list", apiVersion: 1, input: {} };
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe("storage bridge", () => {
  it("forwards only validated invocation metadata and mutation receipt IDs", async () => {
    const f = fixture();
    f.send({ ...request, installationId: "forged" });
    expect(f.query).not.toHaveBeenCalled();
    f.send(request);
    await vi.waitFor(() => expect(f.query).toHaveBeenCalledTimes(1));
    expect(f.query.mock.calls[0]?.[0]).toMatchObject({
      name: "list",
      kind: "query",
      apiVersion: 1,
    });
    const requestId = crypto.randomUUID();
    f.send({ ...request, id: "mutation", op: "mutate", name: "add", requestId });
    await vi.waitFor(() => expect(f.mutate).toHaveBeenCalledTimes(1));
    expect(f.mutate.mock.calls[0]?.[2]).toEqual({ requestId });
    expect(JSON.stringify(f.post.mock.calls)).not.toContain("authorization");
    f.host.destroy();
  });
  it("rejects storage messages from another window or channel", () => {
    const f = fixture();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          channel: f.channel,
          type: sandboxMessageType,
          payload: { type: "storageRequest", data: request },
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: f.host.iframe.contentWindow,
        data: {
          channel: "wrong",
          type: sandboxMessageType,
          payload: { type: "storageRequest", data: request },
        },
      }),
    );
    expect(f.query).not.toHaveBeenCalled();
    f.host.destroy();
  });
  it("streams results and cancels all subscriptions on teardown", () => {
    const f = fixture();
    f.send({ ...request, op: "subscribe" });
    f.push(["latest"]);
    expect(f.post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { type: "storageResult", data: { id: "request", value: ["latest"] } },
      }),
      "*",
    );
    f.send({ ...request, op: "cancel" });
    expect(f.stop).toHaveBeenCalledTimes(1);
    f.send({ ...request, id: "other", op: "subscribe" });
    f.host.destroy();
    expect(f.stop).toHaveBeenCalledTimes(2);
    const count = f.post.mock.calls.length;
    f.push(["after destroy"]);
    expect(f.post).toHaveBeenCalledTimes(count);
  });
  it("rejects cyclic input without leaving a pending host call", () => {
    const f = fixture();
    const input: Record<string, unknown> = {};
    input.self = input;
    f.send({ ...request, input });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: {
          type: "storageResult",
          data: {
            id: "request",
            error: { code: "BAD_REQUEST", message: "Storage input must be JSON" },
          },
        },
      }),
      "*",
    );
    f.host.destroy();
  });
});
