export default {
  appId: "fd0d4581-fa16-4b9a-8422-ccadde60bb91",
  host: "http://localhost:5010/api/tailorkit",
  server: {
    migrations: "./src/db/migrations",
  },
} satisfies import("tailorkit/app/config").TailorKitConfig;
