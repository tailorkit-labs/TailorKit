import type { ToolIdentity } from "../schema/tools";

const audience = "tailorkit-app";
const decode = (part: string) =>
  Uint8Array.from(atob(part.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
/** Only configured platform keys are trusted. Never follow URLs from token headers. */
export function createToolVerifier(options: {
  platformUrl: string;
  projectId?: string;
  fetch: typeof fetch;
}) {
  const issuer = options.platformUrl.replace(/\/$/u, "");
  let cached: { expiresAt: number; keys: (JsonWebKey & { kid: string })[] } | undefined;
  let refreshing: Promise<void> | undefined;
  let nextUnknownKeyRefresh = 0;
  function refreshKeys(): Promise<void> {
    refreshing ??= (async () => {
      const response = await options.fetch(issuer + "/runtime/keys", { redirect: "manual" });
      if (!response.ok) throw new Error("Signing keys unavailable");
      const result = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
      if (
        !Array.isArray(result.keys) ||
        !result.keys.length ||
        result.keys.length > 32 ||
        result.keys.some(
          (k) => k.kty !== "EC" || k.crv !== "P-256" || k.d || !k.x || !k.y || !k.kid,
        )
      )
        throw new Error("Invalid signing keys");
      cached = { expiresAt: Date.now() + 60_000, keys: result.keys };
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }
  return async (token: string, toolUrl: string): Promise<ToolIdentity> => {
    if (token.length > 8192) throw new Error("Invalid tool credential");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid tool credential");
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = JSON.parse(new TextDecoder().decode(decode(headerPart)));
    if (
      header.alg !== "ES256" ||
      header.typ !== "JWT" ||
      typeof header.kid !== "string" ||
      header.crit
    )
      throw new Error("Invalid tool credential");
    let refreshed = false;
    if (!cached || cached.expiresAt <= Date.now()) {
      await refreshKeys();
      refreshed = true;
    }
    let jwk = cached?.keys.find((k) => k.kid === header.kid);
    if (!jwk && !refreshed) {
      if (refreshing) {
        await refreshing;
      } else if (Date.now() >= nextUnknownKeyRefresh) {
        nextUnknownKeyRefresh = Date.now() + 10_000;
        await refreshKeys();
      }
      jwk = cached?.keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) throw new Error("Unknown signing key");
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        decode(signaturePart),
        new TextEncoder().encode(headerPart + "." + payloadPart),
      ))
    )
      throw new Error("Invalid signature");
    const claims = JSON.parse(new TextDecoder().decode(decode(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== issuer ||
      claims.aud !== audience ||
      claims.toolUrl !== toolUrl ||
      !Number.isInteger(claims.exp) ||
      !Number.isInteger(claims.iat) ||
      claims.exp <= now ||
      claims.iat > now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 300 ||
      claims.sub !== claims.installationId ||
      (options.projectId && claims.projectId !== options.projectId)
    )
      throw new Error("Invalid tool claims");
    for (const name of [
      "installationId",
      "appId",
      "projectId",
      "deploymentId",
      "publicTeamId",
      "appPublicId",
    ])
      if (typeof claims[name] !== "string" || !claims[name] || claims[name].length > 256)
        throw new Error("Invalid installation identity");
    if (
      claims.appId !== claims.installationId ||
      (claims.subjectId !== undefined &&
        (typeof claims.subjectId !== "string" ||
          !claims.subjectId ||
          claims.subjectId.length > 256)) ||
      !claims.scope ||
      typeof claims.scope.name !== "string" ||
      !claims.scope.name ||
      !claims.scope.value ||
      typeof claims.scope.value !== "object" ||
      Array.isArray(claims.scope.value)
    )
      throw new Error("Invalid scope identity");
    return Object.freeze({
      subjectId: claims.subjectId,
      installationId: claims.installationId,
      appId: claims.appId,
      projectId: claims.projectId,
      deploymentId: claims.deploymentId,
      scope: Object.freeze(claims.scope),
      expiresAt: claims.exp * 1000,
    });
  };
}
