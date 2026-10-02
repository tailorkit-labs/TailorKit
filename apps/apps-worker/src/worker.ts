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
import { parseHostedAppRoute, parseDeploymentPublicationRoute } from "@tailorkit/asset-delivery";
import assets from "./assets";
import { validateDeploymentPublication } from "./publication";
import { appError } from "./runtime/errors";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const domain = env.ASSET_DOMAIN;
    const publication = parseDeploymentPublicationRoute(request, domain);
    const appRoute = parseHostedAppRoute(request, domain);
    if (!publication && !appRoute) {
      return assets.fetch(request as Parameters<typeof assets.fetch>[0], env, ctx);
    }
    const cors = new Headers({
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    });

    const response = await Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          if (publication) {
            if (request.method !== "POST") {
              return new Response("Method not allowed", { status: 405 });
            }
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
            validateDeploymentPublication(parsed.data, publication);
            await env.DEPLOYMENTS.put(
              deploymentMetadataKey(parsed.data),
              JSON.stringify(parsed.data),
              { expirationTtl: metadataLifetimeSeconds },
            );
            return new Response(null, { status: 204 });
          }
          if (!appRoute) return new Response("Not found", { status: 404 });
          const url = new URL(request.url);
          url.pathname = appRoute.rpcPath;
          const routedRequest = new Request(url, request);
          return routeInstallation(routedRequest, {
            verify: async (token) => {
              const identity = await verifier(env)(token);
              if (
                (appRoute.publicTeamId !== undefined &&
                  identity.publicTeamId !== appRoute.publicTeamId) ||
                identity.projectId !== appRoute.projectId ||
                identity.appPublicId !== appRoute.appPublicId
              ) {
                throw new AppError("FORBIDDEN", "App token does not match the route");
              }
              return identity;
            },
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
