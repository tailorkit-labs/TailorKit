import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { readAppMigrations } from "./migrations";

const example = path.resolve(
  import.meta.dirname,
  "../../../../examples/apps/backend-todo/migrations",
);

it("packages generated SQL with stable checksums and tracks the source files", async () => {
  const { migrations, files } = await readAppMigrations(example);
  expect(migrations).toHaveLength(1);
  const sql = await readFile(files[1]!, "utf8");
  expect(migrations[0]).toEqual({
    id: path.basename(path.dirname(files[1]!)),
    hash: createHash("sha256").update(sql).digest("hex"),
    statements: [sql.trim()],
  });
});

it("allows an absent default directory but fails for missing configured migrations or malformed files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-migration-reader-"));
  try {
    const missing = path.join(root, "missing");
    expect((await readAppMigrations(missing, true)).migrations).toEqual([]);
    await expect(readAppMigrations(missing)).rejects.toThrow("Run tailorkit db generate");
    const directory = path.join(root, "20261001000000_init");
    await mkdir(directory);
    await expect(readAppMigrations(root)).rejects.toThrow();
    await writeFile(path.join(directory, "migration.sql"), "");
    await expect(readAppMigrations(root)).rejects.toThrow("App migration is empty");
    await rm(directory, { recursive: true });
    await mkdir(path.join(root, "meta"));
    await expect(readAppMigrations(root)).rejects.toThrow("Use Drizzle Kit v1 migrations");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
