import type { ESTree } from "vite";

const clientImports = new Set([
  "tailorkit/client",
  "tailorkit/app",
  "tailorkit/app/client",
  "@tailorkit/app/client",
  "@tailorkit/app",
]);

/** Recognize the same SDK calls in route inference and instance extraction. */
export function createDefineViewMatcher(program: ESTree.Program) {
  const aliases = new Set<string>();
  const namespaces = new Set<string>();
  for (const node of program.body) {
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
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(specifier.local.name);
      }
    }
  }
  return (node: ESTree.Node): node is ESTree.CallExpression => {
    if (node.type !== "CallExpression") {
      return false;
    }
    const { callee } = node;
    if (callee.type === "Identifier") {
      return aliases.has(callee.name);
    }
    if (
      callee.type !== "MemberExpression" ||
      callee.object.type !== "Identifier" ||
      !namespaces.has(callee.object.name)
    ) {
      return false;
    }
    return callee.computed
      ? callee.property.type === "Literal" && callee.property.value === "defineView"
      : callee.property.type === "Identifier" && callee.property.name === "defineView";
  };
}
