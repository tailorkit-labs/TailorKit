import { runtimeProjectAccess } from "./runtime/access";
import { env } from "./env";
import type { Organization } from "@tailorkit/db/schema/auth";
import type { Project } from "@tailorkit/db/schema/project";
import { getStorage } from "@tailorkit/storage";
import type { Storage } from "@tailorkit/storage";
import { auth } from "@tailorkit/auth";
import { db } from "@tailorkit/db";
import { authenticateCliToken } from "./cli-token";
import { initializeObservability, setSpanAttributes, withSpan } from "@tailorkit/observability";

export interface Context {
  project: Project;
  organization: Organization;
  storage: Storage;
  /** Internal metadata-only access; not a project host credential. */
  runtimeService?: boolean;
  /** Present only for the dedicated CLI HTTP surface. */
  cliToken?: Awaited<ReturnType<typeof authenticateCliToken>>;
}

export async function createCliContext({ request }: { request: Request }): Promise<Context> {
  await initializeObservability("tailorkit-web");
  const [scheme, secret] = request.headers.get("authorization")?.split(" ") ?? [];
  if (scheme !== "Bearer" || !secret) throw new Error("Missing CLI deploy token");
  const cliToken = await authenticateCliToken(secret);
  const project = await db.query.project.findFirst({
    where: { id: cliToken.projectId },
    with: { organization: true },
  });
  const storage = getStorage();
  if (!project?.organization || !storage) throw new Error("CLI project unavailable");
  return { project, organization: project.organization, storage, cliToken };
}

export async function createContext({ request }: { request: Request }): Promise<Context> {
  await initializeObservability("tailorkit-web");

  return withSpan("api_platform.create_context", async () => {
    const storage = getStorage();
    if (!storage) {
      throw new Error("Storage not initialized");
    }

    const [scheme, key] = request.headers.get("authorization")?.split(" ") ?? [];

    if (!key) {
      throw new Error("Authorization header not found");
    }
    if (scheme !== "Bearer") {
      throw new Error("Invalid authorization scheme");
    }

    const runtimeProject = await runtimeProjectAccess(request, env.APP_RUNTIME_SERVICE_TOKEN);
    let projectId: string;

    if (runtimeProject) {
      projectId = runtimeProject;
    } else {
      const apiKey = await auth.api.verifyApiKey({ body: { configId: "project-host", key } });
      if (!apiKey?.valid) throw new Error("Invalid API key");
      projectId = apiKey.key?.metadata?.projectId;
      if (!projectId) throw new Error("Project ID not found in API key metadata");
    }

    const project = await db.query.project.findFirst({
      where: {
        id: projectId,
      },
      with: { organization: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    if (!project.organization) {
      throw new Error("Organization not found");
    }

    setSpanAttributes({
      "tailorkit.package": "api-platform",
      "tailorkit.resource_type": "project",
      "tailorkit.authenticated": true,
    });

    return {
      project,
      organization: project.organization,
      storage,
      runtimeService: Boolean(runtimeProject),
    };
  });
}
