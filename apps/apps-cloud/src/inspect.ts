/** Cloudflare build-time inspection in a disposable, network-disabled workerd process. */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineSchema } from "@tailorkit/app-storage/server";
import type { StoreDefinition } from "@tailorkit/app-storage/server";

export function workerdBinary(): string {
  return (createRequire(import.meta.url)("workerd") as { default: string }).default;
}
const field = z.strictObject({
  kind: z.enum(["text", "integer", "number", "boolean"]),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
  unique: z.boolean(),
});
const metadata = z.strictObject({
  schema: z.record(z.string(), z.record(z.string(), field)),
  apiVersion: z.number().int().positive(),
  functions: z.record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u),
    z.strictObject({ kind: z.enum(["query", "mutation"]) }),
  ),
});
/** Evaluate the app only in a network-disabled Dynamic Worker in a disposable workerd process. */
export async function inspectIsolated(codeFile: string): Promise<StoreDefinition> {
  const directory = await mkdtemp(path.join(tmpdir(), "tailorkit-inspect-"));
  const inspector = `import code from "app-code";
export default { async fetch(request, env) {
  const worker = env.LOADER.load({ compatibilityDate: "2026-08-27", mainModule: "app.js", modules: { "app.js": code }, globalOutbound: null, env: {} });
  return worker.getEntrypoint().fetch(request);
} };`;
  await writeFile(path.join(directory, "inspector.js"), inspector);
  await writeFile(path.join(directory, "app.js"), await readFile(codeFile));
  await writeFile(
    path.join(directory, "worker.capnp"),
    `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "inspector", worker = (
    compatibilityDate = "2026-08-27",
    modules = [(name = "inspector.js", esModule = embed "inspector.js"), (name = "app-code", text = embed "app.js")],
    bindings = [(name = "LOADER", workerLoader = ())]
  ))],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "inspector")]
);`,
  );
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(
    workerdBinary(),
    [
      "serve",
      "--experimental",
      path.join(directory, "worker.capnp"),
      `--socket-addr=http=127.0.0.1:${port}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // Preserve executable lookup only; the inspector receives no host credentials.
      // eslint-disable-next-line no-restricted-properties
      env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
    },
  );
  let logs = "";
  let failure: Error | undefined;
  child.once("error", (error) => {
    failure = error;
  });
  child.stdout.on("data", (data) => {
    logs = (logs + String(data)).slice(-4000);
  });
  child.stderr.on("data", (data) => {
    logs = (logs + String(data)).slice(-4000);
  });
  // Hard process timeout also covers infinite loops in untrusted module initialization.
  const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      if (failure || child.exitCode !== null) {
        throw failure ?? new Error(`Isolated inspection failed: ${logs}`);
      }
      let response: Response;
      try {
        response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      if (!response.ok) {
        throw new Error(`App failed isolated inspection (${response.status}): ${logs}`);
      }
      const text = await response.text();
      if (text.length > 1024 * 1024) {
        throw new Error("App metadata exceeds 1 MiB");
      }
      const store = metadata.parse(JSON.parse(text));
      defineSchema(store.schema);
      return store;
    }
    throw new Error(`Timed out inspecting app: ${logs}`);
  } finally {
    clearTimeout(kill);
    if (child.exitCode === null) {
      const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await ended;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
