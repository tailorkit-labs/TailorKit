import { ORPCError } from "@orpc/server";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { db } from "@tailorkit/db";
import { env } from "#env";
import { canonicalizeScope } from "./scope";

export async function authenticateCli(
  projectId: string,
  deployToken: string,
  runtimeService?: boolean,
) {
  if (runtimeService) throw new ORPCError("FORBIDDEN");
  return authenticateCliToken(deployToken, projectId);
}

/** Direct CLI requests derive their project and scope from the issued token. */
export async function authenticateCliToken(deployToken: string, projectId?: string) {
  if (!env.AUTH_SECRET) throw new ORPCError("SERVICE_UNAVAILABLE");
  const token = await db.query.cliToken.findFirst({
    where: {
      ...(projectId === undefined ? {} : { projectId }),
      tokenHash: hashSecret(deployToken, env.AUTH_SECRET),
    },
  });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }
  let scope: ReturnType<typeof canonicalizeScope>;
  try {
    scope = canonicalizeScope(token.scope);
  } catch {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }
  if (scope.scopeKey !== token.scopeKey) {
    throw new ORPCError("UNAUTHORIZED", { message: "Invalid CLI deploy token." });
  }
  return { ...token, scope: scope.scope, scopeKey: scope.scopeKey };
}
