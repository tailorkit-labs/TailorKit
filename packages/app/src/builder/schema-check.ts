import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { drizzleGenerateArguments } from "./drizzle";
import { appDatabasePaths } from "./database-paths";

const run = promisify(execFile);

interface Snapshot {
  version: string;
  dialect: string;
  ddl: unknown[];
}

async function snapshot(directory: string): Promise<Snapshot | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const latest = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latest) return;
  const filename = path.join(directory, latest, "snapshot.json");
  const value = JSON.parse(await readFile(filename, "utf8")) as Partial<Snapshot>;
  if (value.version !== "7" || value.dialect !== "sqlite" || !Array.isArray(value.ddl)) {
    throw new Error(
      `Unsupported app schema snapshot: ${filename}. Use Drizzle Kit v1 SQLite migrations.`,
    );
  }
  return value as Snapshot;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Generate a fresh snapshot with Drizzle in disposable storage, leaving committed history unchanged. */
export async function checkAppSchema(root: string, migrationsDirectory: string) {
  const schema = appDatabasePaths(root).schema;
  try {
    await access(schema);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "tailorkit-schema-check-"));
  try {
    const { stdout } = await run(
      process.execPath,
      await drizzleGenerateArguments(root, temporary),
      {
        cwd: root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, CI: "true" },
      },
    ).catch((error: unknown) => {
      throw new Error(
        `Could not check the app database schema with Drizzle Kit. Check ${path.relative(root, schema)} and your drizzle-kit/drizzle-orm dependencies.`,
        { cause: error },
      );
    });
    const current = await snapshot(temporary);
    if (!current && !stdout.includes("No schema changes")) {
      throw new Error(
        `Drizzle Kit did not produce a schema snapshot. Check ${path.relative(root, schema)} and run tailorkit db generate.`,
      );
    }
    const saved = await snapshot(migrationsDirectory);
    const expected = (current?.ddl ?? []).map(canonical).sort();
    const actual = (saved?.ddl ?? []).map(canonical).sort();
    if (canonical(expected) !== canonical(actual)) {
      throw new Error(
        `App database migrations are missing or out of sync with ${path.relative(root, schema)}. Run tailorkit db generate, commit the generated files in ${path.relative(root, migrationsDirectory)}, then build again.`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
