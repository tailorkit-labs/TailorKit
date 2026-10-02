import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { cancellationStream, abortable } from "../runtime/cancellation";
import { createApplicationExecution } from "../runtime/bundle";
import { installFetchGuard } from "../runtime/context";
import type { Invocation } from "@tailorkit/app/protocol";
import type { ActionCapability } from "../runtime/actions";
import type { Identity } from "@tailorkit/app/server";

installFetchGuard();

export class AppFacet extends DurableObject<Record<string, never>> {
  #execution = this.ctx.blockConcurrencyWhile(async () => {
    const application = await import("application.js");
    return createApplicationExecution(application, {
      execute: (sql, params) => {
        const cursor = this.ctx.storage.sql.exec(sql, ...(params as SqlStorageValue[]));
        return {
          columns: cursor.columnNames,
          rows: [...cursor.raw()],
          changes: cursor.rowsWritten,
        };
      },
      transaction: (run) => this.ctx.storage.transactionSync(run),
    });
  });

  async query(input: Invocation, identity: Identity) {
    const execution = await this.#execution;
    return Effect.runSync(execution.call("query", input, identity));
  }

  async mutate(input: Invocation & { requestId: string }, identity: Identity) {
    const execution = await this.#execution;
    return Effect.runSync(execution.call("mutation", input, identity));
  }

  async action(
    input: Invocation,
    identity: Identity,
    capability: ActionCapability,
    cancellation: ReadableStream,
  ) {
    const execution = await this.#execution;
    const controller = new AbortController();
    const reader = cancellation.getReader();
    const cancel = () => controller.abort();
    void reader.read().then(cancel, cancel);
    return Effect.runPromise(
      execution
        .action(
          input,
          identity,
          {
            fetch: (input, init) => {
              const request = new Request(input, init);
              const signal = request.signal;
              signal.throwIfAborted();
              // Attached AbortSignals cannot be serialized by Workers RPC.
              const transferable = new Request(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: request.redirect,
              });
              return abortable(capability.fetch(transferable, cancellationStream(signal)), signal);
            },
            committed: (tables) => capability.committed(tables),
          },
          controller.signal,
        )
        .pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => {})))),
    );
  }
}
