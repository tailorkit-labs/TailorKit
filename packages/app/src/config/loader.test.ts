import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { loadTailorKitConfig } from "./loader";
import { tailorkitConfigSchema } from "./config";

it.each([{ client: { entry: "./frontend.ts" } }, { server: { entry: "./backend.ts" } }])(
  "accepts configured entry points: %j",
  (override) => {
    expect(tailorkitConfigSchema.parse({ host: "https://host.test", ...override })).toEqual({
      host: "https://host.test",
      ...override,
    });
  },
);

it("defaults entries while preserving backend enablement and migration configuration", () => {
  expect(
    tailorkitConfigSchema.parse({ host: "https://host.test", client: {}, server: {} }),
  ).toEqual({
    host: "https://host.test",
    client: { entry: "src/client.ts" },
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

it("rejects legacy storage config instead of silently building a client-only app", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-legacy-config-"));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { storage: { entry: "./server.ts" } };',
    );
    await expect(loadTailorKitConfig(undefined, root)).rejects.toThrow(
      "Use server configuration and @tailorkit/app",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
