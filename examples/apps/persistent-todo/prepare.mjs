import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The loopback demo creates its own ignored development keys on a clean checkout.
// Production runtime provisioning never uses this example's keys.
if (!existsSync(new URL(".tailorkit-storage/dev-host-key.json", import.meta.url))) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.resolve("@tailorkit/cli")), "storage", "init-dev"],
    { cwd: import.meta.dirname, stdio: "inherit" },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("Unable to initialize local demo storage keys");
  }
}
if (!existsSync(new URL("storage/public-keys.json", import.meta.url))) {
  throw new Error("Restore the demo public keys that match the existing local signing key");
}
