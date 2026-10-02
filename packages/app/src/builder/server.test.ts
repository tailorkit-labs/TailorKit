import { pathToFileURL } from "node:url";
import { runtimeManifest } from "../server/bundle";
import type { ApplicationModule } from "../server/bundle";
import { readFile, writeFile, rm, readdir, mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { buildApp } from "./index";

it("builds configured entries and blocks the configured server from the browser", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-custom-entries-"));
  try {
    await symlink(
      path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo/node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.example.com", client: { entry: "./ui/browser.ts" }, server: { entry: "./backend/api.ts" } };',
    );
    for (const directory of ["src", "ui", "backend"]) await mkdir(path.join(root, directory));
    await writeFile(path.join(root, "src/client.ts"), 'throw new Error("Unused default client");');
    await writeFile(path.join(root, "src/server.ts"), 'throw new Error("Unused default server");');
    const client =
      'import { defineClient } from "tailorkit/client";\nexport const marker = "Configured client loaded";\nexport default defineClient({ slots: {} });';
    await writeFile(path.join(root, "ui/browser.ts"), client);
    await writeFile(
      path.join(root, "backend/api.ts"),
      'import { defineServer, tk } from "tailorkit/server";\nconst app = defineServer({ configured: tk.query.handler(() => "Configured server loaded") });\nexport default app;',
    );
    await writeFile(
      path.join(root, "backend/helper.ts"),
      'export const value = "Lazy server helper";',
    );
    await writeFile(
      path.join(root, "backend/api.ts"),
      'import { defineServer, tk } from "tailorkit/server"; export default defineServer({ configured: tk.query.handler(() => "Configured server loaded"), lazy: tk.action.handler(async () => (await import("./helper")).value) });',
    );
    await buildApp({ cwd: root });
    expect(await readdir(path.join(root, ".tailorkit/server"))).toEqual(["server.js"]);
    expect(await readdir(path.join(root, ".tailorkit/tmp"))).toEqual([]);
    const browser = await readFile(path.join(root, ".tailorkit/client/client.js"), "utf8");
    const server = await readFile(path.join(root, ".tailorkit/server/server.js"), "utf8");
    expect(browser).toContain("Configured client loaded");
    expect(server).toContain("Configured server loaded");
    expect(server).toContain("Lazy server helper");
    expect(server).not.toContain("./assets/");
    const application: ApplicationModule = await import(
      pathToFileURL(path.join(root, ".tailorkit/server/server.js")).href
    );
    expect(application.runtimeManifest).toEqual(runtimeManifest);
    expect(application.default.functions.configured?.kind).toBe("query");
    expect(application.migrations).toEqual([]);
    expect(browser).not.toContain("Configured server loaded");
    expect(browser).not.toContain("Unused default client");
    expect(server).not.toContain("Unused default server");
    await writeFile(
      path.join(root, "ui/browser.ts"),
      'import type app from "../backend/api";\n' + client,
    );
    await expect(buildApp({ cwd: root })).resolves.toBeDefined();
    await writeFile(path.join(root, "ui/browser.ts"), 'import "../backend/api";\n' + client);
    await expect(buildApp({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("builds separate artifacts and rejects accidental imports of server code", async () => {
  const root = path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo");
  const client = await readFile(path.join(root, "src/client.ts"), "utf-8");
  const sourceFiles = await readdir(path.join(root, "src"), { recursive: true });
  try {
    await buildApp({ cwd: root });
    const browser = await readFile(path.join(root, ".tailorkit/client/client.js"), "utf-8");
    const server = await readFile(path.join(root, ".tailorkit/server/server.js"), "utf-8");
    expect(server).not.toContain("tailorkit_receipts");
    expect(server).not.toContain("cloudflare:workers");
    expect(server).not.toContain("node:async_hooks");
    expect(server).not.toContain("CREATE TABLE IF NOT EXISTS tailorkit_migrations");
    expect(server).toContain("CREATE TABLE `todos`");
    expect(browser).not.toContain("tailorkit_migrations");
    expect(browser).not.toContain("CREATE TABLE `todos`");
    expect(browser).not.toContain("tailorkit_receipts");
    expect(browser).not.toContain("Todo does not exist");
    expect(browser).not.toContain("cloudflare:workers");
    expect(browser).not.toContain("jwtVerify");
    expect(browser).not.toContain("SignJWT");
    expect(await readdir(path.join(root, "src"), { recursive: true })).toEqual(sourceFiles);
    expect(sourceFiles).not.toContain("server.gen.ts");
    expect(
      JSON.parse(await readFile(path.join(root, ".tailorkit/tailorkit-upload.json"), "utf-8"))
        .assets,
    ).toEqual({ client: "client/client.js", server: "server/server.js" });
    const migrationFiles = await readdir(path.join(root, "migrations"), { recursive: true });
    expect(await readdir(path.join(root, ".tailorkit/migrations"), { recursive: true })).toEqual(
      migrationFiles,
    );
    for (const file of migrationFiles.filter((filename) => filename.endsWith("migration.sql"))) {
      expect(await readFile(path.join(root, ".tailorkit/migrations", file), "utf-8")).toBe(
        await readFile(path.join(root, "migrations", file), "utf-8"),
      );
    }
    await buildApp({ cwd: root, outDir: ".tailorkit/custom" });
    expect(await readFile(path.join(root, ".tailorkit/custom/client/client.js"), "utf-8")).toBe(
      browser,
    );
    const customServer = await readFile(
      path.join(root, ".tailorkit/custom/server/server.js"),
      "utf-8",
    );
    expect(customServer).not.toContain("CREATE TABLE IF NOT EXISTS tailorkit_migrations");
    expect(customServer).toContain("CREATE TABLE `todos`");
    expect(
      await readdir(path.join(root, ".tailorkit/custom/migrations"), { recursive: true }),
    ).toEqual(migrationFiles);
    await writeFile(path.join(root, "src/client.ts"), `import "./server";\n${client}`);
    await expect(buildApp({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle",
    );
    await writeFile(path.join(root, "src/client.ts"), `import "tailorkit/server";\n${client}`);
    await expect(buildApp({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle",
    );
    await expect(buildApp({ cwd: root, outDir: "migrations" })).rejects.toThrow(
      "must not overlap migration source",
    );
    await writeFile(path.join(root, "src/client.ts"), `import "effect";\n${client}`);
    await expect(buildApp({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle",
    );
  } finally {
    await writeFile(path.join(root, "src/client.ts"), client);
    await rm(path.join(root, ".tailorkit"), { recursive: true, force: true });
  }
}, 15_000);
