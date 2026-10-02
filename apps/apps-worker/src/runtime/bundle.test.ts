import { expect, it, vi } from "vite-plus/test";
import { defineServer, tk } from "@tailorkit/app/server";
import { createApplicationExecution } from "./bundle";

const application = {
  default: defineServer({ value: tk.query.handler(() => "ready") }),
  migrations: [],
  runtimeManifest: { apiVersion: 1, requires: ["database", "actions"] },
};
function persistence() {
  const transactions = vi.fn();
  return {
    execute: vi.fn(() => ({ rows: [], columns: [], changes: 0 })),
    transactions,
    transaction<T>(run: () => T): T {
      transactions();
      return run();
    },
  };
}
it.each([[], ["database"], ["database", "actions"]])(
  "accepts supported required features %j",
  (...requires: string[]) => {
    const db = persistence();
    const execution = createApplicationExecution(
      { ...application, runtimeManifest: { apiVersion: 1, requires } },
      db,
    );
    expect(
      execution.query(
        { name: "value" },
        {
          userId: "u",
          projectId: "p",
          appId: "a",
          installationId: "i",
          deploymentId: "d",
          expiresAt: Date.now() + 60_000,
        },
      ).value,
    ).toBe("ready");
  },
);
it.each([
  { ...application, runtimeManifest: undefined },
  { ...application, runtimeManifest: { apiVersion: 2, requires: [] } },
  { ...application, runtimeManifest: { apiVersion: 1, requires: ["scheduling"] } },
  { ...application, default: null },
  { ...application, migrations: undefined },
])("rejects incompatible exports before any database access", (module) => {
  const db = persistence();
  expect(() => createApplicationExecution(module, db)).toThrow();
  try {
    createApplicationExecution(module, db);
  } catch (error) {
    expect(error).toMatchObject({ code: "INCOMPATIBLE_VERSION" });
  }
  expect(db.execute).not.toHaveBeenCalled();
  expect(db.transactions).not.toHaveBeenCalled();
});
it("ignores additional module exports for additive features", () => {
  expect(() =>
    createApplicationExecution({ ...application, optionalMetadata: {} }, persistence()),
  ).not.toThrow();
});
