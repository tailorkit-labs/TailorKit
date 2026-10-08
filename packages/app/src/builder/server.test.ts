import { pathToFileURL } from "node:url";
import { runtimeManifest } from "../server/bundle";
import type { ApplicationModule } from "../server/bundle";
import { readFile, writeFile, rm, readdir, mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { Window } from "happy-dom";
import type { TailorKitClientWithMeta, ViewDefinition, ViewInstance } from "../views";
import type { VNode } from "preact";
import { buildApp } from "./index";
import { readClientManifest } from "./client-views";

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
}, 60_000);

it("builds separate artifacts and rejects accidental imports of server code", async () => {
  const root = path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo");
  const client = await readFile(path.join(root, "src/client.ts"), "utf-8");
  const sourceFiles = await readdir(path.join(root, "src"), { recursive: true });
  try {
    await buildApp({ cwd: root });
    const browser = await readFile(path.join(root, ".tailorkit/client/client.js"), "utf-8");
    const server = await readFile(path.join(root, ".tailorkit/server/server.js"), "utf-8");
    // Keep a small app below this budget, including its schemas and ORM.
    expect(Buffer.byteLength(server)).toBeLessThan(150_000);
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
    const migrationFiles = await readdir(path.join(root, "src/db/migrations"), { recursive: true });
    expect(await readdir(path.join(root, ".tailorkit/migrations"), { recursive: true })).toEqual(
      migrationFiles,
    );
    for (const file of migrationFiles.filter((filename) => filename.endsWith("migration.sql"))) {
      expect(await readFile(path.join(root, ".tailorkit/migrations", file), "utf-8")).toBe(
        await readFile(path.join(root, "src/db/migrations", file), "utf-8"),
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
    await expect(buildApp({ cwd: root, outDir: "src/db/migrations" })).rejects.toThrow(
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
}, 60_000);

it("builds colocated instance resolvers as query-only server actions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-instances-build-"));
  try {
    await symlink(
      path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo/node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.example.com", server: {} };',
    );
    await writeFile(
      path.join(root, "src/server.ts"),
      `
      import { defineServer, tk } from "tailorkit/server";
      export default defineServer({ reports: {
        list: tk.query.handler(() => [{ id: "report_123" }]),
        write: tk.mutation.handler(() => "never"),
        external: tk.action.handler(() => Promise.resolve("never")),
      } });
    `,
    );
    await writeFile(
      path.join(root, "src/private.ts"),
      'export function title(id: string) { return "PRIVATE_SERVER_ONLY:" + id; }',
    );
    const clientSource = `
      import { defineView, defineClient } from "tailorkit/client";
      import { z } from "zod";
      import { title } from "./private";
      const privatePrefix = (() => "PRIVATE_INITIALIZER")();
      const view = defineView({ slot: "page", view: "/",
        instances: {
          dataSchema: z.object({ id: z.string().transform(v => v.toUpperCase()) }),
          resolve: async ({ queries, context, identity, signal, ...other }) => {
            if (Object.keys(other).length) throw new Error("Unexpected resolver capabilities");
            if (Object.keys(queries.reports).join() !== "list") throw new Error("Unexpected query capabilities");
            const reports = await queries.reports.list();
            return reports.map(report => ({ key: report.id, metadata: { title: title(context.userId) + privatePrefix }, data: { id: report.id } }));
          },
        },
        component: () => "BROWSER_COMPONENT_MUST_NOT_RUN:" + view.useInstance().data.id,
      });
      export default defineClient({ slots: { page: { "/": view }, "panel.links": { "/": { ...view, slot: "panel.links" } } } });
    `;
    await writeFile(path.join(root, "src/client.ts"), clientSource);
    await buildApp({ cwd: root });
    const browser = await readFile(path.join(root, ".tailorkit/client/client.js"), "utf8");
    const server = await readFile(path.join(root, ".tailorkit/server/server.js"), "utf8");
    expect(browser).not.toContain("PRIVATE_SERVER_ONLY");
    expect(browser).not.toContain("PRIVATE_INITIALIZER");
    expect(browser).not.toContain("Unexpected resolver capabilities");
    expect(browser).toContain("BROWSER_COMPONENT_MUST_NOT_RUN");
    expect(server).toContain("PRIVATE_SERVER_ONLY");
    expect(server).not.toContain("BROWSER_COMPONENT_MUST_NOT_RUN");
    const application: ApplicationModule = await import(
      pathToFileURL(path.join(root, ".tailorkit/server/server.js")).href
    );
    const internal = application.default.functions._tailorkit as Record<
      string,
      Record<
        string,
        {
          kind: string;
          args: { parse: (args: unknown) => unknown };

          functions: Record<string, unknown>;
          handler: (context: never) => unknown;
        }
      >
    >;
    const manifest = await readClientManifest(path.join(root, ".tailorkit/client/client.js"));
    const names = [...new Set(manifest.instanceResolvers.map((entry) => entry.resolver))];
    expect(names).toHaveLength(1);
    expect(Object.keys(internal.instances!)).toEqual(["resolve"]);
    expect(manifest.views).toEqual([
      { slot: "page", path: "/", instances: true },
      { slot: "panel.links", path: "/", instances: true },
    ]);
    const fn = internal.instances!.resolve!;
    expect(fn.kind).toBe("action");
    expect(browser).toContain(names[0]!);
    expect(Object.keys(fn.functions.reports as object)).toEqual(["list"]);
    const resolved = await fn.handler({
      args: fn.args.parse({ slot: "page", path: "/", context: { userId: "user_123" } }),
      identity: { userId: "user_123" },
      signal: new AbortController().signal,
      queries: { reports: { list: () => Promise.resolve([{ id: "report_123" }]) } },
      mutations: {},
    } as never);
    expect(resolved).toEqual([
      {
        key: "report_123",
        metadata: { title: "PRIVATE_SERVER_ONLY:user_123PRIVATE_INITIALIZER" },
        data: { id: "REPORT_123" },
      },
    ]);
    const shared = await fn.handler({
      args: fn.args.parse({ slot: "panel.links", path: "/", context: { userId: "user_123" } }),
      identity: { userId: "user_123" },
      signal: new AbortController().signal,
      queries: { reports: { list: () => Promise.resolve([{ id: "report_123" }]) } },
    } as never);
    expect(shared).toEqual(resolved);
    const window = new Window();
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
    try {
      const module = await import(
        `data:text/javascript;base64,${Buffer.from(browser).toString("base64")}`
      );
      const client = module.default as TailorKitClientWithMeta;
      const component = (client.slots as Record<string, Record<string, ViewDefinition>>).page?.[
        "/"
      ];
      expect(component).toBeTruthy();
      if (!component) throw new Error("Missing compiled view");
      const container = window.document.createElement("div");
      const show = (instance: ViewInstance) =>
        client.$runtime.render(
          client.$runtime.h(component.component, {
            view: "/",
            status: "ready",
            context: { workspaceId: "w1" },
            instance,
          }) as VNode,
          container as unknown as Element,
        );
      show((resolved as ViewInstance[])[0]!);
      expect(container.textContent).toBe("BROWSER_COMPONENT_MUST_NOT_RUN:REPORT_123");
      show({ key: "summary", metadata: {}, data: { id: "SUMMARY" } });
      expect(container.textContent).toBe("BROWSER_COMPONENT_MUST_NOT_RUN:SUMMARY");
      client.$runtime.render(
        client.$runtime.h(component.component, { view: "/", status: "loading" }) as VNode,
        container as unknown as Element,
      );
      expect(container.textContent).toBe("");
      client.$runtime.render(null, container as unknown as Element);
    } finally {
      if (previousDocument === undefined) Reflect.deleteProperty(globalThis, "document");
      else
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
      await window.happyDOM.close();
    }
    await buildApp({ cwd: root, outDir: ".tailorkit/custom" });
    expect(await readFile(path.join(root, ".tailorkit/custom/client/client.js"), "utf8")).toBe(
      browser,
    );
    const watcher = (await buildApp({ cwd: root, watch: true, outDir: ".tailorkit/watched" })) as {
      close(): Promise<void>;
    };
    const watchedServer = path.join(root, ".tailorkit/watched/server/server.js");
    try {
      expect(await readFile(watchedServer, "utf8")).toContain("PRIVATE_SERVER_ONLY");
      await writeFile(
        path.join(root, "src/private.ts"),
        'export function title(id: string) { return "PRIVATE_UPDATED:" + id; }',
      );
      await expect
        .poll(async () => (await readFile(watchedServer, "utf8")).includes("PRIVATE_UPDATED"), {
          timeout: 10_000,
        })
        .toBe(true);
      await writeFile(
        path.join(root, "src/client.ts"),
        clientSource.replace("PRIVATE_INITIALIZER", "RESOLVER_UPDATED"),
      );
      await expect
        .poll(
          async () =>
            (await readFile(watchedServer, "utf8").catch(() => "")).includes("RESOLVER_UPDATED"),
          { timeout: 10_000 },
        )
        .toBe(true);
      expect(
        await readFile(path.join(root, ".tailorkit/watched/client/client.js"), "utf8"),
      ).toContain(names[0]!);
      await writeFile(
        path.join(root, "src/client.ts"),
        'import { defineClient } from "tailorkit/client"; export default defineClient({ slots: {} });',
      );
      await expect
        .poll(
          async () => {
            const output = await readFile(watchedServer, "utf8").catch(() => "");
            return !!output && !output.includes("RESOLVER_UPDATED");
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      const withoutInstances: ApplicationModule = await import(
        `${pathToFileURL(watchedServer).href}?instances-removed`
      );
      expect(Object.hasOwn(withoutInstances.default.functions, "_tailorkit")).toBe(false);
    } finally {
      await watcher.close();
    }
    await writeFile(path.join(root, "src/client.ts"), clientSource);
    await writeFile(
      path.join(root, "no-server.config.mjs"),
      'export default { host: "https://host.example.com" };',
    );
    await expect(buildApp({ cwd: root, configPath: "no-server.config.mjs" })).rejects.toThrow(
      "require server configuration",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
