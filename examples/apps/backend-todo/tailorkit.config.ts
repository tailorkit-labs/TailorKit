export default {
  appId: "backend-todo",
  host: "http://localhost:5010/api/tailorkit",
  server: { entry: "./src/server.ts", references: "./src/server.gen.ts" },
} satisfies import("@tailorkit/app/config").TailorKitConfig;
