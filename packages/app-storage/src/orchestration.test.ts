import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { Authentication, InstallationRouting, Execution, dispatch } from "./orchestration";
import { StorageTools } from "./tooling";
import { StorageError } from "./errors";

const identity = {
  userId: "user",
  appId: "app",
  installationId: "installation",
  expiresAt: Date.now() + 60_000,
};
describe("replaceable supervisor services", () => {
  it("can substitute execution without a concrete runtime or database", () => {
    const query = vi.fn(() => ({ value: "replacement", revision: 7, reads: new Set<string>() }));
    const replacement = Layer.succeed(Execution, {
      query,
      mutate: () => "accepted",
      subscribe: () => {
        throw new Error("Unused in this check");
      },
    });
    const invocation = { name: "list", input: {}, apiVersion: 1 };
    const result = Effect.runSync(
      Effect.gen(function* invoke() {
        const execution = yield* Execution;
        return execution.query(invocation, identity);
      }).pipe(Effect.provide(replacement)),
    );
    expect(result.value).toBe("replacement");
    expect(query).toHaveBeenCalledWith(invocation, identity);
  });
  it("can substitute tooling without importing a platform adapter", async () => {
    const inspect = vi.fn(() => Effect.succeed({ schema: {}, apiVersion: 1, functions: {} }));
    const project = {
      root: "/app",
      appId: "app",
      directory: "/app/.storage",
      state: "/state",
      entry: "server.ts",
      migrations: "migrations",
      references: "refs.ts",
      namespace: "app",
      issuer: "https://host.test",
      audience: "storage",
      publicKeys: "keys.json",
      origins: ["https://host.test"],
      port: 8787,
    };
    const replacement = Layer.succeed(StorageTools, {
      inspect,
      build: () => Effect.succeed(undefined),
      start: () => Effect.succeed({ close: () => {} }),
    });
    const metadata = await Effect.runPromise(
      Effect.gen(function* inspectApp() {
        const tools = yield* StorageTools;
        return yield* tools.inspect(project);
      }).pipe(Effect.provide(replacement)),
    );
    expect(metadata.apiVersion).toBe(1);
    expect(inspect).toHaveBeenCalledWith(project);
  });
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
