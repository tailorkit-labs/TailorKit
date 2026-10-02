import { Liquid } from "liquidjs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TEMPLATE_DRIZZLE_VERSION } from "./package-versions";

import {
  clientTemplate,
  defaultViewTemplate,
  genTemplate,
  gitignoreTemplate,
  oxfmtConfigTemplate,
  oxlintConfigTemplate,
  packageJsonTemplate,
  tailorkitConfigTemplate,
  tsconfigTemplate,
  serverTemplate,
  schemaTemplate,
  greetingTemplate,
  logoDarkTemplate,
  logoLightTemplate,
} from "./templates/index";

export interface GenerateAppOptions {
  targetDirectory: string;
  force: boolean;
  formatting: boolean;
  hostUrl: string;
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
    linting,
    packageName,
    packageVersions,
    useWorkspaceDependencies,
  } = options;

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

  await ensureDirectory(path.join(targetDirectory, "src", "views"));
  await ensureDirectory(path.join(targetDirectory, "src", "functions"));

  const files: { template: string; dest: string; condition?: boolean }[] = [
    { template: packageJsonTemplate, dest: "package.json" },
    { template: tsconfigTemplate, dest: "tsconfig.json" },
    { template: tailorkitConfigTemplate, dest: "tailorkit.config.ts" },
    { template: logoDarkTemplate, dest: "logo-dark.svg" },
    { template: logoLightTemplate, dest: "logo-light.svg" },
    { template: gitignoreTemplate, dest: ".gitignore" },
    { template: oxlintConfigTemplate, dest: "oxlint.config.ts", condition: linting },
    { template: oxfmtConfigTemplate, dest: "oxfmt.config.ts", condition: formatting },
    { template: clientTemplate, dest: path.join("src", "client.ts") },
    { template: defaultViewTemplate, dest: path.join("src", "views", "default.tsx") },
    { template: genTemplate, dest: path.join("src", "tailorkit.gen.ts") },
    { template: serverTemplate, dest: path.join("src", "server.ts") },
    { template: schemaTemplate, dest: path.join("src", "schema.ts") },
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
};
