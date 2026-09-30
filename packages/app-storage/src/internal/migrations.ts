import { StorageError } from "../errors";
import type { Migration, SqlDriver } from "./driver";

export function migrate(driver: SqlDriver, migrations: readonly Migration[], apiVersion?: number) {
  driver.transaction(() => {
    // Only the bootstrap journal is handwritten: it must exist before CLI-generated SQL can run.
    driver.execute(
      "CREATE TABLE IF NOT EXISTS tk_migrations (position INTEGER PRIMARY KEY, id TEXT NOT NULL, hash TEXT NOT NULL)",
    );
    const applied = driver.execute("SELECT id, hash FROM tk_migrations ORDER BY position");
    if (applied.length > migrations.length) {
      throw new StorageError("INCOMPATIBLE_VERSION", "Database is newer than this runtime");
    }
    for (const [position, migration] of migrations.entries()) {
      const old = applied[position];
      if (old) {
        if (old.id !== migration.id || old.hash !== migration.hash) {
          throw new StorageError("INCOMPATIBLE_VERSION", "Applied migration history was modified");
        }
        continue;
      }
      for (const statement of migration.statements) {
        if (statement.trim()) {
          driver.execute(statement);
        }
      }
      driver.execute("INSERT INTO tk_migrations (position, id, hash) VALUES (?, ?, ?)", [
        position,
        migration.id,
        migration.hash,
      ]);
    }
    if (apiVersion !== undefined) {
      const current = Number(
        driver.execute("SELECT value FROM tk_state WHERE key = 'apiVersion'")[0]?.value ?? 0,
      );
      if (current > apiVersion) {
        throw new StorageError("INCOMPATIBLE_VERSION", "Runtime API is older than the database");
      }
      driver.execute(
        "INSERT INTO tk_state (key, value) VALUES ('apiVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [apiVersion],
      );
    }
  });
}
/** Request execution never migrates. The operator CLI must prepare this installation first. */
export function assertMigrated(
  driver: SqlDriver,
  migrations: readonly Migration[],
  apiVersion: number,
) {
  if (
    !driver.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tk_migrations'",
    ).length
  ) {
    throw new StorageError(
      "INCOMPATIBLE_VERSION",
      "Run tailorkit storage migrate for this installation first",
    );
  }
  const applied = driver.execute("SELECT id, hash FROM tk_migrations ORDER BY position");
  if (applied.length > migrations.length) {
    throw new StorageError("INCOMPATIBLE_VERSION", "Database is newer than this runtime");
  }
  if (applied.length !== migrations.length) {
    throw new StorageError(
      "INCOMPATIBLE_VERSION",
      "Pending storage migrations; run tailorkit storage migrate",
    );
  }
  if (
    applied.some(
      (entry, position) =>
        entry.id !== migrations[position]?.id || entry.hash !== migrations[position]?.hash,
    )
  ) {
    throw new StorageError("INCOMPATIBLE_VERSION", "Applied migration history was modified");
  }
  const current = Number(
    driver.execute("SELECT value FROM tk_state WHERE key = 'apiVersion'")[0]?.value ?? 0,
  );
  if (current !== apiVersion) {
    throw new StorageError("INCOMPATIBLE_VERSION", "Storage API version requires migration");
  }
}
