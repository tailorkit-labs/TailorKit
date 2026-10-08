import type { TailorKitConfig } from "tailorkit/app/config";

export default {
  appId: "backend-todo",
  host: "http://localhost:5010/api/tailorkit",
  server: { migrations: "./src/db/migrations" },
} satisfies TailorKitConfig;
