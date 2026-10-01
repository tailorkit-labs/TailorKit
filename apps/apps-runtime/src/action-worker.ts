// SPDX-License-Identifier: Apache-2.0
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AppDefinition, Identity } from "@tailorkit/apps-server";
import type { Invocation } from "@tailorkit/apps-server/runtime";
import { createActionExecution, invocationSchema, appError } from "@tailorkit/apps-server/runtime";

interface ActionBindings {
  DATABASE: {
    runQuery(input: Invocation): Promise<unknown>;
    runMutation(input: Invocation & { requestId: string }): Promise<unknown>;
  };
}

/** Stateless action isolate: outbound HTTP and scoped callbacks, no SQLite or platform bindings. */
export function createAppActions(app: AppDefinition) {
  return class AppActions extends WorkerEntrypoint<ActionBindings> {
    async fetch(request: Request): Promise<Response> {
      try {
        const identity = JSON.parse(
          request.headers.get("x-tailorkit-identity") ?? "null",
        ) as Identity;
        const input = invocationSchema.parse(await request.json());
        const value = await createActionExecution(app, {
          query: (call) => this.env.DATABASE.runQuery(call),
          mutate: (call) => this.env.DATABASE.runMutation(call),
        })(input, identity, request.signal);
        return Response.json({ value });
      } catch (error) {
        const failure = appError(error);
        return Response.json({ code: failure.code, message: failure.message }, { status: 400 });
      }
    }
  };
}
