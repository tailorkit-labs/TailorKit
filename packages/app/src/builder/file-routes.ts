import { readdir, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { parseSync } from "vite";
import type { ESTree, Plugin } from "vite";

const clientRuntimeImport = "tailorkit:file-client-runtime";
const clientImports = new Set([
  "tailorkit/client",
  "tailorkit/app",
  "tailorkit/app/client",
  "@tailorkit/app/client",
  "@tailorkit/app",
]);

export function fileViewLocation(filename: string, root: string) {
  const relative = path.relative(path.join(root, "src/slots"), filename).split(path.sep);
  if (relative.length < 2 || relative[0] === ".." || !filename.endsWith(".view.tsx")) {
    return;
  }
  const [slot, ...routeSegments] = relative;
  if (!slot) {
    return;
  }
  const basename = routeSegments.join("/").slice(0, -".view.tsx".length);
  return { slot, path: routePath(basename, filename) };
}

function routePath(name: string, filename: string) {
  const segments = name.split(/[./]/u);
  if (segments.some((segment) => !segment || segment === "..")) {
    throw new Error(`${filename} has an empty route segment. Use route.nested-route.view.tsx.`);
  }
  return `/${segments.join("/")}`;
}

/** Fill missing defineView options before instance extraction, on both build sides. */
export function inferFileView(source: string, filename: string, root: string): string {
  const location = fileViewLocation(filename, root);
  if (!location) {
    return source;
  }
  const { slot, path: viewPath } = location;
  const parsed = parseSync(filename, source);
  if (parsed.errors.length) {
    throw new Error(`${filename}: ${parsed.errors[0]?.message}`);
  }
  const aliases = new Set<string>();
  for (const node of parsed.program.body) {
    if (node.type !== "ImportDeclaration" || !clientImports.has(String(node.source.value))) {
      continue;
    }
    for (const specifier of node.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier" &&
        specifier.imported.name === "defineView"
      ) {
        aliases.add(specifier.local.name);
      }
    }
  }
  const edits: { position: number; text: string }[] = [];
  function visit(node: ESTree.Node) {
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      aliases.has(node.callee.name)
    ) {
      const options = node.arguments[0];
      if (options?.type !== "ObjectExpression") {
        throw new Error(
          `${filename}: file views require defineView with an inline options object.`,
        );
      }
      const properties = new Set(
        options.properties.flatMap((property) => {
          if (property.type !== "Property" || property.computed) {
            return [];
          }
          if (property.key.type === "Identifier") {
            return [property.key.name];
          }
          if (property.key.type === "Literal") {
            return [String(property.key.value)];
          }
          return [];
        }),
      );
      // Defaults precede spreads, so an explicit view override is respected.
      const defaults = [
        !properties.has("slot") ? `slot: ${JSON.stringify(slot)},` : "",
        !properties.has("view") ? `view: ${JSON.stringify(viewPath)},` : "",
      ].join("");
      if (defaults) {
        edits.push({ position: options.start + 1, text: defaults });
      }
    }
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child && typeof child === "object" && "type" in child) {
          visit(child as ESTree.Node);
        }
      }
    }
  }
  visit(parsed.program);
  for (const edit of edits.toSorted((a, b) => b.position - a.position)) {
    source = source.slice(0, edit.position) + edit.text + source.slice(edit.position);
  }
  return source;
}

export async function discoverFileRoutes(root: string) {
  const views: { filename: string; slot: string }[] = [];
  const roots: { filename: string; slot: string }[] = [];
  const layouts: { filename: string; slot: string; path: string }[] = [];
  const slotsDir = path.join(root, "src/slots");
  async function scan(directory: string, slot?: string, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      },
    );
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(filename, slot ?? entry.name, slot ? `${prefix}${entry.name}/` : "");
      } else if (entry.isFile() && slot) {
        if (entry.name.endsWith(".view.tsx")) {
          fileViewLocation(filename, root);
          views.push({ filename, slot });
        } else if (entry.name === "root.tsx" && !prefix) {
          roots.push({ filename, slot });
        } else if (entry.name === "layout.tsx" || entry.name.endsWith(".layout.tsx")) {
          const name =
            entry.name === "layout.tsx"
              ? prefix.replace(/\/$/u, "")
              : prefix + entry.name.slice(0, -".layout.tsx".length);
          layouts.push({ filename, slot, path: name ? routePath(name, filename) : "/" });
        }
      }
    }
  }
  await scan(slotsDir);
  const rootFile = path.join(root, "src/root.tsx");
  return {
    root: existsSync(rootFile) ? { filename: rootFile } : undefined,
    roots,
    layouts,
    views,
  };
}

