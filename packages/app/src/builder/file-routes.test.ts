import { mkdtemp, mkdir, rm, writeFile, symlink, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { discoverFileRoutes, inferFileView, getClientSourceFiles } from "./file-routes";
import { buildApp } from "./index";
import { readClientManifest } from "./client-views";

it("infers dotted paths and literal slot names while preserving explicit overrides", () => {
  const filename = "/app/src/slots/panel.links/customers.details.view.tsx";
  const source =
    'import { defineView as view } from "tailorkit/client"; export default view({ component: () => null });';
  const inferred = inferFileView(source, filename, "/app");
  expect(inferred).toContain('slot: "panel.links"');
  expect(inferred).toContain('view: "/customers/details"');
  expect(inferFileView(inferred, filename, "/app")).toBe(inferred);
  const override = source.replace("component:", 'view: "/", component:');
  expect(inferFileView(override, filename, "/app")).not.toContain('view: "/customers/details"');
  expect(inferFileView(source, "/app/src/slots/panel/card.tsx", "/app")).toBe(source);
  expect(() => inferFileView(source, "/app/src/slots/panel/a..b.view.tsx", "/app")).toThrow(
    "empty route segment",
  );
});

it("discovers only view and layout files, supports roots, and checks the same sources on deploy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-file-discovery-"));
  try {
    await mkdir(path.join(root, "src/slots/panel.links/components"), { recursive: true });
    for (const file of [
      "root.tsx",
      "slots/panel.links/root.tsx",
      "slots/panel.links/layout.tsx",
      "slots/panel.links/customers.layout.tsx",
      "slots/panel.links/customers.details.view.tsx",
      "slots/panel.links/components/card.tsx",
    ]) {
      await writeFile(path.join(root, "src", file), "export default {}; ");
    }
    const discovered = await discoverFileRoutes(root);
    expect(discovered.views.map(({ slot, filename }) => [slot, path.basename(filename)])).toEqual([
      ["panel.links", "customers.details.view.tsx"],
    ]);
    expect(discovered.layouts.map(({ path: route }) => route)).toEqual(["/customers", "/"]);
    expect(discovered.roots.map(({ slot }) => slot)).toEqual(["panel.links"]);
    expect(await getClientSourceFiles(root)).toHaveLength(5);
    await writeFile(path.join(root, "src/client.ts"), "export default {};");
    expect(await getClientSourceFiles(root)).toHaveLength(5);
    expect(await getClientSourceFiles(root)).not.toContain(path.join(root, "src/client.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("builds file routes with extracted instances and discovers additions, renames and removals in watch mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-file-build-"));
  try {
    await symlink(
      path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo/node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await mkdir(path.join(root, "src/slots/page"), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.example.com", server: {} };',
    );
    await writeFile(
      path.join(root, "src/server.ts"),
      'import { defineServer } from "tailorkit/server"; export default defineServer({});',
    );
    await writeFile(
      path.join(root, "src/root.tsx"),
      'import { defineRoute, ClientProvider } from "tailorkit/client"; export default defineRoute({ shellComponent: ClientProvider });',
    );
    await writeFile(
      path.join(root, "src/slots/page/root.tsx"),
      'import { defineRoute, Route } from "tailorkit/client"; export default defineRoute({ shellComponent: () => <Route /> });',
    );
    await writeFile(
      path.join(root, "src/slots/page/layout.tsx"),
      'import { Route } from "tailorkit/client"; export default () => <Route />;',
    );
    await writeFile(
      path.join(root, "src/slots/page/home.view.tsx"),
      `import { defineView } from "tailorkit/client"; import { z } from "zod";
      export default defineView({ view: "/", component: () => "leaf", instances: { dataSchema: z.object({}), resolve: () => [{ key: "all", metadata: { title: "PRIVATE_RESOLVER" }, data: {} }] } });`,
    );
    await writeFile(
      path.join(root, "src/slots/page/card.tsx"),
      'throw new Error("Ordinary components are not routes");',
    );
    await buildApp({ cwd: root });
    const manifestFile = path.join(root, ".tailorkit/client/client.js");
    const manifest = await readClientManifest(manifestFile);
    expect(manifest.views).toEqual([{ slot: "page", path: "/", instances: true }]);
    expect(await readFile(manifestFile, "utf-8")).not.toContain("PRIVATE_RESOLVER");
    expect(await readFile(path.join(root, ".tailorkit/server/server.js"), "utf-8")).toContain(
      "PRIVATE_RESOLVER",
    );
    const watcher = (await buildApp({ cwd: root, watch: true })) as { close(): Promise<void> };
    try {
      const next = path.join(root, "src/slots/page/customers.details.view.tsx");
      await writeFile(
        next,
        'import { defineView } from "tailorkit/client"; import { z } from "zod"; export default defineView({ component: () => "details", instances: { dataSchema: z.object({}), resolve: () => [{ key: "details", metadata: { title: "INFERRED_RESOLVER" }, data: {} }] } });',
      );
      const paths = async () => {
        const current = await readClientManifest(manifestFile);
        return current.views.map((view) => view.path).toSorted();
      };
      await expect.poll(paths, { timeout: 10_000 }).toEqual(["/", "/customers/details"]);
      await rename(next, path.join(root, "src/slots/page/customers.summary.view.tsx"));
      await expect.poll(paths, { timeout: 10_000 }).toEqual(["/", "/customers/summary"]);
      await rm(path.join(root, "src/slots/page/home.view.tsx"));
      await expect.poll(paths, { timeout: 10_000 }).toEqual(["/customers/summary"]);
      await expect
        .poll(
          async () => {
            const server = await readFile(path.join(root, ".tailorkit/server/server.js"), "utf-8");
            return server.includes("PRIVATE_RESOLVER");
          },
          { timeout: 10_000 },
        )
        .toBe(false);
    } finally {
      await watcher.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it("resolves the client runtime from the app when build output is outside the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-file-client-"));
  const output = await mkdtemp(path.join(tmpdir(), "tailorkit-external-output-"));
  try {
    await symlink(
      path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo/node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await mkdir(path.join(root, "src/slots/panel"), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.example.com" };',
    );
    await writeFile(
      path.join(root, "src/slots/panel/home.view.tsx"),
      'import { defineView } from "tailorkit/client"; export default defineView({ view: "/", component: () => "home" });',
    );
    await buildApp({ cwd: root, outDir: output });
    const manifest = await readClientManifest(path.join(output, "client/client.js"));
    expect(manifest.views).toEqual([{ slot: "panel", path: "/" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});
