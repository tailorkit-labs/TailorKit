import { defineTool } from "eve/tools";
import { z } from "zod";
import { packagePolicy } from "../lib/package-policy";

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export default defineTool({
  description:
    "Scaffold the chat's TailorKit app at /workspace/app using the user's host API URL. Reuses an existing app without overwriting it. Install dependencies and generate the host bindings afterward.",
  inputSchema: z.object({
    host: z
      .url({ protocol: /^https?$/u })
      .describe("TailorKit host API URL, including /api/tailorkit"),
  }),
  async execute({ host }, ctx) {
    const sandbox = await ctx.getSandbox();
    const existing = await sandbox.run({ command: "test -e /workspace/app" });
    if (existing.exitCode === 0) {
      const project = await sandbox.run({ command: "test -f /workspace/app/package.json" });
      if (project.exitCode !== 0) {
        throw new Error(
          "/workspace/app already exists without a package.json. Preserve its files.",
        );
      }
      return {
        path: "/workspace/app",
        created: false,
        message:
          "Continue the existing app. Read tailorkit.config.ts and preserve its host and identity.",
      };
    }
    if (existing.exitCode !== 1) {
      throw new Error(`Could not inspect the app directory: ${existing.stderr || existing.stdout}`);
    }

    const result = await sandbox.run({
      command: [
        "/tmp/tailorkit-cli/node_modules/.bin/tailorkit init /workspace",
        "--name app",
        `--host ${shellQuote(host)}`,
        "--package-manager pnpm --lint --format --no-install",
      ].join(" "),
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to scaffold the TailorKit app: ${result.stderr || result.stdout}`);
    }
    const manifestPath = "/workspace/app/package.json";
    const manifestContent = await sandbox.readTextFile({ path: manifestPath });
    if (manifestContent === null) {
      throw new Error("The scaffold did not create /workspace/app/package.json.");
    }
    const manifest = JSON.parse(manifestContent) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const sdkManifest = await sandbox.readTextFile({
      path: "/tmp/tailorkit-cli/node_modules/tailorkit/package.json",
    });
    if (sdkManifest === null) {
      throw new Error(
        "The prepared sandbox is missing the TailorKit SDK. Rebuild the environment.",
      );
    }
    // Use the exact beta SDK installed when this sandbox image was prepared.
    const sdk = z.object({ version: z.string().min(1) }).parse(JSON.parse(sdkManifest));
    manifest.dependencies.tailorkit = sdk.version;
    manifest.devDependencies.oxfmt = "0.70.0";
    manifest.devDependencies.oxlint = "1.85.0";
    await sandbox.writeTextFile({
      path: manifestPath,
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    });
    await sandbox.writeTextFile({
      path: "/workspace/app/pnpm-workspace.yaml",
      content: packagePolicy,
    });
    return { path: "/workspace/app", created: true, output: result.stdout };
  },
});
