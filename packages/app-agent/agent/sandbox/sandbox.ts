import { defineSandbox, DefaultSandbox } from "eve/sandbox";
import { packagePolicy } from "../lib/package-policy";

export const environment = DefaultSandbox.environment({
  prepare: async (sandbox) => {
    await sandbox.writeTextFile({
      path: "/tmp/tailorkit-cli/pnpm-workspace.yaml",
      content: packagePolicy,
    });
    await sandbox.writeTextFile({
      path: "/tmp/tailorkit-cli/package.json",
      content: JSON.stringify({ name: "tailorkit-sandbox-tools", private: true }),
    });
    const result = await sandbox.run({
      command:
        "pnpm --dir /tmp/tailorkit-cli add --workspace-root --save-exact @tailorkit/cli@latest tailorkit@beta",
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to prepare the TailorKit CLI: ${result.stderr || result.stdout}`);
    }
  },
});

export default defineSandbox(() => environment.open());
