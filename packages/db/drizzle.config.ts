import { defineConfig } from "drizzle-kit";
import { env } from "#env";

const getDrizzleDatabaseUrl = (url: string) => {
  if (!url) {
    return url;
  }

  const parsed = new URL(url);

  for (const param of ["sslcert", "sslkey", "sslrootcert"]) {
    if (parsed.searchParams.get(param) === "system") {
      parsed.searchParams.delete(param);
    }
  }

  return parsed.toString();
};

export default defineConfig({
  dbCredentials: {
    url: getDrizzleDatabaseUrl(env.DATABASE_URL ?? ""),
  },
  dialect: "postgresql",
  out: "./src/migrations",
  schema: "./src/schema/index.ts",
  verbose: true,
});
