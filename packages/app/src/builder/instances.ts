import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSync, transformWithOxc } from "vite";
import type { ESTree, Plugin } from "vite";

type Node = ESTree.Node;
type Import = ESTree.ImportDeclaration;
type Property = Extract<ESTree.ObjectExpression["properties"][number], { type: "Property" }>;
interface Unit {
  node: Node;
  names: string[];
  code: string;
  exported: boolean;
}
interface Resolver {
  name: string;
  view: string;
  call: ESTree.CallExpression;
  instances: Property;
  resolve: Property;
  schema: Property;
}
export interface InstanceModule {
  filename: string;
  names: string[];
}
export interface InstanceRegistration {
  slot: string;
  path: string;
  resolver: string;
}
const suffix = "?tailorkit-instances";
const clientImports = new Set([
  "tailorkit/client",
  "tailorkit/app/client",
  "@tailorkit/app/client",
]);
const browserGlobals = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
]);

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && "type" in value;
}
function children(node: Node): Node[] {
  return Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  );
}
function walk(node: Node, visit: (node: Node, ancestors: Node[]) => void, ancestors: Node[] = []) {
  visit(node, ancestors);
  for (const child of children(node)) walk(child, visit, [...ancestors, node]);
}
function boundNames(node: Node | null | undefined): string[] {
  if (!node) return [];
  switch (node.type) {
    case "Identifier":
      return [node.name];
    case "RestElement":
      return boundNames(node.argument);
    case "AssignmentPattern":
      return boundNames(node.left);
    case "ArrayPattern":
      return node.elements.flatMap(boundNames);
    case "ObjectPattern":
      return node.properties.flatMap((p) =>
        boundNames(p.type === "Property" ? p.value : p.argument),
      );
    default:
      return [];
  }
}
function declarations(node: Node): string[] {
  if (node.type === "VariableDeclaration")
    return node.declarations.flatMap((d) => boundNames(d.id));
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration")
    return boundNames(node.id);
  return [];
}
function isFunction(node: Node) {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
    node.type,
  );
}

