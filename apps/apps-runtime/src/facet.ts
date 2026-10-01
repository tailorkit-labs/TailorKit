// SPDX-License-Identifier: Apache-2.0
import { DurableObject } from "cloudflare:workers";
import { AppError } from "@tailorkit/apps-server";
import { createExecution, invocationSchema, appError } from "@tailorkit/apps-server/runtime";
import type { AppDefinition, Identity } from "@tailorkit/apps-server";
import { z } from "zod";

/** Compiled into each isolated server artifact. No transport or platform credentials. */
export function createAppFacet(app: AppDefinition) {
  return class AppFacet extends DurableObject<Record<string, never>> {
    #execution = createExecution(app, {
      execute: (sql, params) => {
        const cursor = this.ctx.storage.sql.exec(sql, ...(params as SqlStorageValue[]));
        const rows = Array.from(cursor.raw());
        return { columns: cursor.columnNames, rows, changes: cursor.rowsWritten };
      },
      transaction: (run) => this.ctx.storage.transactionSync(run),
    });
    async fetch(request: Request): Promise<Response> {
      try {
        const identity = JSON.parse(
          request.headers.get("x-tailorkit-identity") ?? "null",
        ) as Identity | null;
        if (!identity) throw new AppError("UNAUTHORIZED", "Missing invocation identity");
        const input = invocationSchema
          .extend({ kind: z.enum(["query", "mutation"]), requestId: z.uuid().optional() })
          .parse(await request.json());
        if (input.kind === "mutation" && !input.requestId)
          throw new AppError("BAD_REQUEST", "Mutation ID required");
        const result =
          input.kind === "query"
            ? this.#execution.query(input, identity)
            : this.#execution.mutate({ ...input, requestId: input.requestId! }, identity);
        return Response.json(result);
      } catch (error) {
        const failure = appError(error);
        return Response.json(
          { code: failure.code, message: failure.message },
          {
            status:
              failure.code === "UNAUTHORIZED"
                ? 401
                : failure.code === "BAD_REQUEST"
                  ? 400
                  : failure.code === "CONFLICT"
                    ? 409
                    : failure.code === "NOT_FOUND"
                      ? 404
                      : 500,
          },
        );
      }
    }
  };
}
