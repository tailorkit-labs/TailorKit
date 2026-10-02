import { createEffectClient, catchORPCErrorCode } from "@orpc/experimental-effect";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { call, createRouterClient } from "@orpc/server";
import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { router, createInstallationHandler, rpcErrorResponse } from "./transport";
import type { Installation } from "./transport";
import type { PlatformClient } from "@tailorkit/app/protocol";

function installation(): Installation {
  return {
    query: vi.fn((input) => Effect.succeed(input.name)),
    mutate: vi.fn((input) => Effect.succeed(input.requestId)),
    action: vi.fn(() => Effect.succeed("action")),
  };
}

it("validates calls before dispatching installation operations", async () => {
  const operations = installation();
  const options = { context: { installation: operations } };
  await expect(
    call(router.mutations, { name: "nested.add", requestId: "invalid" }, options),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(call(router.queries, { name: "nested..list" }, options)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(operations.mutate).not.toHaveBeenCalled();
  expect(operations.query).not.toHaveBeenCalled();
  const input = { name: "nested.list", args: { filter: "open" } };
  await expect(call(router.queries, input, options)).resolves.toBe("nested.list");
  expect(operations.query).toHaveBeenCalledWith(input);
});

it("preserves procedure failures for Effect client recovery", async () => {
  const operations = installation();
  // eslint-disable-next-line prefer-promise-reject-errors -- Verify serialized failures from the runtime boundary.
  operations.query = () => Effect.fail({ code: "NOT_FOUND", message: "Missing query" });
  const client = createEffectClient(
    createRouterClient(
      { queries: router.queries, mutations: router.mutations, actions: router.actions },
      { context: { installation: operations } },
    ),
  );
  const result = await Effect.runPromise(
    client
      .queries({ name: "list" })
      .pipe(catchORPCErrorCode("NOT_FOUND", (error) => Effect.succeed(error.message))),
  );
  expect(result).toBe("Missing query");
});

it("propagates cancellation through an Effect handler to the action", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let actionSignal: AbortSignal | undefined;
  const operations = installation();
  operations.action = (_input, signal) => {
    if (!signal) {
      throw new Error("Action signal required");
    }
    actionSignal = signal;
    started();
    return Effect.tryPromise({
      try: () =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
      catch: (error) => error,
    });
  };
  const client = createRouterClient(
    { queries: router.queries, mutations: router.mutations, actions: router.actions },
    { context: { installation: operations } },
  );
  const result = client.actions({ name: "import" }, { signal: controller.signal });
  const rejected = expect(result).rejects.toBeDefined();
  await ready;
  controller.abort();
  await rejected;
  expect(actionSignal?.aborted).toBe(true);
});

it("routes HTTP calls with shared client types, CORS and typed error statuses", async () => {
  const operations = installation();
  const handler = createInstallationHandler();
  const client = createORPCClient<PlatformClient>(
    new RPCLink({
      url: "/rpc",
      origin: "https://runtime.test",
      fetch: async (url, init) => {
        const result = await handler.handle(new Request(url, init), {
          prefix: "/rpc",
          context: { installation: operations },
        });
        expect(result.matched).toBe(true);
        if (!result.response) {
          throw new Error("Missing RPC response");
        }
        return result.response;
      },
    }),
  );
  expect(await client.queries({ name: "nested.list" })).toBe("nested.list");
  const requestId = crypto.randomUUID();
  expect(await client.mutations({ name: "nested.add", requestId })).toBe(requestId);
  expect(await client.actions({ name: "import" })).toBe("action");
  // eslint-disable-next-line prefer-promise-reject-errors -- Verify serialized failures from the runtime boundary.
  operations.query = () => Effect.fail({ code: "INCOMPATIBLE_VERSION", message: "Reload" });
  await expect(client.queries({ name: "list" })).rejects.toMatchObject({
    code: "INCOMPATIBLE_VERSION",
    message: "Reload",
  });
  const preflight = await handler.handle(
    new Request("https://runtime.test/rpc/queries", {
      method: "OPTIONS",
      headers: { origin: "https://host.test", "access-control-request-method": "POST" },
    }),
    { prefix: "/rpc", context: { installation: operations } },
  );
  expect(preflight.response?.headers.get("access-control-allow-origin")).toBe("*");
});

it("encodes gateway authentication errors in the oRPC format", async () => {
  const client = createORPCClient<PlatformClient>(
    new RPCLink({
      url: "/rpc",
      origin: "https://runtime.test",
      fetch: () => Promise.resolve(rpcErrorResponse({ code: "UNAUTHORIZED", message: "Expired" })),
    }),
  );
  await expect(client.queries({ name: "list" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Expired",
  });
});
