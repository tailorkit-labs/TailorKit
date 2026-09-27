import { ORPCError, os } from "@orpc/server";
import { cliAuthVerifyToken } from "@tailorkit/client-platform/client";
import type { Context } from "./context";
import { normalizeTailorKitScope } from "./scope";
import type { TailorKitScope } from "./types";

export const o = os.$context<Context>();

export function getTailorKitContext(context: Context) {
  if (!context.tailorkit) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." });
  }

  return context.tailorkit;
}

export function getTailorKitScope(context: Context): TailorKitScope {
  return getTailorKitContext(context).scope;
}

export function getCliDeployToken(request: Request): string {
  const [scheme, token] = request.headers.get("authorization")?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new ORPCError("UNAUTHORIZED", { message: "Missing CLI deploy token." });
  }

  return token;
}

export const requireCliDeployToken = o.middleware(async ({ context, next }) => {
  const result = await cliAuthVerifyToken({
    body: {
      deployToken: getCliDeployToken(context.request),
    },
    client: context.platform,
    headers: context.platformHeaders,
  });

  const token = "data" in result ? result.data : result;

  if (!token?.scope) {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }

  return next({ context: { tailorkit: { scope: normalizeTailorKitScope(token.scope) } } });
});

export const requireHostAuth = o.middleware(async ({ context, next }) => {
  const tailorkit = await context.authenticate({ request: context.request });

  if (!tailorkit) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." });
  }

  return next({ context: { tailorkit } });
});
