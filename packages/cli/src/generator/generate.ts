import { Liquid } from "liquidjs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
} from "./templates/index";

export interface GenerateAppOptions {
  targetDirectory: string;
  force: boolean;
  formatting: boolean;
  hostUrl: string;
  linting: boolean;
  packageManager: string;
  packageName: string;
  packageVersions: {
    oxfmt: string;
    oxlint: string;
    preact: string;
    tailorkit: string;
    typescript: string;
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
    packageManager,
    useWorkspaceDependencies,
  } = options;

  const tailorkitVersion = useWorkspaceDependencies ? "workspace:*" : packageVersions.tailorkit;

  const checkParts: string[] = [];
  const fixParts: string[] = [];
  if (linting) {
    checkParts.push(`${packageManager} run lint`);
    fixParts.push(`${packageManager} run lint:fix`);
  }
  if (formatting) {
    checkParts.push(`${packageManager} run format`);
    fixParts.push(`${packageManager} run format:fix`);
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
  };

  await ensureDirectory(path.join(targetDirectory, "src", "views"));

  const files: { template: string; dest: string; condition?: boolean }[] = [
    { template: packageJsonTemplate, dest: "package.json" },
    { template: tsconfigTemplate, dest: "tsconfig.json" },
    { template: tailorkitConfigTemplate, dest: "tailorkit.config.ts" },
    { template: gitignoreTemplate, dest: ".gitignore" },
    { template: oxlintConfigTemplate, dest: "oxlint.config.ts", condition: linting },
    { template: oxfmtConfigTemplate, dest: "oxfmt.config.ts", condition: formatting },
    { template: clientTemplate, dest: path.join("src", "client.ts") },
    { template: defaultViewTemplate, dest: path.join("src", "views", "default.tsx") },
    { template: genTemplate, dest: path.join("src", "tailorkit.gen.ts") },
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
