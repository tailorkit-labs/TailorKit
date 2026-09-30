import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { Authentication, InstallationRouting, dispatch } from "./orchestration";
import { StorageError } from "./errors";

const identity = {
  userId: "user",
  appId: "app",
  installationId: "installation",
  expiresAt: Date.now() + 60_000,
};
describe("replaceable supervisor services", () => {
  it("passes only the verified identity to the installation router", async () => {
    const forward = vi.fn(() => Effect.succeed(new Response("isolated")));
    const layer = Layer.merge(
      Layer.succeed(Authentication, { verify: () => Effect.succeed(identity) }),
      Layer.succeed(InstallationRouting, { forward }),
    );
    const request = new Request("https://storage.test/rpc/query", {
      method: "POST",
      headers: { "x-tailorkit-identity": "forged" },
    });
    const response = await Effect.runPromise(dispatch(request, false).pipe(Effect.provide(layer)));
    expect(await response.text()).toBe("isolated");
    expect(forward).toHaveBeenCalledWith(request, identity, false);
  });
  it("does not invoke app execution when authentication fails", async () => {
    const forward = vi.fn(() => Effect.succeed(new Response()));
    const layer = Layer.merge(
      Layer.succeed(Authentication, {
        verify: () => Effect.fail(new StorageError("UNAUTHORIZED")),
      }),
      Layer.succeed(InstallationRouting, { forward }),
    );
    await expect(
      Effect.runPromise(
        dispatch(new Request("https://storage.test/rpc/query"), false).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow();
    expect(forward).not.toHaveBeenCalled();
  });
  it("selects migration authentication separately from app authentication", async () => {
    const verify = vi.fn((_request: Request, migration: boolean) =>
      migration ? Effect.succeed(identity) : Effect.fail(new StorageError("FORBIDDEN")),
    );
    const layer = Layer.merge(
      Layer.succeed(Authentication, { verify }),
      Layer.succeed(InstallationRouting, { forward: () => Effect.succeed(new Response()) }),
    );
    await Effect.runPromise(
      dispatch(new Request("https://storage.test/_tailorkit/migrate"), true).pipe(
        Effect.provide(layer),
      ),
    );
    expect(verify.mock.calls[0]?.[1]).toBe(true);
  });
});
