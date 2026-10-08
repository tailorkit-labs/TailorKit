import { Liquid } from "liquidjs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateTypes, type TailorKitSchemaFile } from "./types";
import { TEMPLATE_DRIZZLE_VERSION } from "./package-versions";

import {
  rootTemplate,
  defaultViewTemplate,
  gitignoreTemplate,
  oxfmtConfigTemplate,
  oxlintConfigTemplate,
  packageJsonTemplate,
  tailorkitConfigTemplate,
  tsconfigTemplate,
  serverTemplate,
  schemaTemplate,
  databaseTemplate,
  relationsTemplate,
  greetingTemplate,
  logoDarkTemplate,
  logoLightTemplate,
} from "./templates/index";

export interface GenerateAppOptions {
  targetDirectory: string;
  force: boolean;
  formatting: boolean;
  hostUrl: string;
  schema: TailorKitSchemaFile;
  linting: boolean;
  packageName: string;
  packageVersions: {
    drizzleKit?: string;
    drizzleOrm?: string;
    oxfmt: string;
    oxlint: string;
    preact: string;
    tailorkit: string;
    typescript: string;
    zod?: string;
  };
  useWorkspaceDependencies?: boolean;
}

const engine = new Liquid({ strictVariables: true });

// eslint-disable-next-line no-control-regex -- Host-provided file names cannot contain control characters.
const invalidFilenameCharacters = /[<>:"/\\|?*#\u0000-\u001F]/u;
const isFilenameSegment = (segment: string) =>
  segment !== "" && segment !== "." && segment !== ".." && !invalidFilenameCharacters.test(segment);

function getViewModulePath(slotName: string, viewPath: string) {
  const viewSegments = viewPath === "/" ? ["home"] : viewPath.slice(1).split("/");
  const routeName = viewSegments.join(".");
  if (
    !viewPath.startsWith("/") ||
    ![slotName, ...viewSegments, ...routeName.split(".")].every(isFilenameSegment)
  ) {
    throw new Error(
      "The selected slot and view must have valid file names with no empty dot-separated route segments to generate src/slots.",
    );
  }
  return ["slots", slotName, routeName].join("/");
}

const renderTemplate = (template: string, data: Record<string, unknown>): Promise<string> =>
  engine.parseAndRender(template, data);

const ensureDirectory = (directory: string): Promise<void> =>
  mkdir(directory, { recursive: true }).then(() => {});

const writeTemplateFile = async (
  filepath: string,
  contents: string,
  force: boolean,
): Promise<void> => {
  if (!force && existsSync(filepath)) {
    throw new Error(`${filepath} already exists. Use --force to overwrite it.`);
  }
  await writeFile(filepath, contents, "utf-8");
};

export const generateApp = async (options: GenerateAppOptions): Promise<void> => {
  const {
    targetDirectory,
    force,
    formatting,
    hostUrl,
    schema,
    linting,
    packageName,
    packageVersions,
    useWorkspaceDependencies,
  } = options;

  const slots = Object.keys(schema.slots ?? {}).sort();
  const viewPath = Object.keys(schema.views ?? {})
    .sort()
    .find((view) => slots.some((slot) => schema.slots?.[slot]?.views.includes(view)));
  if (viewPath === undefined) {
    throw new Error(
      "The host schema has no views supported by a slot. Add a view and slot before running tailorkit init.",
    );
  }
  const slotName = slots.find((slot) => schema.slots?.[slot]?.views.includes(viewPath))!;
  const viewModulePath = getViewModulePath(slotName, viewPath);
  const viewFile = path.join("src", `${viewModulePath}.view.tsx`);
  const box = schema.components?.Box;
  // Only use a wrapper that accepts children without requiring host-specific props.
  const useBox = box?.children === true && !box.fields?.required?.length;
  const bindingsPath = path.join(targetDirectory, "src", "tailorkit.gen.ts");
  if (!force && existsSync(bindingsPath)) {
    throw new Error(`${bindingsPath} already exists. Use --force to overwrite it.`);
  }

  const tailorkitVersion = useWorkspaceDependencies ? "workspace:*" : packageVersions.tailorkit;

  const checkParts: string[] = [];
  const fixParts: string[] = [];
  if (linting) {
    checkParts.push("pnpm run lint");
    fixParts.push("pnpm run lint:fix");
  }
  if (formatting) {
    checkParts.push("pnpm run format");
    fixParts.push("pnpm run format:fix");
  }

  const templateData = {
    viewPath: JSON.stringify(viewPath),
    slotName: JSON.stringify(slotName),
    multiple: schema.slots?.[slotName]?.multiple === true,
    useBox,
    checkScript: checkParts.join(" && "),
    fixScript: fixParts.join(" && "),
    formatting,
    hostUrl,
    linting,
    oxfmtVersion: packageVersions.oxfmt,
    oxlintVersion: packageVersions.oxlint,
    packageName,
    preactVersion: packageVersions.preact,
    tailorkitVersion,
    typescriptVersion: packageVersions.typescript,
    zodVersion: packageVersions.zod ?? "^4.0.0",
    drizzleKitVersion: packageVersions.drizzleKit ?? TEMPLATE_DRIZZLE_VERSION,
    drizzleOrmVersion: packageVersions.drizzleOrm ?? TEMPLATE_DRIZZLE_VERSION,
  };

  await ensureDirectory(path.dirname(path.join(targetDirectory, viewFile)));
  await ensureDirectory(path.join(targetDirectory, "src", "functions"));
  await ensureDirectory(path.join(targetDirectory, "src", "db", "migrations"));

  const files: { template: string; dest: string; condition?: boolean }[] = [
    { template: packageJsonTemplate, dest: "package.json" },
    { template: tsconfigTemplate, dest: "tsconfig.json" },
    { template: tailorkitConfigTemplate, dest: "tailorkit.config.ts" },
    { template: logoDarkTemplate, dest: "logo-dark.svg" },
    { template: logoLightTemplate, dest: "logo-light.svg" },
    { template: gitignoreTemplate, dest: ".gitignore" },
    { template: oxlintConfigTemplate, dest: "oxlint.config.ts", condition: linting },
    { template: oxfmtConfigTemplate, dest: "oxfmt.config.ts", condition: formatting },
    { template: rootTemplate, dest: path.join("src", "root.tsx") },
    { template: defaultViewTemplate, dest: viewFile },
    { template: serverTemplate, dest: path.join("src", "server.ts") },
    { template: schemaTemplate, dest: path.join("src", "db", "schema.ts") },
    { template: databaseTemplate, dest: path.join("src", "db", "index.ts") },
    { template: relationsTemplate, dest: path.join("src", "db", "relations.ts") },
    { template: greetingTemplate, dest: path.join("src", "functions", "greeting.ts") },
  ];

  await Promise.all(
    files
      .filter((f) => f.condition !== false)
      .map(async ({ template, dest }) => {
        const rendered = await renderTemplate(template, templateData);
        await writeTemplateFile(path.join(targetDirectory, dest), rendered, force);
      }),
  );

  // Use the same binding generator as `tailorkit generate`, even without installation.
  await generateTypes({ cwd: targetDirectory, schema });
};
