import type { Persistence } from "./driver";
import { AppError } from "../errors";

import type { AppMigration } from "@tailorkit/app/protocol";
export type { AppMigration } from "@tailorkit/app/protocol";

/** Runs synchronously during facet initialization, before database handlers are available. */
export function migrateDatabase(persistence: Persistence, migrations: readonly AppMigration[]) {
  for (let index = 0; index < migrations.length; index++) {
    const migration = migrations[index]!;
    if (
      !/^\d{14}_[\w-]+$/u.test(migration.id) ||
      !/^[a-f0-9]{64}$/u.test(migration.hash) ||
      !migration.statements.length ||
      (index > 0 && migrations[index - 1]!.id >= migration.id)
    ) {
      throw new AppError("INCOMPATIBLE_VERSION", "Invalid app migration history");
    }
  }

  // Keep the entire upgrade and journal atomic: a failed deployment leaves the previous schema.
  persistence.transaction(() => {
    persistence.execute(
      "CREATE TABLE IF NOT EXISTS tailorkit_migrations (position INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, hash TEXT NOT NULL)",
      [],
    );
    const applied = persistence.execute(
      "SELECT position, id, hash FROM tailorkit_migrations ORDER BY position",
      [],
    ).rows;
    for (const [index, row] of applied.entries()) {
      const migration = migrations[index];
      if (!migration || row[0] !== index || row[1] !== migration.id || row[2] !== migration.hash) {
        throw new AppError(
          "INCOMPATIBLE_VERSION",
          "Applied app migrations must not be changed, removed or reordered",
        );
      }
    }
    for (let index = applied.length; index < migrations.length; index++) {
      const migration = migrations[index]!;
      for (const statement of migration.statements) persistence.execute(statement, []);
      persistence.execute(
        "INSERT INTO tailorkit_migrations (position, id, hash) VALUES (?, ?, ?)",
        [index, migration.id, migration.hash],
      );
    }
  });
}
