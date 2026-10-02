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
      Effect.gen(function* () {
        if (publication) {
          if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
          }
          if (
            !(yield* Effect.tryPromise({
              try: () => runtimeServiceAuthorized(request, env.RUNTIME_SERVICE_TOKEN),
              catch: appError,
            }))
          ) {
            return yield* Effect.fail(
              new AppError("UNAUTHORIZED", "Runtime service credential required"),
            );
          }
          const text = yield* Effect.tryPromise({ try: () => request.text(), catch: appError });
          if (text.length > 8192) {
            return yield* Effect.fail(new AppError("BAD_REQUEST", "Deployment metadata too large"));
          }
          const value = yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: () => new AppError("BAD_REQUEST", "Invalid deployment metadata"),
          });
          const parsed = appDeploymentMetadata.safeParse(value);
          if (!parsed.success) {
            return yield* Effect.fail(new AppError("BAD_REQUEST", "Invalid deployment metadata"));
          }
          yield* Effect.try({
            try: () => validateDeploymentPublication(parsed.data, publication),
            catch: appError,
          });
          yield* Effect.tryPromise({
            try: () =>
              env.DEPLOYMENTS.put(deploymentMetadataKey(parsed.data), JSON.stringify(parsed.data), {
                expirationTtl: metadataLifetimeSeconds,
              }),
            catch: appError,
          });
          return new Response(null, { status: 204 });
        }
        if (!appRoute) return new Response("Not found", { status: 404 });
        const url = new URL(request.url);
        url.pathname = appRoute.rpcPath;
        const routedRequest = new Request(url, request);
        return yield* routeInstallation(routedRequest, {
          verify: (token) =>
            Effect.gen(function* () {
              const identity = yield* verifier(env)(token);
              if (
                (appRoute.publicTeamId !== undefined &&
                  identity.publicTeamId !== appRoute.publicTeamId) ||
                identity.projectId !== appRoute.projectId ||
                identity.appPublicId !== appRoute.appPublicId
              ) {
                return yield* Effect.fail(
                  new AppError("FORBIDDEN", "App token does not match the route"),
                );
              }
              return identity;
            }),
          installation: (identity) =>
            env.STORES.getByName(installationName(identity, appRuntimeIssuer(env.PLATFORM_URL))),
        });
      }).pipe(
        Effect.mapError(appError),
        Effect.catch((error) => Effect.succeed(rpcErrorResponse(error))),
      ),
    );

    if (response.status === 101) {
      return response;
    }

    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));

    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
