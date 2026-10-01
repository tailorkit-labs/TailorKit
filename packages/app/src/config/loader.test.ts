import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { loadTailorKitConfig } from "./loader";

it("rejects legacy storage config instead of silently building a client-only app", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-legacy-config-"));
  try {
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { storage: { entry: "./server.ts" } };',
    );
    await expect(loadTailorKitConfig(undefined, root)).rejects.toThrow(
      "Use server configuration and @tailorkit/apps-server",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
