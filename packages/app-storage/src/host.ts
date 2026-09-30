import { createStorageClient } from "./client";
import type { StorageClient } from "./client";
import { StorageError } from "./errors";
/** Bind once per host-rendered app. The iframe cannot choose the endpoint, app, or installation. */
export function createHostStorageClient(options: {
  baseUrl: string | URL;
  appId: string;
  fetch?: typeof fetch;
}): StorageClient {
  const base = new URL(options.baseUrl, globalThis.location?.href);
  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }
  return createStorageClient({
    fetch: options.fetch,
    getSession: async () => {
      const response = await (options.fetch ?? fetch)(new URL("storage/session", base), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: options.appId }),
      });
      if (!response.ok) {
        throw new StorageError(
          ({ 401: "UNAUTHORIZED", 403: "FORBIDDEN" } as const)[response.status as 401 | 403] ??
            "UNAVAILABLE",
          "Unable to authorize app storage",
        );
      }
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("token" in value) ||
        !("expiresAt" in value) ||
        !("url" in value) ||
        typeof value.token !== "string" ||
        typeof value.expiresAt !== "number" ||
        typeof value.url !== "string"
      ) {
        throw new StorageError("UNAVAILABLE", "Invalid host storage session");
      }
      return { token: value.token, expiresAt: value.expiresAt, url: value.url };
    },
  });
}
