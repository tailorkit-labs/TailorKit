import { resultValue } from "./errors";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { installFetchGuard } from "./context";
import { createExecution } from "./execution";
import { defineServer } from "@tailorkit/app/server";
import { tk } from "@tailorkit/app/server";

const nativeFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = nativeFetch;
});
const identity = {
  userId: "u",
  projectId: "p",
  appId: "a",
  installationId: "i",
  deploymentId: "d",
  expiresAt: Date.now() + 60_000,
};
const endpoint = "https://example.com";

function setup() {
  installFetchGuard();
  // Like an SDK: capture fetch once, then use it from nested async helpers.
  const captured = globalThis.fetch;
  const read = tk.query.handler(() => {
    fetch(endpoint);
    return null;
  });
  const write = tk.mutation.handler(() => {
    fetch(endpoint);
    return null;
  });
  let detached: Promise<Response>;
  let release!: () => void;
  const app = defineServer({
    read,
    write,
    nested: tk.action.functions({ read, write }).handler(async ({ queries, mutations }) => {
      await expect(queries.read()).rejects.toThrow("only available inside actions");
      await expect(mutations.write()).rejects.toThrow("only available inside actions");
      const response = await captured(endpoint);
      return response.text();
    }),
    run: tk.action.handler(async () => {
      await Promise.resolve();
      const response = await captured(endpoint);
      return response.text();
    }),
    ended: tk.action.handler(() => {
      detached = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => captured(endpoint));
      detached.catch(() => {});
      return "done";
    }),
  });
  const execution = createExecution(app, {
    execute: () => ({ rows: [], columns: [], changes: 0 }),
    transaction: (run) => run(),
  });
  const calls = (value: string) => ({
    fetch: vi.fn(async () => {
      await Promise.resolve();
      return new Response(value);
    }),
    committed: vi.fn(async () => {}),
  });
  return { execution, calls, release: () => release(), detached: () => detached };
}

it("guards queries, mutations and missing contexts, including nested calls", async () => {
  const { execution, calls } = setup();
  expect(() => fetch(endpoint)).toThrow("only available inside actions");
  expect(() => execution.query({ name: "read" }, identity)).toThrow(
    "only available inside actions",
  );
  expect(() =>
    execution.mutate({ name: "write", requestId: crypto.randomUUID() }, identity),
  ).toThrow("only available inside actions");
  const result = await Effect.runPromise(
    execution.action({ name: "nested" }, identity, calls("nested"), new AbortController().signal),
  );
  expect(result.result).toEqual({ ok: true, value: "nested" });
  expect(result).toMatchObject({ tables: [], committed: false });
});

it("preserves concurrent action contexts and SDK-captured fetch", async () => {
  const { execution, calls } = setup();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      Effect.runPromise(
        execution.action({ name: "run" }, identity, calls(String(i)), new AbortController().signal),
      ),
    ),
  );
  expect(results.map((result) => resultValue(result.result))).toEqual(
    Array.from({ length: 8 }, (_, i) => String(i)),
  );
  expect(() => fetch(endpoint)).toThrow("only available inside actions");
});

it("revokes fetch in retained continuations after action completion", async () => {
  const test = setup();
  const calls = test.calls("unexpected");
  await Effect.runPromise(
    test.execution.action({ name: "ended" }, identity, calls, new AbortController().signal),
  );
  test.release();
  await expect(test.detached()).rejects.toThrow("Action has ended");
  expect(calls.fetch).not.toHaveBeenCalled();
});