/** Source files to check when there is no handwritten browser entry. */
export async function getClientSourceFiles(root: string, entry?: string) {
  const legacyEntry = path.resolve(root, entry ?? "src/client.ts");
  if (entry || existsSync(legacyEntry)) {
    return [legacyEntry];
  }
  const discovered = await discoverFileRoutes(root);
  const bindings = path.join(root, "src/tailorkit.gen.ts");
  return [
    ...(discovered.root ? [discovered.root.filename] : []),
    ...discovered.roots.map((module) => module.filename),
    ...discovered.layouts.map((module) => module.filename),
    ...discovered.views.map((module) => module.filename),
    ...(existsSync(bindings) ? [bindings] : []),
  ];
}

async function fileClientSource(root: string) {
  const discovered = await discoverFileRoutes(root);
  const imports = [`import { createFileClient } from ${JSON.stringify(clientRuntimeImport)};`];
  let index = 0;
  function module(entry: { filename: string }) {
    const binding = `module${index++}`;
    imports.push(`import ${binding} from ${JSON.stringify(entry.filename)};`);
    return `{ filename: ${JSON.stringify(path.relative(root, entry.filename))}, definition: ${binding}`;
  }
  const rootModule = discovered.root ? `${module(discovered.root)} }` : "undefined";
  const roots = discovered.roots.map(
    (entry) => `${module(entry)}, slot: ${JSON.stringify(entry.slot)} }`,
  );
  const layouts = discovered.layouts.map(
    (entry) =>
      `${module(entry)}, slot: ${JSON.stringify(entry.slot)}, path: ${JSON.stringify(entry.path)} }`,
  );
  const views = discovered.views.map(
    (entry) => `${module(entry)}, slot: ${JSON.stringify(entry.slot)} }`,
  );
  return `${imports.join("\n")}\nexport default createFileClient({ root: ${rootModule}, roots: [${roots.join(",")}], layouts: [${layouts.join(",")}], views: [${views.join(",")}] });`;
}

/** A generated entry in build output lets the bundler track imports normally.
 * Directory watching also covers routes that did not exist at the first build. */
export async function createFileRouteEntry(root: string, output: string, watching: boolean) {
  let source = await fileClientSource(root);
  const temporaryRoot = path.join(output, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, "client-"));
  const entry = path.join(directory, "entry.ts");
  await writeFile(entry, source);
  let pending = Promise.resolve();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh() {
    if (closed) {
      return;
    }
    let next: string;
    try {
      next = await fileClientSource(root);
    } catch (error) {
      // Surface discovery errors through the next bundler build.
      next = `throw new Error(${JSON.stringify(error instanceof Error ? error.message : String(error))});`;
    }
    if (next === source) {
      return;
    }
    source = next;
    await writeFile(entry, next);
  }
  const watcher = watching
    ? watch(path.join(root, "src"), { recursive: true }, () => {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          pending = pending.then(refresh);
        }, 25);
      })
    : undefined;
  return {
    entry,
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
      watcher?.close();
      try {
        await pending;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export function fileRoutesPlugin(root: string): Plugin {
  return {
    name: "tailorkit-file-routes",
    enforce: "pre",
    resolveId(id) {
      if (id !== clientRuntimeImport) {
        return;
      }
      // Resolve from the app even when its build output is outside the project.
      const importer = path.join(root, "src/root.tsx");
      const sdk = existsSync(path.join(root, "node_modules/tailorkit"))
        ? "tailorkit/client"
        : "@tailorkit/app/client";
      return this.resolve(sdk, importer, { skipSelf: true });
    },
    transform(source, filename) {
      if (!filename.endsWith(".view.tsx")) {
        return;
      }
      const code = inferFileView(source, filename, root);
      return code === source ? undefined : { code, map: null };
    },
  };
}
