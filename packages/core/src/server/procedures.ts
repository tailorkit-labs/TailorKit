import { ORPCError, os } from "@orpc/server";
import { cliAuthVerifyToken } from "@tailorkit/client-platform/client";
import type { Context } from "./context";
import {
  normalizeTailorKitNamedScope,
  selectTailorKitScopes,
  validateTailorKitScopes,
} from "./scope";
import type { TailorKitNamedScope, TailorKitScopes } from "./types";

export const o = os.$context<Context>();

export function getTailorKitContext(context: Context) {
  if (!context.tailorkit) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." });
  }

  return context.tailorkit;
}

export function getTailorKitScope(context: Context, name?: string): TailorKitNamedScope {
  const scopes = getTailorKitContext(context).scopes;
  const names = name !== undefined ? [name] : Object.keys(scopes);
  if (names.length !== 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose one TailorKit scope for this operation.",
    });
  }
  try {
    return selectTailorKitScopes(scopes, names)[0]!;
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Invalid TailorKit scope selection.",
    });
  }
}

export function getTailorKitScopes(context: Context, names?: string[]): TailorKitNamedScope[] {
  try {
    return selectTailorKitScopes(getTailorKitContext(context).scopes, names);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Invalid TailorKit scope selection.",
    });
  }
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

  let scopes: TailorKitScopes;
  try {
    const scope = normalizeTailorKitNamedScope(token.scope);
    scopes = await validateTailorKitScopes(context.scopeSchemas, {
      [scope.name]: scope.value,
    });
  } catch {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }
  return next({ context: { tailorkit: { scopes } } });
});

export const requireHostAuth = o.middleware(async ({ context, next }) => {
  const tailorkit = await context.authenticate({ request: context.request });

  if (!tailorkit) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." });
  }

  return next({ context: { tailorkit } });
});
