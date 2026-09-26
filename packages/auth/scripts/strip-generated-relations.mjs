import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(scriptDirectory, "../../db/src/schema/auth.generated.ts");
const generatedSchema = await readFile(schemaPath, "utf8");
const relationsStart = generatedSchema.indexOf(
  "\nexport const authRelations = defineRelationsPart(",
);

if (relationsStart === -1) {
  throw new Error("Could not find generated Better Auth relations to remove.");
}

const schemaWithoutRelations = generatedSchema
  .slice(0, relationsStart)
  .replace(
    'import { defineRelationsPart, sql } from "drizzle-orm";',
    'import { sql } from "drizzle-orm";',
  );

await writeFile(schemaPath, schemaWithoutRelations);
