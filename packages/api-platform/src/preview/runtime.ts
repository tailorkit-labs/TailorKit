import { ORPCError } from "@orpc/server";
import { getBaseUrl } from "@tailorkit/env";
import { getKV } from "@tailorkit/kv";
import { env } from "#env";

export function requirePreviewKV() {
  const kv = getKV();
  if (!kv) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Preview storage is unavailable: configure KV.",
    });
  }
  return kv;
}

export function previewWebSocketUrl(sessionId: string, role?: "viewer"): string {
  const url = new URL("/api/platform/preview/ws", getBaseUrl(env).replace(/^http/u, "ws"));
  url.searchParams.set("session", sessionId);
  if (role) {
    url.searchParams.set("role", role);
  }
  return url.href;
}
