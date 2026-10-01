import { AppError } from "../errors";
import type { Session } from "./connection";

/** Host-owned provider: project credentials never cross into the sandbox. */
export function createSessionProvider(options: {
  baseUrl: string | URL;
  appId: string;
  fetch?: typeof fetch;
}) {
  const base = new URL(options.baseUrl, globalThis.location?.href);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  let cached: Session | undefined;
  let pending: Promise<Session> | undefined;
  return (input: { refresh: boolean }): Promise<Session> => {
    if (!input.refresh && cached && cached.expiresAt > Date.now() + 5000)
      return Promise.resolve(cached);
    pending ??= (async () => {
      const response = await (options.fetch ?? fetch)(new URL("storage/session", base), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: options.appId }),
      });
      if (!response.ok)
        throw new AppError(
          response.status === 401
            ? "UNAUTHORIZED"
            : response.status === 403
              ? "FORBIDDEN"
              : "UNAVAILABLE",
          "Unable to authorize the app backend",
        );
      const value = (await response.json()) as Partial<Session>;
      if (
        typeof value.token !== "string" ||
        typeof value.expiresAt !== "number" ||
        typeof value.url !== "string"
      )
        throw new AppError("UNAVAILABLE", "Invalid app session");
      cached = { token: value.token, expiresAt: value.expiresAt, url: value.url };
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
