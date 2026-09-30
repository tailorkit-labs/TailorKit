/* eslint-disable max-classes-per-file */
import { Context, Effect } from "effect";
import { StorageError } from "@tailorkit/app-storage";
import type { StorageIdentity } from "@tailorkit/app-storage/server";

export interface RuntimeIdentity extends StorageIdentity {
  readonly projectId: string;
  readonly deploymentId: string;
}
export interface ServerDeployment {
  projectId: string;
  appId: string;
  deploymentId: string;
  objectKey: string;
  checksum: string;
  contentLength: number;
}
export class DeploymentSource extends Context.Service<
  DeploymentSource,
  {
    current(identity: RuntimeIdentity): Effect.Effect<ServerDeployment, StorageError>;
    code(deployment: ServerDeployment): Effect.Effect<string, StorageError>;
  }
>()("tailorkit/apps-runtime/DeploymentSource") {}
export class FacetExecution extends Context.Service<
  FacetExecution,
  {
    forward(
      request: Request,
      identity: RuntimeIdentity,
      deployment: ServerDeployment,
    ): Effect.Effect<Response, StorageError>;
  }
>()("tailorkit/apps-runtime/FacetExecution") {}

export function runtimeIdentity(identity: StorageIdentity): RuntimeIdentity {
  if (!identity.projectId || !identity.deploymentId) {
    throw new StorageError("UNAUTHORIZED", "Project and deployment access required");
  }
  return { ...identity, projectId: identity.projectId, deploymentId: identity.deploymentId };
}
/** Deployment selects code, never the database. Issuer also separates trusted hosts. */
export function installationName(identity: RuntimeIdentity, issuer: string) {
  return JSON.stringify([issuer, identity.projectId, identity.appId, identity.installationId]);
}
export function execute(request: Request, identity: RuntimeIdentity) {
  return Effect.gen(function* executeRequest() {
    const source = yield* DeploymentSource;
    const deployment = yield* source.current(identity);
    if (deployment.projectId !== identity.projectId || deployment.appId !== identity.appId) {
      return yield* Effect.fail(new StorageError("FORBIDDEN", "App or project mismatch"));
    }
    if (deployment.deploymentId !== identity.deploymentId) {
      return yield* Effect.fail(
        new StorageError("INCOMPATIBLE_VERSION", "App deployment changed; reload the app"),
      );
    }
    if (identity.expiresAt <= Date.now()) {
      return yield* Effect.fail(new StorageError("UNAUTHORIZED", "Storage token expired"));
    }
    const execution = yield* FacetExecution;
    return yield* execution.forward(request, identity, deployment);
  });
}
/** Serialize deployment resolution and request admission; streaming bodies never hold the queue. */
export class RequestQueue {
  #pending: Promise<unknown> = Promise.resolve();
  run<A>(action: () => Promise<A>): Promise<A> {
    const result = this.#pending.then(action);
    this.#pending = result.catch(() => {});
    return result;
  }
}
