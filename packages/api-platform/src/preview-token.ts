import { timingSafeEqual } from "node:crypto";
import { hashSecret } from "@tailorkit/api-utils/hashing";
import { env } from "#env";
import { z } from "zod";

const viewerTokenLifetimeMs = 5 * 60 * 1000;
const tokenSchema = z.tuple([z.coerce.number().int().positive(), z.string().min(1)]);

function getSigningSecret(): string {
  if (!env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET is required for preview tokens.");
  }
  return env.AUTH_SECRET;
}

function signature(sessionId: string, expiresAt: number): string {
  return hashSecret(`${sessionId}.${expiresAt}`, getSigningSecret());
}

/** A short-lived, bearer URL credential for an already scope-authorized preview asset request. */
export function createPreviewViewerToken(sessionId: string, now = Date.now()): string {
  const expiresAt = now + viewerTokenLifetimeMs;
  return `${expiresAt}.${signature(sessionId, expiresAt)}`;
}

export function verifyPreviewViewerToken(
  sessionId: string,
  token: string,
  now = Date.now(),
): boolean {
  return previewViewerTokenExpiresAt(sessionId, token, now) !== null;
}

export function previewViewerTokenExpiresAt(
  sessionId: string,
  token: string,
  now = Date.now(),
): number | null {
  const parsed = tokenSchema.safeParse(token.split("."));
  if (!parsed.success) {
    return null;
  }
  const [expiresAt, receivedSignature] = parsed.data;
  if (expiresAt <= now) {
    return null;
  }

  const expectedSignature = signature(sessionId, expiresAt);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  return received.length === expected.length && timingSafeEqual(received, expected)
    ? expiresAt
    : null;
}
