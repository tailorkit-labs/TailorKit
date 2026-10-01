import { z } from "zod";
import { databaseScope } from "../database/driver";
import type { Persistence } from "../database/driver";
import type { AppDefinition, Identity } from "./functions";
import { AppError } from "../errors";

export const invocationSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u),
  args: z.unknown(),
});
export interface Invocation {
  name: string;
  args: unknown;
}
export interface ExecutionResult {
  value: unknown;
  tables: string[];
}
export interface MutationResult extends ExecutionResult {
  committed: boolean;
}

export function createExecution(app: AppDefinition, persistence: Persistence) {
  // Framework bookkeeping only. App schema creation/migration is intentionally deferred.
  persistence.execute(
    "CREATE TABLE IF NOT EXISTS tailorkit_receipts (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)",
    [],
  );
  function execute(
    input: Invocation,
    identity: Identity,
    kind: "query" | "mutation",
  ): ExecutionResult {
    if (identity.expiresAt <= Date.now()) throw new AppError("UNAUTHORIZED", "App token expired");
    const fn = app.functions[input.name];
    if (!fn || fn.kind !== kind) throw new AppError("NOT_FOUND", "App function not found");
    const parsed = fn.args.safeParse(input.args);
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Invalid function arguments");
    const scope = databaseScope(persistence, kind === "mutation");
    try {
      let value = fn.handler({ args: parsed.data, db: scope.db, identity } as never);
      if (value && typeof value === "object" && "then" in value) {
        // Revoke DB access before any continuation can run outside the transaction.
        void Promise.resolve(value).catch(() => {});
        throw new AppError("BAD_REQUEST", "App handlers must be synchronous");
      }
      if (fn.result) {
        const result = fn.result.safeParse(value);
        if (!result.success) throw new AppError("INTERNAL_SERVER_ERROR", "Invalid function result");
        value = result.data;
      }
      const serialized = JSON.stringify(value ?? null);
      const result = {
        value: JSON.parse(serialized),
        tables: [...(kind === "query" ? scope.reads : scope.writes)],
      };
      // Include response metadata and UTF-8 bytes before a mutation can commit.
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength + 64 > 1024 * 1024)
        throw new AppError("BAD_REQUEST", "Function result exceeds 1 MiB");
      return result;
    } finally {
      scope.close();
    }
  }
  return {
    query: (input: Invocation, identity: Identity) => execute(input, identity, "query"),
    mutate(input: Invocation & { requestId: string }, identity: Identity): MutationResult {
      if (identity.expiresAt <= Date.now()) throw new AppError("UNAUTHORIZED", "App token expired");
      z.uuid().parse(input.requestId);
      const fingerprint = JSON.stringify([
        identity.userId,
        identity.projectId,
        identity.appId,
        identity.installationId,
        input.name,
        input.args,
      ]);
      return persistence.transaction(() => {
        const prior = persistence.execute(
          "SELECT fingerprint, result FROM tailorkit_receipts WHERE id = ?",
          [input.requestId],
        ).rows[0];
        if (prior) {
          if (prior[0] !== fingerprint)
            throw new AppError(
              "CONFLICT",
              "Mutation ID was already used for different arguments or identity",
            );
          return { ...JSON.parse(String(prior[1])), committed: false };
        }
        const result = execute(input, identity, "mutation");
        persistence.execute(
          "INSERT INTO tailorkit_receipts (id, fingerprint, result) VALUES (?, ?, ?)",
          [input.requestId, fingerprint, JSON.stringify(result)],
        );
        return { ...result, committed: true };
      });
    },
  };
}
