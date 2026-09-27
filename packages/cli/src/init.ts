import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CANCEL_SYMBOL, cancel, confirm, isCancel, select, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import { generateApp, resolveTemplatePackageVersions } from "./generator";
import { normalizeHostUrl } from "./utils/url";

export interface InitOptions {
  cwd: string;
  directory?: string;
  force?: boolean;
  formatting?: boolean;
  host?: string;
  install?: boolean;
  linting?: boolean;
  name?: string;
  packageManager?: string;
}

const PACKAGE_MANAGERS = ["pnpm", "yarn", "npm", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const isPackageManager = (value: string): value is PackageManager =>
  PACKAGE_MANAGERS.includes(value as PackageManager);

const normalizePackageName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._/-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const abortIfCancelled = <T>(value: T | typeof CANCEL_SYMBOL): T => {
  if (isCancel(value)) {
    cancel("Init cancelled.");
    process.exit(0);
  }
  return value as T;
};

const promptDirectory = (given: string | undefined, cwd: string): string =>
  path.resolve(cwd, given ?? ".");

const promptPackageName = async (given: string | undefined, baseDir: string): Promise<string> => {
  const defaultName = normalizePackageName(path.basename(baseDir)) || "tailorkit-app";
  if (given !== undefined) {
    return normalizePackageName(given);
  }
  const answer = abortIfCancelled(
    await text({
      defaultValue: defaultName,
      message: "Package name",
      placeholder: defaultName,
      validate: (value) =>
        normalizePackageName(value ?? "").length === 0 ? "Enter a package name." : undefined,
    }),
  );
  return normalizePackageName(answer);
};

const promptPackageManager = async (given: string | undefined): Promise<PackageManager> => {
  if (given !== undefined) {
    if (isPackageManager(given)) {
      return given;
    }
    throw new Error(`--package-manager must be one of: ${PACKAGE_MANAGERS.join(", ")}.`);
  }
  const answer = abortIfCancelled(
    await select({
      initialValue: "pnpm" as PackageManager,
      message: "Package manager",
      options: PACKAGE_MANAGERS.map((value) => ({ label: value, value })),
    }),
  );
  return answer as PackageManager;
};

const promptLinting = async (given: boolean | undefined): Promise<boolean> => {
  if (given !== undefined) {
    return given;
  }
  return abortIfCancelled(
    await confirm({ initialValue: true, message: "Add linting with oxlint?" }),
  ) as boolean;
};

const promptFormatting = async (given: boolean | undefined): Promise<boolean> => {
  if (given !== undefined) {
    return given;
  }
  return abortIfCancelled(
    await confirm({ initialValue: true, message: "Add formatting with oxfmt?" }),
  ) as boolean;
};

const validateHostUrl = (value: string | undefined): string | undefined => {
  try {
    normalizeHostUrl(value ?? "");
    return undefined;
  } catch {
    return "Enter a valid host URL.";
  }
};

const promptHostUrl = async (given: string | undefined): Promise<string> => {
  if (given !== undefined) {
    const error = validateHostUrl(given);
    if (error !== undefined) {
      throw new Error(error);
    }
    return normalizeHostUrl(given);
  }

  const defaultValue = "https://example.com/api/tailorkit";
  const answer = abortIfCancelled(
    await text({
      defaultValue,
      message: "Host URL",
      placeholder: defaultValue,
      validate: validateHostUrl,
    }),
  );
  return normalizeHostUrl(answer);
};

const promptInstall = async (given: boolean | undefined): Promise<boolean> => {
  if (given !== undefined) {
    return given;
  }
  return abortIfCancelled(
    await confirm({ initialValue: true, message: "Install dependencies?" }),
  ) as boolean;
};

const promptForce = async (targetDir: string, given: boolean): Promise<boolean> => {
  if (given || !existsSync(targetDir)) {
    return given;
  }
  return abortIfCancelled(
    await confirm({
      initialValue: false,
      message: `${pc.cyan(targetDir)} already exists. Overwrite matching files?`,
    }),
  ) as boolean;
};

const exec = (cmd: string, args: string[], cwd: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit" });
    proc.on("close", resolve);
    proc.on("error", reject);
  });

const runInstall = async (targetDir: string, packageManager: PackageManager): Promise<void> => {
  const s = spinner();
  s.start(`Installing dependencies with ${packageManager}`);
  const code = await exec(packageManager, ["install"], targetDir);
  if (code !== 0) {
    s.stop("Install failed.");
    throw new Error(`${packageManager} install exited with code ${code}.`);
  }
  s.stop("Installed dependencies.");
};

const runFormat = async (targetDir: string, packageManager: PackageManager): Promise<void> => {
  const s = spinner();
  s.start("Formatting project");
  const code = await exec(packageManager, ["run", "format:fix"], targetDir);
  if (code !== 0) {
    s.stop("Formatting failed.");
    throw new Error(`${packageManager} run format:fix exited with code ${code}.`);
  }
  s.stop("Formatted project.");
};

export const runInit = async (options: InitOptions): Promise<string> => {
  const baseDir = promptDirectory(options.directory, options.cwd);
  const packageName = await promptPackageName(options.name, baseDir);
  const targetDirectory = path.join(baseDir, packageName);

  const force = await promptForce(targetDirectory, options.force ?? false);
  const packageManager = await promptPackageManager(options.packageManager);
  const hostUrl = await promptHostUrl(options.host);
  const linting = await promptLinting(options.linting);
  const formatting = await promptFormatting(options.formatting);
  const install = await promptInstall(options.install);

  const s = spinner();
  s.start("Resolving package versions");
  const packageVersions = await resolveTemplatePackageVersions();
  s.stop("Resolved package versions.");

  await mkdir(targetDirectory, { recursive: true });

  await generateApp({
    force,
    formatting,
    hostUrl,
    linting,
    packageName,
    packageVersions,
    targetDirectory,
  });

  if (install) {
    await runInstall(targetDirectory, packageManager);
    if (formatting) {
      await runFormat(targetDirectory, packageManager);
    }
  }

  return targetDirectory;
};
