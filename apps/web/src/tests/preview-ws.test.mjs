import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  message: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tailorkit/api-platform/preview-ws-auth", () => ({
  authorizePreviewSocket: mocks.authorize,
}));
vi.mock("@tailorkit/api-platform/preview-ws", () => ({ previewWebSocketRouter: {} }));
vi.mock("@orpc/server/crossws", () => ({
  experimental_RPCHandler: class {
    handlers = mocks;
    message(...args) {
      return this.handlers.message(...args);
    }
    close(...args) {
      return this.handlers.close(...args);
    }
  },
}));
vi.mock("crossws", () => ({ defineHooks: (handlers) => handlers }));

const { Route } = await import("../routes/api/platform.preview.ws.ts");
const response = Route.options.server.handlers.GET();
const socket = response.crossws;

it("returns an upgrade-required response for ordinary HTTP requests", () => {
  expect(response.status).toBe(426);
  expect(response.crossws.open).toBeTypeOf("function");
  expect(response.crossws.message).toBeTypeOf("function");
});
const context = { sessionId: "11111111-1111-4111-8111-111111111111", role: "uploader" };

beforeEach(() => {
  vi.clearAllMocks();
});

it("waits for authorization before handling an early message", async () => {
  let resolveAuthorization;
  mocks.authorize.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveAuthorization = resolve;
    }),
  );
  const peer = { context: { ...context, token: "token" }, close: vi.fn() };
  const message = { rawData: "{}" };

  const opening = socket.open(peer);
  const handling = socket.message(peer, message);
  expect(peer.close).not.toHaveBeenCalled();
  expect(mocks.message).not.toHaveBeenCalled();

  resolveAuthorization(context);
  await Promise.all([opening, handling]);
  expect(peer.close).not.toHaveBeenCalled();
  expect(mocks.message).toHaveBeenCalledWith(peer, message, { context });
});

it("closes an early message when authorization fails", async () => {
  let resolveAuthorization;
  mocks.authorize.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveAuthorization = resolve;
    }),
  );
  const peer = { context: { ...context, token: "invalid" }, close: vi.fn() };

  const opening = socket.open(peer);
  const handling = socket.message(peer, { rawData: "{}" });
  resolveAuthorization(null);
  await Promise.all([opening, handling]);
  expect(peer.close).toHaveBeenCalled();
  expect(mocks.message).not.toHaveBeenCalled();
});

it("closes a peer that sends multiple frames before authorization finishes", async () => {
  let resolveAuthorization;
  mocks.authorize.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveAuthorization = resolve;
    }),
  );
  const peer = { context: { ...context, token: "token" }, close: vi.fn() };
  const opening = socket.open(peer);
  const first = socket.message(peer, { rawData: "first" });
  const second = socket.message(peer, { rawData: "second" });

  await second;
  expect(peer.close).toHaveBeenCalledOnce();
  resolveAuthorization(context);
  await Promise.all([opening, first]);
  expect(mocks.message).not.toHaveBeenCalled();
});

it("handles multiple messages after authorization finishes", async () => {
  mocks.authorize.mockResolvedValueOnce(context);
  const peer = { context: { ...context, token: "token" }, close: vi.fn() };
  await socket.open(peer);

  const first = { rawData: "first" };
  const second = { rawData: "second" };
  await Promise.all([socket.message(peer, first), socket.message(peer, second)]);
  expect(peer.close).not.toHaveBeenCalled();
  expect(mocks.message).toHaveBeenCalledTimes(2);
  expect(mocks.message).toHaveBeenNthCalledWith(1, peer, first, { context });
  expect(mocks.message).toHaveBeenNthCalledWith(2, peer, second, { context });
});
