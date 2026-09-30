import { afterEach, expect, it, vi } from "vite-plus/test";
import { StorageError } from "@tailorkit/app-storage";
import { authenticatedResponse, errorResponse, readBounded } from "./http";

afterEach(() => vi.useRealTimers());

it("reads multiple body chunks up to the exact byte limit", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
    },
  });

  expect(await readBounded({ body }, 3)).toEqual(new Uint8Array([1, 2, 3]));
  expect(await readBounded(new Response(""), 0)).toEqual(new Uint8Array());
});

it("cancels oversized chunked bodies and rejects missing or failed streams", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel,
  });

  await expect(readBounded({ body }, 2)).rejects.toThrow("allowed size");
  expect(cancel).toHaveBeenCalledOnce();
  await expect(readBounded({ body: null }, 2)).rejects.toThrow("Missing download body");

  const failure = new Error("upstream failed");
  const failed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(failure);
    },
  });
  await expect(readBounded({ body: failed }, 2)).rejects.toBe(failure);
});

it.each([
  ["UNAUTHORIZED", 401],
  ["FORBIDDEN", 403],
  ["BAD_REQUEST", 400],
  ["NOT_FOUND", 404],
  ["CONFLICT", 409],
  ["INCOMPATIBLE_VERSION", 409],
  ["UNAVAILABLE", 503],
  ["INTERNAL_SERVER_ERROR", 500],
] as const)("maps %s to HTTP %s", async (code, status) => {
  const response = errorResponse(new StorageError(code, "public message"));

  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code, message: "public message" });
});

it("does not expose internal errors in a response", async () => {
  const response = errorResponse(new Error("private credentials"));

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private credentials");
});

it("preserves successful response metadata and clears expiry timers on completion", async () => {
  vi.useFakeTimers();
  const original = new Response("result", {
    status: 202,
    statusText: "Accepted",
    headers: { "x-result": "one" },
  });
  const response = authenticatedResponse(original, Date.now() + 1000);

  expect(response.status).toBe(202);
  expect(response.statusText).toBe("Accepted");
  expect(response.headers.get("x-result")).toBe("one");
  expect(await response.text()).toBe("result");
  expect(vi.getTimerCount()).toBe(0);

  const empty = new Response(null, { status: 204 });
  expect(authenticatedResponse(empty, Date.now() + 1000)).toBe(empty);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([1000, -1])(
  "ends pending streams at authentication expiry (%s ms) and cancels upstream",
  async (offset) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = authenticatedResponse(
      new Response(new ReadableStream({ cancel })),
      Date.now() + offset,
    );
    const reader = response.body!.getReader();
    const pending = reader.read();

    await vi.advanceTimersByTimeAsync(Math.max(0, offset));

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("cancels upstream and clears timers when a subscriber disconnects", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const response = authenticatedResponse(
    new Response(new ReadableStream({ cancel })),
    Date.now() + 1000,
  );

  await response.body!.cancel();

  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("propagates stream failures and clears their expiry timer", async () => {
  vi.useFakeTimers();
  const failure = new Error("upstream failed");
  const response = authenticatedResponse(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      }),
    ),
    Date.now() + 1000,
  );

  await expect(response.text()).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});
