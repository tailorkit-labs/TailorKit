import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vite-plus/test";
import {
  createPublicTeamId,
  initializePublicTeamId,
  publicTeamIdField,
} from "@tailorkit/auth/lib/public-team-id";

const migration = await readFile(
  new URL(
    "../../db/src/migrations/20260904000000_public_team_asset_ids/migration.sql",
    import.meta.url,
  ),
  "utf-8",
);

const hyphenMigration = await readFile(
  new URL(
    "../../db/src/migrations/20260905000000_public_team_id_hyphens/migration.sql",
    import.meta.url,
  ),
  "utf-8",
);

describe("permanent public team identity", () => {
  it("generates lowercase DNS-safe NanoIDs and controls the field in Better Auth", () => {
    const ids = Array.from({ length: 1000 }, () => createPublicTeamId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]{12}[a-z0-9]$/u);
    }
    expect(ids.some((id) => id.includes("-"))).toBe(true);
    expect(publicTeamIdField).toMatchObject({ required: true, input: false, unique: true });
    const created = initializePublicTeamId({ slug: "editable", publicId: "attacker00" });
    expect(created.data.publicId).not.toBe("attacker00");
    expect(created.data.slug).toBe("editable");
  });

  it("requires unique IDs and prevents ID changes", async () => {
    const client = new PGlite();
    try {
      await client.exec(
        "CREATE TABLE organization (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, slug text UNIQUE)",
      );
      await client.exec(migration);
      await client.exec(hyphenMigration);
      expect(migration).not.toMatch(/public_id[^;]*DEFAULT/iu);

      const inserted = await client.query<{ id: string; public_id: string }>(
        "INSERT INTO organization (name, slug, public_id) VALUES ('Team', 'team', 'abc123def45678') RETURNING id, public_id",
      );
      const team = inserted.rows[0];
      if (!team) {
        throw new Error("Missing inserted team");
      }

      for (const valid of ["team-abcdefghi", "a------------z", "0123456789abcd"]) {
        await client.query("INSERT INTO organization (slug, public_id) VALUES ($1, $2)", [
          valid,
          valid,
        ]);
      }

      await client.query("UPDATE organization SET name = 'Renamed' WHERE id = $1", [team.id]);
      const renamed = await client.query<{ public_id: string }>(
        "SELECT public_id FROM organization WHERE id = $1",
        [team.id],
      );
      expect(renamed.rows[0]?.public_id).toBe(team.public_id);
      await expect(
        client.query("UPDATE organization SET public_id = 'changed0000000' WHERE id = $1", [
          team.id,
        ]),
      ).rejects.toThrow("Public team IDs are permanent");
      await expect(
        client.query(
          "INSERT INTO organization (slug, public_id) VALUES ('duplicate', 'abc123def45678')",
        ),
      ).rejects.toThrow();
      await expect(
        client.query("INSERT INTO organization (slug) VALUES ('missing')"),
      ).rejects.toThrow();
      for (const invalid of [
        "abc123def4",
        "team-abcde",
        "UPPERCASE0",
        "too-short",
        "-bc123def4",
        "abc123def-",
        "abc_23def4",
        "01234567890",
        "012345678901",
        "0123456789012",
        "012345678901234",
        "-bc123def45678",
        "abc123def4567-",
        "abc_23def45678",
        "ABC123DEF45678",
      ]) {
        await expect(
          client.query("INSERT INTO organization (slug, public_id) VALUES ($1, $2)", [
            invalid,
            invalid,
          ]),
        ).rejects.toThrow();
      }
    } finally {
      await client.close();
    }
  }, 15_000);
});
