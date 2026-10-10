import { z } from "zod";
import type { AppDefinition, ApplicationModule } from "@tailorkit/app/server";
import { AppError } from "./errors";
import { createExecution } from "./execution";
import type { Persistence } from "./database/driver";

const bundle = z.object({
  runtimeManifest: z.object({ apiVersion: z.number().int(), requires: z.array(z.string()) }),
  default: z.custom<AppDefinition>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "functions" in value &&
      typeof value.functions === "object" &&
      value.functions !== null &&
      !Array.isArray(value.functions),
  ),
  migrations: z.array(
    z.object({ id: z.string(), hash: z.string(), statements: z.array(z.string()) }),
  ),
});
const supportedFeatures = new Set(["database", "actions", "database-relations", "tools"]);

/** Check compatibility before creating tables or applying any application migrations. */
export function createApplicationExecution(application: unknown, persistence: Persistence) {
  const parsed = bundle.safeParse(application);
  if (!parsed.success) {
    throw new AppError("INCOMPATIBLE_VERSION", "Invalid application bundle exports");
  }
  const module: ApplicationModule = parsed.data;
  if (module.runtimeManifest.apiVersion !== 1) {
    throw new AppError(
      "INCOMPATIBLE_VERSION",
      `Unsupported application API version: ${module.runtimeManifest.apiVersion}`,
    );
  }
  const unsupported = module.runtimeManifest.requires.filter(
    (feature) => !supportedFeatures.has(feature),
  );
  if (unsupported.length) {
    throw new AppError(
      "INCOMPATIBLE_VERSION",
      `Unsupported application features: ${unsupported.join(", ")}`,
    );
  }
  return createExecution(module.default, persistence, module.migrations);
}