/** Lexical references, excluding property names and bindings local to a function/block. */
function freeNames(root: Node): Set<string> {
  const references = new Set<string>();
  function pattern(node: Node, scope: Set<string>) {
    if (node.type === "AssignmentPattern") {
      visit(node.right, scope);
      pattern(node.left, scope);
    } else if (node.type === "ObjectPattern") {
      for (const p of node.properties) {
        if (p.type === "Property") {
          if (p.computed) visit(p.key, scope);
          pattern(p.value, scope);
        } else pattern(p.argument, scope);
      }
    } else if (node.type === "ArrayPattern") {
      for (const element of node.elements) if (element) pattern(element, scope);
    } else if (node.type === "RestElement") pattern(node.argument, scope);
  }
  function visit(node: Node, parent: Set<string>) {
    if (node.type === "Identifier") {
      if (!parent.has(node.name)) references.add(node.name);
      return;
    }
    if (node.type === "ImportDeclaration") return;
    if (node.type === "ExportSpecifier") {
      visit(node.local, parent);
      return;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const scope = new Set([
        ...parent,
        ...boundNames(node.id),
        ...node.params.flatMap(boundNames),
      ]);
      // var declarations are function-scoped, including those inside nested blocks.
      function hoisted(body: Node) {
        if (isFunction(body)) return;
        if (body.type === "VariableDeclaration" && body.kind === "var") {
          for (const name of declarations(body)) scope.add(name);
        }
        for (const child of children(body)) hoisted(child);
      }
      if (node.body) hoisted(node.body);
      for (const p of node.params) pattern(p, scope);
      if (node.body) visit(node.body, scope);
      return;
    }
    if (node.type === "BlockStatement" || node.type === "Program") {
      const scope = new Set([...parent, ...node.body.flatMap(declarations)]);
      for (const statement of node.body) visit(statement, scope);
      return;
    }
    if (node.type === "VariableDeclarator") {
      pattern(node.id, parent);
      if (node.init) visit(node.init, parent);
      return;
    }
    if (
      node.type === "Property" ||
      node.type === "MethodDefinition" ||
      node.type === "PropertyDefinition"
    ) {
      if (node.computed) visit(node.key, parent);
      if (node.value) visit(node.value, parent);
      return;
    }
    if (node.type === "MemberExpression") {
      visit(node.object, parent);
      if (node.computed) visit(node.property, parent);
      return;
    }
    if (node.type === "CatchClause") {
      const scope = new Set([...parent, ...boundNames(node.param)]);
      if (node.param) pattern(node.param, scope);
      visit(node.body, scope);
      return;
    }
    if (
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      const declaration = node.type === "ForStatement" ? node.init : node.left;
      const scope = new Set([...parent, ...(declaration ? declarations(declaration) : [])]);
      for (const child of children(node)) visit(child, scope);
      return;
    }
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const scope = new Set([...parent, ...boundNames(node.id)]);
      if (node.superClass) visit(node.superClass, scope);
      visit(node.body, scope);
      return;
    }
    if (node.type === "LabeledStatement") {
      visit(node.body, parent);
      return;
    }
    if (node.type === "BreakStatement" || node.type === "ContinueStatement") return;
    for (const child of children(node)) visit(child, parent);
  }
  visit(root, new Set());
  return references;
}
function property(node: ESTree.ObjectExpression, name: string): Property | undefined {
  return node.properties.find(
    (p): p is Property =>
      p.type === "Property" &&
      !p.computed &&
      (p.key.type === "Identifier"
        ? p.key.name === name
        : p.key.type === "Literal" && p.key.value === name),
  );
}
function parse(filename: string, source: string) {
  const result = parseSync(filename, source);
  if (result.errors.length)
    throw new Error(`Unable to parse ${filename}: ${result.errors[0]?.message}`);
  return result.program;
}
function units(program: ESTree.Program, source: string) {
  const imports: Import[] = [];
  const statements: Unit[] = [];
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      imports.push(statement);
      continue;
    }
    const exported =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
    const node =
      statement.type === "ExportNamedDeclaration" && statement.declaration
        ? statement.declaration
        : statement;
    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations)
        statements.push({
          node: d,
          names: boundNames(d.id),
          code: `${exported ? "export " : ""}${node.kind} ${source.slice(d.start, d.end)};`,
          exported,
        });
    } else
      statements.push({
        node,
        names: declarations(node),
        code: source.slice(statement.start, statement.end),
        exported,
      });
  }
  return { imports, statements };
}
function closure(roots: Iterable<string>, statements: Unit[]) {
  const bindings = new Map(statements.flatMap((u) => u.names.map((name) => [name, u] as const)));
  const names = new Set<string>();
  const selected = new Set<Unit>();
  function add(name: string) {
    if (names.has(name)) return;
    names.add(name);
    const unit = bindings.get(name);
    if (!unit || selected.has(unit)) return;
    selected.add(unit);
    for (const ref of freeNames(unit.node)) add(ref);
  }
  for (const root of roots) add(root);
  return { names, selected };
}
function renderImports(
  imports: Import[],
  needed: (name: string) => boolean,
  source: string,
  sideEffects: boolean,
) {
  return imports
    .flatMap((i) => {
      if (!i.specifiers.length) return sideEffects ? [source.slice(i.start, i.end)] : [];
      const parts = i.specifiers.filter((s) => needed(s.local.name));
      if (!parts.length) return [];
      const defaultImport = parts.find((s) => s.type === "ImportDefaultSpecifier");
      const namespace = parts.find((s) => s.type === "ImportNamespaceSpecifier");
      const named = parts.filter((s): s is ESTree.ImportSpecifier => s.type === "ImportSpecifier");
      const clauses = [
        defaultImport?.local.name,
        namespace ? `* as ${namespace.local.name}` : undefined,
        named.length
          ? `{ ${named.map((s) => `${source.slice(s.imported.start, s.imported.end)} as ${s.local.name}`).join(", ")} }`
          : undefined,
      ].filter(Boolean);
      return [`import ${clauses.join(", ")} from ${JSON.stringify(i.source.value)};`];
    })
    .join("\n");
}

