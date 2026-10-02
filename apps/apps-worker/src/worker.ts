import {
  appRuntimeIssuer,
  appDeploymentMetadata,
  deploymentMetadataKey,
  runtimeServiceAuthorized,
} from "@tailorkit/api-utils/app-auth";
import { metadataLifetimeSeconds, installationName } from "./supervisor/source";
import { AppError } from "@tailorkit/app/server";
import { verifier } from "./supervisor/auth";
import { routeInstallation, rpcErrorResponse } from "./transport";
import { Effect } from "effect";
import { appError } from "./runtime/errors";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = new Headers({
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    });

    const response = await Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          if (
            new URL(request.url).pathname === "/internal/deployments" &&
            request.method === "POST"
          ) {
            if (!(await runtimeServiceAuthorized(request, env.RUNTIME_SERVICE_TOKEN))) {
              throw new AppError("UNAUTHORIZED", "Runtime service credential required");
            }
            const text = await request.text();
            if (text.length > 8192) {
              throw new AppError("BAD_REQUEST", "Deployment metadata too large");
            }
            let value: unknown;
            try {
              value = JSON.parse(text);
            } catch {
              throw new AppError("BAD_REQUEST", "Invalid deployment metadata");
            }
            const parsed = appDeploymentMetadata.safeParse(value);
            if (!parsed.success) {
              throw new AppError("BAD_REQUEST", "Invalid deployment metadata");
            }
            await env.DEPLOYMENTS.put(
              deploymentMetadataKey(parsed.data),
              JSON.stringify(parsed.data),
              { expirationTtl: metadataLifetimeSeconds },
            );
            return new Response(null, { status: 204 });
          }
          return routeInstallation(request, {
            verify: verifier(env),
            installation: (identity) =>
              env.STORES.getByName(installationName(identity, appRuntimeIssuer(env.PLATFORM_URL))),
          });
        },
        catch: appError,
      }).pipe(Effect.catch((error) => Effect.succeed(rpcErrorResponse(error)))),
    );

    if (response.status === 101) {
      return response;
    }

    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));

    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
