import type { TailorKitConfig } from "@tailorkit/app/config";

export default {
  appId: "persistent-todo-demo",
  host: "http://localhost:5011/api/tailorkit",
  storage: {
    workerName: "tailorkit-persistent-todo",
    issuer: "http://localhost:5011",
    origins: ["http://localhost:5011"],
  },
} satisfies TailorKitConfig;
