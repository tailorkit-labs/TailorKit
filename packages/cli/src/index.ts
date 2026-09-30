#!/usr/bin/env node
import { confirm, intro, isCancel, log, outro, spinner } from "@clack/prompts";
import { cac } from "cac";
import pc from "picocolors";

import { createCliAuthApprovalUrl, runLogin, runLogout, runWhoami } from "./auth";
import { runDeploy } from "./deploy";
import { generateTypes } from "./generator/types";
import { runInit } from "./init";
import { toPreviewOptions, runPreview } from "./preview";
import {
  generateStorage,
  initStorageDev,
  migrateStorage,
  resetStorage,
  runStorageDev,
  seedStorage,
} from "./storage";
import { openUrlInBrowser } from "./utils/open-browser";

declare const __TAILORKIT_VERSION__: string;

const cli = cac("tailorkit");

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
};

cli.option("--cwd <path>", "Working directory", { default: "." });

cli
  .command("preview", "Preview the app inside a host app")
  .option("--config <path>", "Path to tailorkit config")
  .option("--entry <path>", "Client entry file")
  .option("--out-dir <path>", "Build output directory")
  .option("--mode <mode>", "Vite mode")
  .option("--replace", "End the active preview for this app and start a new one")
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    try {
      await runPreview(toPreviewOptions(options));
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("login", "Authenticate the TailorKit CLI with a host app")
  .option("--config <path>", "Path to tailorkit config")
  .option("--open", "Open the approval URL in the default browser", { default: true })
  .option("--timeout <seconds>", "Seconds to wait for approval", { default: 1800 })
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    const approvalSpinner = spinner();
    let isWaitingForApproval = false;
    try {
      const timeoutSeconds = Number.parseInt(String(options.timeout ?? "1800"), 10);
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new Error("--timeout must be a positive integer.");
      }

      await runLogin(
        {
          configPath: options.config as string | undefined,
          cwd: String(options.cwd ?? "."),
          timeout: timeoutSeconds * 1000,
        },
        ({ expiresAt, hostUrl, userCode }) => {
          const approvalUrl = createCliAuthApprovalUrl(hostUrl, userCode);
          if (options.open !== false) {
            void openUrlInBrowser(approvalUrl);
          }

          log.info(`Enter this code in the host app: ${pc.bold(userCode)}`);
          log.info(`Approval URL: ${pc.cyan(approvalUrl)}`);
          log.info(`Code expires at ${expiresAt.toLocaleString()}.`);
          log.info("Waiting for approval...");
          approvalSpinner.start("Checking approval status");
          isWaitingForApproval = true;
        },
      );

      if (isWaitingForApproval) {
        approvalSpinner.stop("Approved.");
      }
      outro("Authenticated successfully.");
    } catch (error) {
      if (isWaitingForApproval) {
        approvalSpinner.stop("Approval failed.");
      }
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("logout", "Remove stored TailorKit CLI credentials for a host app")
  .option("--config <path>", "Path to tailorkit config")
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    try {
      const result = await runLogout({
        configPath: options.config as string | undefined,
        cwd: String(options.cwd ?? "."),
      });

      outro(
        result.removed
          ? `Logged out of ${pc.cyan(result.hostUrl)}.`
          : `No stored credentials found for ${pc.cyan(result.hostUrl)}.`,
      );
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("whoami", "Show the current TailorKit CLI authentication scope")
  .option("--config <path>", "Path to tailorkit config")
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    try {
      const result = await runWhoami({
        configPath: options.config as string | undefined,
        cwd: String(options.cwd ?? "."),
      });

      log.info(`Host: ${pc.cyan(result.hostUrl)}`);
      log.info(`Scope: ${pc.cyan(JSON.stringify(result.scope))}`);
      outro("Authenticated.");
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("deploy", "Build and deploy the TailorKit app")
  .option("--config <path>", "Path to tailorkit config")
  .option("--entry <path>", "Client entry file")
  .option("--out-dir <path>", "Build output directory")
  .option("--mode <mode>", "Vite mode")
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    const deploySpinner = spinner();
    try {
      deploySpinner.start("Building and deploying app");
      const result = await runDeploy({
        configPath: options.config as string | undefined,
        cwd: String(options.cwd ?? "."),
        entry: options.entry as string | undefined,
        mode: options.mode as string | undefined,
        onMissingAppId: async ({ appName, configPath, hostUrl, reason }) => {
          deploySpinner.stop("App not linked.");
          log.info(
            reason === "missing"
              ? `No appId found in ${pc.cyan(configPath)}.`
              : `The appId in ${pc.cyan(configPath)} does not exist.`,
          );
          log.info(`Host: ${pc.cyan(hostUrl)}`);
          const shouldCreate = await confirm({
            initialValue: true,
            message:
              reason === "missing"
                ? `Create a TailorKit app named ${appName}?`
                : `Create a new TailorKit app named ${appName} and update the config?`,
          });

          if (isCancel(shouldCreate)) {
            return false;
          }

          if (shouldCreate) {
            deploySpinner.start("Creating app and deploying");
          }

          return shouldCreate === true;
        },
        onTypecheckFailed: async ({ command, output }) => {
          deploySpinner.stop("Type check failed.");
          log.error(`Type check failed while running ${pc.cyan(command)}.`);
          if (output) {
            log.error(output);
          }

          const shouldUpload = await confirm({
            initialValue: false,
            message: "Type check failed, but the app built successfully. Upload anyway?",
          });

          if (isCancel(shouldUpload)) {
            return false;
          }

          if (shouldUpload) {
            deploySpinner.start("Uploading app");
          }

          return shouldUpload === true;
        },
        outDir: options.outDir as string | undefined,
      });
      deploySpinner.stop("Deployed app.");
      if (result.createdApp) {
        log.info(`Created app and updated tailorkit.config.ts with ${pc.cyan(result.appId)}.`);
      }
      log.info(`Host: ${pc.cyan(result.hostUrl)}`);
      log.info(`App: ${pc.cyan(result.appId)}`);
      log.info(`Deployment: ${pc.cyan(result.deploymentId)}`);
      log.info("Uploaded files:");
      for (const file of result.uploadedFiles) {
        log.info(
          `  ${pc.cyan(file.path)} ${pc.dim(`${formatBytes(file.size)} raw, ${formatBytes(file.gzipSize)} gzip`)}`,
        );
      }
      if (result.status) {
        log.info(`Status: ${pc.cyan(result.status)}`);
      }
      outro("Deployment published.");
    } catch (error) {
      deploySpinner.stop("Deployment failed.");
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("build", "Build the TailorKit app")
  .option("--config <path>", "Path to tailorkit config")
  .option("--entry <path>", "Client entry file")
  .option("--out-dir <path>", "Build output directory")
  .option("--mode <mode>", "Vite mode")
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    try {
      const { buildApp } = await import("@tailorkit/app/builder");
      await buildApp({
        configPath: options.config as string | undefined,
        cwd: String(options.cwd ?? "."),
        entry: options.entry as string | undefined,
        mode: options.mode as string | undefined,
        outDir: options.outDir as string | undefined,
      });
      outro("Built app.");
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("generate", "Generate TailorKit app bindings")
  .option("--config <path>", "Path to tailorkit config")
  .option("--out <path>", "Generated TypeScript output file")
  .action(async (options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    try {
      const outPath = await generateTypes({
        configPath: options.config as string | undefined,
        cwd: String(options.cwd ?? "."),
        outFile: options.out as string | undefined,
      });
      outro(`Generated ${pc.cyan(outPath)}.`);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("init [directory]", "Create a new TailorKit app")
  .option("--name <name>", "Package name")
  .option("--host <url>", "TailorKit host URL")
  .option("--package-manager <pm>", "Package manager: bun, yarn, pnpm, or npm")
  .option("--lint", "Add oxlint (use --no-lint to skip)")
  .option("--format", "Add oxfmt (use --no-format to skip)")
  .option("--install", "Install dependencies after scaffolding (use --no-install to skip)")
  .option("--force", "Overwrite existing files")
  .action(async (directory: string | undefined, options: Record<string, unknown>) => {
    intro(pc.bold("TailorKit"));
    try {
      const cwd = String(options.cwd ?? ".");
      const targetDirectory = await runInit({
        cwd,
        directory,
        force: options.force as boolean | undefined,
        formatting: options.format as boolean | undefined,
        host: options.host as string | undefined,
        install: options.install as boolean | undefined,
        linting: options.lint as boolean | undefined,
        name: options.name as string | undefined,
        packageManager: options.packageManager as string | undefined,
      });
      outro(`Created app at ${pc.cyan(targetDirectory)}.`);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cli
  .command("storage <action>", "App storage: init-dev, generate, migrate, dev, seed, reset")
  .option("--config <path>", "Path to TailorKit config")
  .option("--name <name>", "Migration name or seed mutation name")
  .option("--installation <id>", "Installation to migrate (required), or seed (default: demo)")
  .option("--key-file <path>", "Local host development signing key")
  .option("--url <url>", "Runtime URL for migrations")
  .option("--token-file <path>", "Operator-issued migration JWT (remote runtimes)")
  .option("--provider <name>", "Local runtime: cloudflare or docker", { default: "cloudflare" })
  .action(async (action: string, options: Record<string, unknown>) => {
    try {
      const commands: Record<string, typeof generateStorage> = {
        generate: generateStorage,
        migrate: migrateStorage,
        "init-dev": initStorageDev,
        dev: runStorageDev,
        seed: seedStorage,
        reset: resetStorage,
      };
      const command = commands[action];
      if (!command) {
        throw new Error("Use storage init-dev, generate, migrate, dev, seed, or reset");
      }
      await command({
        cwd: String(options.cwd ?? "."),
        configPath: options.config as string | undefined,
        name: options.name as string | undefined,
        installation: options.installation as string | undefined,
        keyFile: options.keyFile as string | undefined,
        url: options.url as string | undefined,
        tokenFile: options.tokenFile as string | undefined,
        provider: options.provider as "cloudflare" | "docker",
      });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

cli.help();
cli.version(__TAILORKIT_VERSION__);
cli.parse();