export async function extractInstances(
  filename: string,
  source: string,
  root: string,
  includedNames?: string[],
) {
  const transformed = await transformWithOxc(source, filename, {
    jsx: { importSource: "preact" },
    sourcemap: false,
  });
  source = transformed.code;
  const program = parse(filename.replace(/\.[^.]+$/u, ".js"), source);
  const aliases = new Set<string>();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      !clientImports.has(String(statement.source.value))
    )
      continue;
    for (const s of statement.specifiers) {
      if (
        s.type === "ImportSpecifier" &&
        s.imported.type === "Identifier" &&
        s.imported.name === "createView"
      )
        aliases.add(s.local.name);
    }
  }
  let resolvers: Resolver[] = [];
  walk(program, (node, ancestors) => {
    if (
      node.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      !aliases.has(node.callee.name)
    )
      return;
    const options = node.arguments[1];
    if (options?.type !== "ObjectExpression") return;
    const instances = property(options, "instances");
    if (!instances) return;
    const fail = (message: string): never => {
      throw new Error(`${filename}: ${message}`);
    };
    if (ancestors.some(isFunction))
      fail("createView with instances must be declared at module scope.");
    const owner = ancestors.findLast((n) => n.type === "VariableDeclarator");
    const viewName =
      owner?.type === "VariableDeclarator" && owner.id.type === "Identifier"
        ? owner.id.name
        : "default";
    const view = node.arguments[0];
    if (view?.type !== "Literal" || typeof view.value !== "string")
      fail("Instance view paths must be string literals.");
    if (instances.value.type !== "ObjectExpression")
      fail("instances must be an inline object with dataSchema and resolve.");
    const config = instances.value as ESTree.ObjectExpression;
    if (config.properties.some((p) => p.type !== "Property" || p.computed || p.kind !== "init"))
      fail("Instance options cannot contain spreads, getters or computed properties.");
    const resolve = property(config, "resolve");
    const schema = property(config, "dataSchema");
    if (
      !resolve ||
      !schema ||
      resolve.method ||
      !["ArrowFunctionExpression", "FunctionExpression"].includes(resolve.value.type)
    )
      fail("instances requires dataSchema and an inline resolve function.");
    const name = `i${createHash("sha256")
      .update(
        `${path.relative(root, filename).split(path.sep).join("/")}\0${viewName}\0${(view as ESTree.StringLiteral).value}`,
      )
      .digest("hex")
      .slice(0, 24)}`;
    if (resolvers.some((r) => r.name === name))
      fail("Instance resolvers must have distinct module-level variable names.");
    resolvers.push({
      name,
      view: (view as ESTree.StringLiteral).value,
      call: node,
      instances,
      resolve: resolve!,
      schema: schema!,
    });
  });
  if (includedNames) {
    resolvers = resolvers.filter((r) => includedNames.includes(r.name));
    if (resolvers.length !== includedNames.length)
      throw new Error(`${filename}: Instance definitions changed; rebuild the app client.`);
  }
  if (!resolvers.length) return;
  const original = units(program, source);
  const server = closure(
    resolvers.flatMap((r) => [...freeNames(r.resolve.value), ...freeNames(r.schema.value)]),
    original.statements,
  );
  for (const name of server.names) {
    if (browserGlobals.has(name))
      throw new Error(`${filename}: Instance resolvers cannot access browser global ${name}.`);
  }
  for (const unit of server.selected) {
    if (resolvers.some((r) => unit.node.start <= r.call.start && unit.node.end >= r.call.end))
      throw new Error(
        `${filename}: Instance resolvers cannot capture a view definition. Use the supplied context and queries.`,
      );
  }
  const serverSource = [
    renderImports(original.imports, (name) => server.names.has(name), source, false),
    ...original.statements
      .filter((u) => server.selected.has(u))
      .map((u) => u.code.replace(/^export /u, "")),
    `export const resolvers = { ${resolvers.map((r) => `${r.name}: { dataSchema: ${source.slice(r.schema.value.start, r.schema.value.end)}, resolve: ${source.slice(r.resolve.value.start, r.resolve.value.end)} }`).join(", ")} };`,
  ].join("\n");
  let browserSource = source;
  for (const r of [...resolvers].sort(
    (a, b) => b.instances.value.start - a.instances.value.start,
  )) {
    browserSource =
      browserSource.slice(0, r.instances.value.start) +
      `{ resolver: ${JSON.stringify(r.name)} }` +
      browserSource.slice(r.instances.value.end);
  }
  const browser = units(parse("browser.js", browserSource), browserSource);
  const serverBindings = new Set([...server.selected].flatMap((u) => u.names));
  const browserRoots = browser.statements.filter(
    (u) => u.exported || !u.names.length || !u.names.some((name) => serverBindings.has(name)),
  );
  const browserNeeded = closure(
    browserRoots.flatMap((u) => [...freeNames(u.node), ...u.names]),
    browser.statements,
  );
  return {
    names: resolvers.map((r) => r.name),
    server: serverSource,
    browser: [
      renderImports(
        browser.imports,
        (name) => !server.names.has(name) || browserNeeded.names.has(name),
        browserSource,
        true,
      ),
      ...browser.statements
        .filter((u) => browserRoots.includes(u) || browserNeeded.selected.has(u))
        .map((u) => u.code),
    ].join("\n"),
  };
}

