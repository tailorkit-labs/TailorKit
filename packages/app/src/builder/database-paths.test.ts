import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { appDatabasePaths } from "./database-paths";

it("uses src/db regardless of files at old locations and honors custom migrations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-db-paths-"));
  try {
    expect(appDatabasePaths(root)).toEqual({
      schema: path.join(root, "src/db/schema.ts"),
      migrations: path.join(root, "src/db/migrations"),
    });
    await mkdir(path.join(root, "src/db"), { recursive: true });
    await writeFile(path.join(root, "src/schema.ts"), "export {};\n");
    expect(appDatabasePaths(root)).toEqual({
      schema: path.join(root, "src/db/schema.ts"),
      migrations: path.join(root, "src/db/migrations"),
    });
    await writeFile(path.join(root, "src/db/schema.ts"), "export {};\n");
    expect(appDatabasePaths(root, "custom/history")).toEqual({
      schema: path.join(root, "src/db/schema.ts"),
      migrations: path.join(root, "custom/history"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
