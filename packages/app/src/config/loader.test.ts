import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { loadTailorKitConfig } from "./loader";
import { tailorkitConfigSchema } from "./config";

it.each([{ server: { entry: "./backend.ts" } }])(
  "accepts configured server entry points: %j",
  (override) => {
    expect(tailorkitConfigSchema.parse({ host: "https://host.test", ...override })).toEqual({
      host: "https://host.test",
      ...override,
    });
  },
);

it("defaults entries while preserving backend enablement and migration configuration", () => {
  expect(tailorkitConfigSchema.parse({ host: "https://host.test", server: {} })).toEqual({
    host: "https://host.test",
    server: { entry: "src/server.ts" },
  });
  expect(
    tailorkitConfigSchema.parse({
      host: "https://host.test",
      server: { migrations: "./migrations" },
    }),
  ).toEqual({
    host: "https://host.test",
    server: { entry: "src/server.ts", migrations: "./migrations" },
  });
});

it("rejects unsupported storage configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-invalid-config-"));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test", storage: { entry: "./server.ts" } };',
    );
    await expect(loadTailorKitConfig(undefined, root)).rejects.toThrow("Unrecognized key");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects manual client entry configuration", () => {
  expect(() =>
    tailorkitConfigSchema.parse({ host: "https://host.test", client: { entry: "./frontend.ts" } }),
  ).toThrow();
});
