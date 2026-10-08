import { existsSync } from "node:fs";
import path from "node:path";

export function appDatabasePaths(root: string, migrations?: string) {
  const legacy =
    !existsSync(path.join(root, "src/db/schema.ts")) &&
    existsSync(path.join(root, "src/schema.ts"));
  return {
    schema: path.join(root, legacy ? "src/schema.ts" : "src/db/schema.ts"),
    migrations: path.resolve(root, migrations ?? (legacy ? "./migrations" : "./src/db/migrations")),
  };
}
