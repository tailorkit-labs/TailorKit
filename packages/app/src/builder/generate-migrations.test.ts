import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { generateAppMigrations } from "./generate-migrations";
import { readAppMigrations } from "./migrations";

it.each([undefined, "history"])(
  "generates Drizzle migrations for the new layout with directory %s",
  async (directory) => {
    const root = await mkdtemp(path.join(tmpdir(), "tailorkit-db-generate-"));
    const example = path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo");
    try {
      await mkdir(path.join(root, "src/db"), { recursive: true });
      await writeFile(path.join(root, "package.json"), '{"type":"module"}');
      await symlink(path.join(example, "node_modules"), path.join(root, "node_modules"), "dir");
      await writeFile(
        path.join(root, "src/db/schema.ts"),
        await readFile(path.join(example, "src/db/schema.ts"), "utf-8"),
      );
      await writeFile(
        path.join(root, "tailorkit.config.mjs"),
        `export default { host: "https://host.example.com", server: ${JSON.stringify(directory ? { migrations: directory } : {})} };`,
      );
      const migrations = await generateAppMigrations({ cwd: root, name: "init" });
      expect(migrations).toBe(path.join(root, directory ?? "src/db/migrations"));
      const generated = await readAppMigrations(migrations);
      expect(generated.migrations).toHaveLength(1);
      const history = await readdir(migrations);
      await generateAppMigrations({ cwd: root });
      expect(await readdir(migrations)).toEqual(history);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
