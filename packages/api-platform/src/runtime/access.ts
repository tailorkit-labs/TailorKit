import { runtimeServiceAuthorized } from "@tailorkit/api-utils/app-auth";
/** Only the trusted runtime can select projects for private bundle metadata lookups. */
export async function runtimeProjectAccess(request: Request, secret: string | undefined) {
  if (!(await runtimeServiceAuthorized(request, secret))) return null;

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
