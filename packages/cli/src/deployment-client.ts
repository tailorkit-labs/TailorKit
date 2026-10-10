import {
  cliAppsCreate,
  cliDeploymentsCreate,
  cliDeploymentsPublish,
  cliVerify,
} from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import type {
  CliAppsCreateData,
  CliDeploymentsCreateData,
} from "@tailorkit/client-platform/client";

async function request<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof Error) throw error;
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      throw Object.assign(new Error(error.message, { cause: error }), {
        code: "code" in error ? error.code : undefined,
      });
    }
    throw new Error(String(error), { cause: error });
  }
}

/** CLI tokens authenticate directly; no host project key or host request is needed. */
export function createDeploymentClient(deployToken: string) {
  const client = createClient({
    baseUrl: process.env.TAILORKIT_PLATFORM_URL ?? "https://tailorkit.dev/api/platform",
    headers: { authorization: `Bearer ${deployToken}` },
    responseStyle: "data",
    throwOnError: true,
  });
  return {
    verify: () => request(cliVerify({ client, body: {} })),
    apps: {
      create: (body: CliAppsCreateData["body"]) => request(cliAppsCreate({ client, body })),
    },
    deployments: {
      create: (body: CliDeploymentsCreateData["body"]) =>
        request(cliDeploymentsCreate({ client, body })),
      publish: ({ deploymentId, rollout }: { deploymentId: string; rollout?: boolean }) =>
        request(cliDeploymentsPublish({ client, path: { deploymentId }, body: { rollout } })),
    },
  };
}
