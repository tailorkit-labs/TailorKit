/** Only the trusted runtime can select projects for private bundle metadata lookups. */
export async function runtimeProjectAccess(request: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) return null;

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) return null;

  // Compare fixed-size digests, without early exits based on credential contents.
  const encoder = new TextEncoder();
  const [expected, supplied] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    crypto.subtle.digest("SHA-256", encoder.encode(authorization.slice(7))),
  ]);
  const left = new Uint8Array(expected);
  const right = new Uint8Array(supplied);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  if (difference !== 0) return null;

  const path = new URL(request.url).pathname;
  if (
    request.method !== "POST" ||
    !/^\/api\/platform\/apps\/[a-zA-Z0-9_-]+\/runtime\/?$/u.test(path)
  ) {
    throw new Error("Runtime credential is restricted to bundle metadata");
  }

  const projectId = request.headers.get("x-tailorkit-project-id");
  if (!projectId || projectId.length > 256) throw new Error("Runtime project required");

  return projectId;
}
