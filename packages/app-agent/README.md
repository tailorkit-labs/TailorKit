# App agent

A coding workflow with read, write, edit, bash, grep, glob and ls tools.
Each run owns one disposable Vercel Sandbox. Code survives on the app's Drive,
mounted at `/workspace`; app files live at `/workspace/app`.

```ts
import { appAgent } from "@tailorkit/app-agent/workflows";
import { start } from "workflow/api";

const run = await start(appAgent, [
  {
    appId, // Stable, authorized app ID, shared across conversations.
    model: configuredModelId,
    messages: [{ role: "user", content: "Build a task tracker" }],
  },
]);

const { messages } = await run.returnValue;
// Pass this history plus the next user/parent-agent message for follow-ups.
```

Inputs are only `messages` (`ModelMessage[]`), `model` (AI Gateway ID) and `appId`.
Human chat and parent agents use the same workflow; convert UI messages at the
chat boundary. The Drive name is `app-${appId}`. Authorize app IDs before calling
and use IDs that are globally unique within the Vercel project and valid in a
Drive name. Each sandbox is named `app-agent-${workflowRunId}` for debugging.

`agent.stream({ messages, writable: getWritable<ModelCallStreamPart>(), ... })`
streams model/tool output directly. Consume `run.getReadable()` and use
`createModelCallToUIChunkTransform` at a UI boundary. There are no additional
lifecycle events or skill discovery. The returned value is `{ messages }`.
The agent closes its stream; `run.returnValue` resolves after sandbox cleanup.

## Locking and lifecycle

[Vercel Drives](https://vercel.com/docs/sandbox/concepts/drives) allow one
read-write mount at a time. The mount is the lock. Busy or conflicting mounts
fail the workflow immediately. Different apps can run concurrently.

The sandbox starts with a 15-minute timeout. Every tool retrieval tops up its
remaining lifetime to 15 minutes, rather than adding another 15 minutes. A
durable heartbeat renews it every five minutes while the agent is running,
including during long model calls. Tools operate on the current VM's `Session`,
so an expired VM cannot automatically resume and remount its Drive.

The workflow never stops, snapshots or deletes its sandbox between agent steps.
It deletes its own sandbox in the final `finally`, after the agent has settled
and any in-flight renewal has finished. Renewal failure aborts the agent, and
cleanup still waits for it to settle. The Drive and its contents survive.

The agent has hardcoded limits of 100 model steps and a 30-minute stream timeout,
so a stalled model cannot hold the Drive indefinitely through heartbeats. Shell
commands are capped at 15 minutes too. Vercel's plan limits still apply.

If cancellation/crashes prevent `finally`, heartbeats stop and the VM expires
about 15 minutes after its last renewal, releasing the Drive. Timeout stops
compute; it does not delete named-sandbox metadata. Normal cleanup deletes that
metadata too. Drive data persists until explicitly deleted.

## Integration

Build this private package with `vp pack`. It emits JavaScript, declarations and
source maps, keeps runtime dependencies external, and preserves `"use workflow"`
and `"use step"` directives for the consumer's compiler. The root export provides
`AppAgentInput`; `@tailorkit/app-agent/workflows` provides the raw coding workflow.

Configure AI Gateway and Vercel Sandbox credentials. Consumers re-export the raw
workflow from a file in their `workflows/` directory:

```ts
// workflows/app-agent.ts
export * from "@tailorkit/app-agent/workflows";
```

The web app already does this and registers that directory with `workflow/vite`.
Build dependencies before starting the consumer. Keeping discovery on the
package's exported workflow entry point also gives the runtime stable package
IDs for replay after cold starts. The package requires Workflow; standalone
execution without its runtime is outside this internal package's scope.
The platform exposes `POST /app-agent/chat`, using the generated Hey API client
from the host. `tailor agent` opens the AI SDK TUI through the host’s oRPC relay.

A parent should delegate editing before mounting the same Drive itself. Code is
saved as it is edited, including partial changes from failed runs. Publishing,
versioning and S3 backups remain separate platform concerns.
