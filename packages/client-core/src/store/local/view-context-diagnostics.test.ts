import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Schema } from "@tailorkit/core/schema";
import { z } from "zod";
import { createViewContextStore } from "./view-context";

const requiredContext = z.object({ customer: z.object({ id: z.string() }) });
const setup = (schema: Schema = requiredContext) =>
  createViewContextStore({ views: { "/": schema } });
afterEach(() => vi.restoreAllMocks());

it("strips nested extra fields using the original schema without mutating the input", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  const context = { customer: { id: "c1", email: "private@example.com" }, extra: true };
  store.register({ id: Symbol(), view: "/", context });
  await Promise.resolve();
  expect(store.state.get()?.layers).toEqual([
    { path: "/", context: { customer: { id: "c1" } }, status: "ready" },
  ]);
  expect(context.customer.email).toBe("private@example.com");
  expect(error).not.toHaveBeenCalled();
});

it("preserves the schema's transforms and refinements", async () => {
  const store = setup(z.object({ name: z.string().trim().min(1) }));
  store.register({ id: Symbol(), view: "/", context: { name: "  Alice  " } });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.context).toEqual({ name: "Alice" });
});

it("honors explicitly loose and strict schemas", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const loose = setup(z.looseObject({ name: z.string() }));
  const strict = setup(z.strictObject({ name: z.string() }));
  const context = { name: "Alice", extra: true };
  loose.register({ id: Symbol(), view: "/", context });
  strict.register({ id: Symbol(), view: "/", context });
  await Promise.resolve();
  expect(loose.state.get()?.layers[0]?.context).toEqual(context);
  expect(strict.state.get()?.layers[0]).toMatchObject({ status: "error", context: undefined });
  expect(error).toHaveBeenCalledOnce();
});

it("logs missing required context once across synchronous cleanup and remount", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  const id = Symbol();
  const entry = { id, view: "/", context: undefined };
  store.register(entry);
  store.unregister(id);
  store.register(entry);
  store.register({ ...entry, loading: false, error: null });
  await Promise.resolve();
  expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("required context"));
  expect(store.state.get()?.layers[0]?.status).toBe("error");
  store.register({ ...entry, context: { customer: { id: "c1" } } });
  store.register(entry);
  expect(error).toHaveBeenCalledTimes(2);
});

it("allows omitted context through an optional native schema", async () => {
  const store = setup(requiredContext.optional());
  store.register({ id: Symbol(), view: "/", context: undefined });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]).toEqual({ path: "/", context: undefined, status: "ready" });
});

it("skips validation while loading and lets request errors take precedence", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  const id = Symbol();
  store.register({ id, view: "/", context: {}, loading: true });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.status).toBe("loading");
  store.register({ id, view: "/", context: {}, loading: true, error: new Error("offline") });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.status).toBe("error");
  expect(error).not.toHaveBeenCalled();
});

it("reports native issue paths and withholds invalid context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = setup();
  store.register({ id: Symbol(), view: "/", context: { customer: { id: 123 } } });
  await Promise.resolve();
  expect(error).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("does not match"),
    expect.arrayContaining([expect.objectContaining({ path: ["customer", "id"] })]),
  );
  expect(store.state.get()?.layers[0]).toMatchObject({ status: "error", context: undefined });
});

it("waits for asynchronous validation and ignores results for replaced or unmounted registrations", async () => {
  const pending: (() => void)[] = [];
  const base = z.object({ name: z.string() });
  const schema: Schema = {
    "~standard": {
      version: 1,
      vendor: "async-test",
      validate: async (input) => {
        const value = base.parse(input);
        await new Promise<void>((resolve) => pending.push(resolve));
        return { value: { name: value.name.toUpperCase() } };
      },
    },
  };
  const store = setup(schema);
  const id = Symbol();
  store.register({ id, view: "/", context: { name: "old" } });
  await Promise.resolve();
  expect(store.state.get()?.layers[0]).toMatchObject({ status: "loading", context: undefined });
  store.register({ id, view: "/", context: { name: "new" } });
  pending[1]!();
  await vi.waitFor(() => expect(store.state.get()?.layers[0]?.context).toEqual({ name: "NEW" }));
  pending[0]!();
  await Promise.resolve();
  expect(store.state.get()?.layers[0]?.context).toEqual({ name: "NEW" });
  store.register({ id, view: "/", context: { name: "unmounted" } });
  store.unregister(id);
  pending[2]!();
  await vi.waitFor(() => expect(store.state.get()).toBeNull());
});

it("handles rejected and thrown validators without leaking context", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const validate of [
    () => {
      throw new Error("failed");
    },
    () => Promise.reject(new Error("failed")),
  ]) {
    const schema: Schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate,
      },
    };
    const store = setup(schema);
    store.register({ id: Symbol(), view: "/", context: {} });
    await vi.waitFor(() => expect(store.state.get()?.layers[0]?.status).toBe("error"));
  }
  expect(error).toHaveBeenCalledTimes(2);
});
