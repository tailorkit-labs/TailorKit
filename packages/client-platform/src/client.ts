import type { CreateClientConfig } from "./client/client/index.js";

export const createClientConfig: CreateClientConfig = (config = {}) => ({
  ...config,
  baseUrl: config.baseUrl ?? "https://tailorkit.dev/api/platform",
});
