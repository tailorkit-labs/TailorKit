import type { AppDeploymentMetadata } from "@tailorkit/api-utils/app-auth";
import { AppError } from "@tailorkit/app/server";

/** Public URL identifiers must describe the same private bundle as the payload. */
export function validateDeploymentPublication(
  metadata: AppDeploymentMetadata,
  publication: { projectId: string; appPublicId: string },
): void {
  const segments = metadata.objectKey.split("/");
  if (
    metadata.projectId !== publication.projectId ||
    segments.length !== 10 ||
    segments[0] !== "teams" ||
    segments[2] !== "projects" ||
    segments[3] !== publication.projectId ||
    segments[4] !== "apps" ||
    segments[5] !== publication.appPublicId ||
    segments[6] !== "deployments" ||
    segments[8] !== "server" ||
    segments[9] !== "server.js"
  ) {
    throw new AppError("BAD_REQUEST", "Deployment metadata does not match the route");
  }
}
