import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("#env", () => ({ env: { AUTH_SECRET: "test-preview-secret" } }));

const { createPreviewViewerToken, previewViewerTokenExpiresAt, verifyPreviewViewerToken } =
  await import("./preview-token");

describe("preview viewer token expiry", () => {
  it("returns the verified expiry and rejects the exact expiry boundary", () => {
    const issuedAt = 1_000_000;
    const token = createPreviewViewerToken("session", issuedAt);
    const expiresAt = issuedAt + 5 * 60 * 1000;
    expect(previewViewerTokenExpiresAt("session", token, expiresAt - 1)).toBe(expiresAt);
    expect(verifyPreviewViewerToken("session", token, expiresAt - 1)).toBe(true);
    expect(previewViewerTokenExpiresAt("session", token, expiresAt)).toBeNull();
    expect(verifyPreviewViewerToken("session", token, expiresAt)).toBe(false);
    expect(previewViewerTokenExpiresAt("another-session", token, issuedAt)).toBeNull();
  });
});
