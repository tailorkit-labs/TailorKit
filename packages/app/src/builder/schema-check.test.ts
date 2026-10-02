import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { checkAppSchema } from "./schema-check";

it("checks schema drift without rewriting committed migrations and allows apps without tables", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-schema-test-"));
  const example = path.resolve(import.meta.dirname, "../../../../examples/apps/backend-todo");
  const migrations = path.join(root, "migrations");
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await symlink(path.join(example, "node_modules"), path.join(root, "node_modules"), "dir");
    const schema = await readFile(path.join(example, "src/schema.ts"), "utf8");
    await writeFile(path.join(root, "src/schema.ts"), schema);
    await cp(path.join(example, "migrations"), migrations, { recursive: true });
    const files = (await readdir(migrations, { recursive: true })).filter(
      (name) => name.endsWith(".sql") || name.endsWith(".json"),
    );
    const contents = await Promise.all(
      files.map((file) => readFile(path.join(migrations, file), "utf8")),
    );
    await expect(checkAppSchema(root, migrations)).resolves.toBeUndefined();

    await writeFile(
      path.join(root, "src/schema.ts"),
      schema.replace("  id:", '  priority: text().notNull().default("normal"),\n  id:'),
    );
    await expect(checkAppSchema(root, migrations)).rejects.toThrow(
      "out of sync with src/schema.ts",
    );
    expect(
      await Promise.all(files.map((file) => readFile(path.join(migrations, file), "utf8"))),
    ).toEqual(contents);
    expect(
      (await readdir(migrations, { recursive: true })).filter(
        (name) => name.endsWith(".sql") || name.endsWith(".json"),
      ),
    ).toEqual(files);

    await writeFile(path.join(root, "src/schema.ts"), schema);
    await expect(checkAppSchema(root, path.join(root, "missing"))).rejects.toThrow(
      "Run tailorkit db generate",
    );
    await writeFile(path.join(root, "src/schema.ts"), "export {};\n");
    await expect(checkAppSchema(root, path.join(root, "missing"))).resolves.toBeUndefined();
    await expect(checkAppSchema(root, migrations)).rejects.toThrow("out of sync");
    await writeFile(path.join(root, "src/schema.ts"), 'throw new Error("Broken schema");\n');
    await expect(checkAppSchema(root, path.join(root, "missing"))).rejects.toThrow(/Drizzle Kit/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
