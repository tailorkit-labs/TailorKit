import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const readAppName = async (root: string): Promise<string> => {
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf-8")) as {
      name?: unknown;
    };

    if (typeof packageJson.name === "string" && packageJson.name.trim()) {
      return packageJson.name.trim();
    }
  } catch {
    // Fall back to the directory name when package metadata is unavailable.
  }

  return path.basename(root);
};

export const writeAppIdToConfig = async (configPath: string, appId: string): Promise<void> => {
  const source = await readFile(configPath, "utf-8");
  const { parseSync } = await import("vite");
  const { program } = parseSync(configPath, source);
  const defaultExport = program.body.find((node) => node.type === "ExportDefaultDeclaration");
  let initializer = defaultExport?.declaration;
  if (initializer?.type === "Identifier") {
    const exportedVariable = initializer.name;
    initializer =
      program.body
        .filter((node) => node.type === "VariableDeclaration")
        .flatMap((node) => node.declarations)
        .find((node) => node.id.type === "Identifier" && node.id.name === exportedVariable)?.init ??
      undefined;
  }
  while (initializer?.type === "TSSatisfiesExpression" || initializer?.type === "TSAsExpression") {
    initializer = initializer.expression;
  }
  if (
    initializer?.type === "CallExpression" &&
    initializer.callee.type === "Identifier" &&
    ["defineTailorKitConfig", "defineConfig"].includes(initializer.callee.name)
  ) {
    const argument = initializer.arguments[0];
    initializer = argument?.type === "SpreadElement" ? undefined : argument;
  }
  if (initializer?.type !== "ObjectExpression") {
    throw new Error(
      `Could not write appId to ${configPath}. Add appId: ${JSON.stringify(appId)} manually.`,
    );
  }

  const property = initializer.properties.find(
    (node) =>
      node.type === "Property" &&
      !node.computed &&
      ((node.key.type === "Identifier" && node.key.name === "appId") ||
        (node.key.type === "Literal" && node.key.value === "appId")),
  );
  if (property?.type === "Property") {
    await writeFile(
      configPath,
      source.slice(0, property.start) +
        `appId: ${JSON.stringify(appId)}` +
        source.slice(property.end),
      "utf-8",
    );
    return;
  }

  const position = initializer.start + 1;
  const rest = source.slice(position);
  const newline = /^(\r?\n)([ \t]*)/u.exec(rest);
  const appIdLine = newline
    ? `${newline[1]}${newline[2] || "  "}appId: ${JSON.stringify(appId)},`
    : ` appId: ${JSON.stringify(appId)},`;
  await writeFile(configPath, source.slice(0, position) + appIdLine + rest, "utf-8");
};
