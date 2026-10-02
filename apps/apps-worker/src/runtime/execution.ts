import { z } from "zod";
import { inExecutionContext } from "./context";
import { createActionExecution } from "./actions";
import type { ActionServices } from "./actions";
import { databaseScope } from "./database/driver";
import type { Persistence } from "./database/driver";
import type { AppDefinition, Identity } from "@tailorkit/app/server";
import { prepareFunction, functionValue } from "./functions";
import { AppError, appError, failedResult } from "./errors";
import type { InvocationResult } from "./errors";
import { Effect } from "effect";
import { migrateDatabase } from "./database/migrations";
import type { AppMigration } from "./database/migrations";

import { invocationSchema } from "@tailorkit/app/protocol";
import type { Invocation } from "@tailorkit/app/protocol";

export { invocationSchema } from "@tailorkit/app/protocol";
export type { Invocation } from "@tailorkit/app/protocol";

export interface ExecutionResult {
  value: unknown;
  tables: string[];
}
export interface MutationResult extends ExecutionResult {
  committed: boolean;
}

export function createExecution(
  app: AppDefinition,
  persistence: Persistence,
  migrations: readonly AppMigration[] = [],
) {
  migrateDatabase(persistence, migrations);
  persistence.execute(
    "CREATE TABLE IF NOT EXISTS tailorkit_receipts (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)",
    [],
  );
  function execute(
    input: Invocation,
    identity: Identity,
    kind: "query" | "mutation",
    tables?: Set<string>,
  ): ExecutionResult {
    const { fn, args } = prepareFunction(app, input, identity, kind);
    const scope = databaseScope(persistence, kind === "mutation");
    try {
      const value = inExecutionContext({ kind, active: true }, () =>
        fn.handler({ args, db: scope.db, identity } as never),
      );
      if (value && typeof value === "object" && "then" in value) {
        // Revoke DB access before any continuation can run outside the transaction.
        void Promise.resolve(value).catch(() => {});
        throw new AppError("BAD_REQUEST", "App handlers must be synchronous");
      }
      const result = {
        value: functionValue(fn, value),
        tables: [...(kind === "query" ? scope.reads : scope.writes)],
      };
      return result;
    } finally {
      for (const table of kind === "query" ? scope.reads : scope.writes) {
        tables?.add(table);
      }
      scope.close();
    }
  }
  function mutate(
    input: Invocation & { requestId: string },
    identity: Identity,
    tables?: Set<string>,
  ): MutationResult {
    if (identity.expiresAt <= Date.now()) {
      throw new AppError("UNAUTHORIZED", "App token expired");
    }
    z.uuid().parse(input.requestId);
    const fingerprint = JSON.stringify([
      identity.userId,
      identity.projectId,
      identity.appId,
      identity.installationId,
      input.name,
      input.args,
      ...(input.args === undefined ? ["undefined"] : []),
    ]);
    return persistence.transaction(() => {
      const prior = persistence.execute(
        "SELECT fingerprint, result FROM tailorkit_receipts WHERE id = ?",
        [input.requestId],
      ).rows[0];
      if (prior) {
        if (prior[0] !== fingerprint) {
          throw new AppError(
            "CONFLICT",
            "Mutation ID was already used for different arguments or identity",
          );
        }
        return { ...JSON.parse(String(prior[1])), committed: false };
      }
      const result = execute(input, identity, "mutation", tables);
      persistence.execute(
        "INSERT INTO tailorkit_receipts (id, fingerprint, result) VALUES (?, ?, ?)",
        [input.requestId, fingerprint, JSON.stringify(result)],
      );
      return { ...result, committed: true };
    });
  }
  const action = createActionExecution(app);
  return {
    action(
      input: Invocation,
      identity: Identity,
      services: ActionServices,
      signal: AbortSignal,
    ): Effect.Effect<InvocationResult> {
      return Effect.tryPromise({
        try: () =>
          action(
            input,
            identity,
            {
              fetch: services.fetch,
              query: (call) => Promise.resolve().then(() => execute(call, identity, "query").value),
              mutate: async (call) => {
                const result = mutate(call, identity);
                if (result.committed && result.tables.length) {
                  await services.committed(result.tables);
                }
                return result.value;
              },
            },
            signal,
          ),
        catch: appError,
      }).pipe(
        Effect.map((value) => ({
          result: { ok: true as const, value },
          tables: [],
          committed: false,
        })),
        Effect.catch((error) =>
          Effect.succeed({ result: failedResult(error), tables: [], committed: false }),
        ),
      );
    },
    query: (input: Invocation, identity: Identity) => execute(input, identity, "query"),
    mutate,
    call(
      kind: "query" | "mutation",
      input: Invocation & { requestId?: string },
      identity: Identity,
    ): Effect.Effect<InvocationResult> {
      return Effect.suspend(() => {
        const tables = new Set<string>();
        return Effect.try({
          try: () => {
            const parsed = (
              kind === "mutation"
                ? invocationSchema.extend({ requestId: z.uuid() })
                : invocationSchema
            ).safeParse(input);
            if (!parsed.success) {
              throw new AppError("BAD_REQUEST", "Invalid database invocation");
            }
            const result =
              kind === "mutation"
                ? mutate(parsed.data as Invocation & { requestId: string }, identity, tables)
                : execute(parsed.data, identity, kind, tables);
            return {
              result: { ok: true as const, value: result.value },
              tables: result.tables,
              committed: "committed" in result && result.committed === true,
            };
          },
          catch: appError,
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              result: failedResult(error),
              tables: [...tables],
              committed: false,
            }),
          ),
        );
      });
    },
  };
}
