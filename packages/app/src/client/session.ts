import type { Identity } from "../server/functions";
import { AppError } from "../errors";

const APP_SESSION_RENEWAL_MS = 60_000;

export interface Session {
  toolUrl?: string;
  identity?: Identity;
  subjectId?: string;
  token: string;
  expiresAt: number;
  url: string;
}

function freezeIdentity<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeIdentity(child);
    Object.freeze(value);
  }
  return value;
}

export function sessionRenewalDelay(session: Session) {
  return Math.max(500, session.expiresAt - Date.now() - APP_SESSION_RENEWAL_MS);
}

/** Host-owned provider: project credentials never cross into the sandbox. */
export function createSessionProvider(options: {
  baseUrl: string | URL;
  appId: string;
  /** Product principal used solely to partition the host credential cache. */
  subjectId?: string;
  fetch?: typeof fetch;
}) {
  const base = new URL(options.baseUrl, globalThis.location?.href);
  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }
  let cached: Session | undefined;
  let pending: Promise<Session> | undefined;
  return (input: { refresh: boolean }): Promise<Session> => {
    if (
      options.subjectId !== undefined &&
      !input.refresh &&
      cached &&
      cached.subjectId === options.subjectId &&
      cached.expiresAt > Date.now() + APP_SESSION_RENEWAL_MS
    ) {
      return Promise.resolve(cached);
    }
    pending ??= (async () => {
      const response = await (options.fetch ?? fetch)(new URL("backend/session", base), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: options.appId }),
      }).catch(() => {
        throw new AppError("UNAVAILABLE", "Unable to reach the app session provider");
      });
      if (!response.ok) {
        const code = response.status === 403 ? "FORBIDDEN" : "UNAVAILABLE";
        throw new AppError(
          response.status === 401 ? "UNAUTHORIZED" : code,
          "Unable to authorize the app backend",
        );
      }
      const value = (await response.json()) as Partial<Session>;
      if (
        typeof value.token !== "string" ||
        typeof value.expiresAt !== "number" ||
        typeof value.url !== "string"
      ) {
        throw new AppError("UNAVAILABLE", "Invalid app session");
      }
      if (options.subjectId !== undefined && value.subjectId !== options.subjectId)
        throw new AppError("UNAUTHORIZED", "Authenticated principal changed");
      cached = {
        ...(value.toolUrl !== undefined ? { toolUrl: value.toolUrl } : {}),
        ...(value.identity !== undefined ? { identity: freezeIdentity(value.identity) } : {}),
        token: value.token,
        expiresAt: value.expiresAt,
        url: value.url,
        ...(value.subjectId !== undefined ? { subjectId: value.subjectId } : {}),
      };
      return cached;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
