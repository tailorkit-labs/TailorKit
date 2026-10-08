import path from "node:path";

export function appDatabasePaths(root: string, migrations?: string) {
  return {
    schema: path.join(root, "src/db/schema.ts"),
    migrations: path.resolve(root, migrations ?? "./src/db/migrations"),
  };
}
