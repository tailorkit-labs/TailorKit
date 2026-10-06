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
  if (!env.AUTH_SECRET) throw new ORPCError("SERVICE_UNAVAILABLE");
  const token = await db.query.cliToken.findFirst({
    where: { projectId, tokenHash: hashSecret(deployToken, env.AUTH_SECRET) },
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