export function instanceExtractionPlugin(
  root: string,
  serverConfigured: boolean,
  modules: Map<string, InstanceModule>,
): Plugin {
  return {
    name: "tailorkit-instance-extraction",
    enforce: "pre",
    async transform(source, filename) {
      if (
        filename.includes("node_modules") ||
        !/\.[cm]?[jt]sx?$/u.test(filename) ||
        (!source.includes("instances") && !modules.has(filename))
      )
        return;
      const result = await extractInstances(filename, source, root);
      if (!result) {
        modules.delete(filename);
        return;
      }
      if (!serverConfigured)
        throw new Error("View instances require server configuration in tailorkit.config.ts.");
      modules.set(filename, { filename, names: result.names });
      return { code: result.browser, map: null };
    },
  };
}
export function instanceServerPlugin(root: string, modules: InstanceModule[]): Plugin {
  return {
    name: "tailorkit-instance-server-modules",
    enforce: "pre",
    resolveId(id) {
      if (id.endsWith(suffix)) return id;
    },
    async load(id) {
      if (!id.endsWith(suffix)) return;
      const filename = id.slice(0, -suffix.length);
      this.addWatchFile(filename);
      const names = modules.find((module) => module.filename === filename)?.names;
      const result = await extractInstances(
        filename,
        await readFile(filename, "utf8"),
        root,
        names,
      );
      if (!result)
        throw new Error(`Instance resolver missing from ${filename}; rebuild the app client.`);
      return result.server;
    },
  };
}
export function instanceServerImports(modules: InstanceModule[]) {
  return modules
    .map(
      (m, i) =>
        `import { resolvers as instances${i} } from ${JSON.stringify(m.filename + suffix)};`,
    )
    .join("\n");
}

export function instanceServerBindings(
  modules: InstanceModule[],
  registrations: InstanceRegistration[],
) {
  return `[${registrations
    .map(({ slot, path: viewPath, resolver }) => {
      const index = modules.findIndex((module) => module.names.includes(resolver));
      if (index < 0) throw new Error("Instance resolver was not extracted by the app build.");
      return `{ slot: ${JSON.stringify(slot)}, path: ${JSON.stringify(viewPath)}, ...instances${index}[${JSON.stringify(resolver)}] }`;
    })
    .join(", ")}]`;
}
