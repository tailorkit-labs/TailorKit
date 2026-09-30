/* eslint-disable require-await */
import { Effect, Layer } from "effect";
import { expect, it, vi } from "vite-plus/test";
import {
  DeploymentSource,
  FacetExecution,
  RequestQueue,
  execute,
  installationName,
  runtimeIdentity,
} from "./runtime";

const identity = {
  userId: "user",
  projectId: "project",
  appId: "app",
  installationId: "installation",
  deploymentId: "v1",
  expiresAt: Date.now() + 120_000,
};

const deployment = {
  projectId: "project",
  appId: "app",
  deploymentId: "v1",
  objectKey: "private/server.js",
  checksum: "a".repeat(64),
  contentLength: 1,
};

const request = new Request("https://runtime.test/rpc/query", { method: "POST" });

it.each([
  ["projectId", "other", "FORBIDDEN"],
  ["appId", "other", "FORBIDDEN"],
  ["deploymentId", "v2", "INCOMPATIBLE_VERSION"],
] as const)(
  "rejects mismatched %s before executing or downloading code",
  async (field, value, code) => {
    const forward = vi.fn(() => Effect.succeed(new Response()));
    const load = vi.fn(() => Effect.succeed("code"));
    const result = await Effect.runPromise(
      execute(request, identity).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(DeploymentSource, {
              current: () => Effect.succeed({ ...deployment, [field]: value }),
              code: load,
            }),
            Layer.succeed(FacetExecution, { forward }),
          ),
        ),
        Effect.catch((error) => Effect.succeed(error.code)),
      ),
    );
    expect(result).toBe(code);
    expect(forward).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  },
);

it("routes code versions to the same storage but separates hosts, projects, apps and installations", () => {
  const name = installationName(identity, "host");
  expect(installationName({ ...identity, deploymentId: "v2" }, "host")).toBe(name);
  for (const key of ["projectId", "appId", "installationId"] as const)
    expect(installationName({ ...identity, [key]: "other" }, "host")).not.toBe(name);
  expect(installationName(identity, "other")).not.toBe(name);
});

it("serializes async admission, recovers from errors and releases streaming responses", async () => {
  const queue = new RequestQueue();
  const order: string[] = [];
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run(async () => {
    order.push("first");
    await pending;
    throw new Error("failure");
  });
  const rejected = first.catch(() => {});
  const second = queue.run(async () => {
    order.push("second");
    return new Response(new ReadableStream({ start() {} }));
  });
  await Promise.resolve();
  expect(order).toEqual(["first"]);
  release();
  await rejected;
  const stream = await second;
  expect(order).toEqual(["first", "second"]);
  expect(await queue.run(async () => "third")).toBe("third");
  await stream.body?.cancel();
});

it("requires project and deployment claims when converting a verified identity", () => {
  expect(runtimeIdentity(identity)).toEqual(identity);
  expect(() => runtimeIdentity({ ...identity, projectId: undefined })).toThrow("access required");
  expect(() => runtimeIdentity({ ...identity, deploymentId: undefined })).toThrow(
    "access required",
  );
});

it("forwards the verified identity and published deployment through the execution service", async () => {
  const response = new Response("result");
  const forward = vi.fn(() => Effect.succeed(response));
  const result = await Effect.runPromise(
    execute(request, identity).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(DeploymentSource, {
            current: () => Effect.succeed(deployment),
            code: () => Effect.succeed("code"),
          }),
          Layer.succeed(FacetExecution, { forward }),
        ),
      ),
    ),
  );

  expect(result).toBe(response);
  expect(forward).toHaveBeenCalledWith(request, identity, deployment);
});

it("rejects a token that expired while resolving its deployment before execution", async () => {
  const forward = vi.fn(() => Effect.succeed(new Response()));
  const result = await Effect.runPromise(
    execute(request, { ...identity, expiresAt: Date.now() - 1 }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(DeploymentSource, {
            current: () => Effect.succeed(deployment),
            code: () => Effect.succeed("code"),
          }),
          Layer.succeed(FacetExecution, { forward }),
        ),
      ),
      Effect.catch((error) => Effect.succeed(error.code)),
    ),
  );

  expect(result).toBe("UNAUTHORIZED");
  expect(forward).not.toHaveBeenCalled();
});
