import type { AppDefinition } from "./functions";
import type { AppMigration } from "../protocol";

/** Interface between an uploaded application module and the server runtime. */
export interface RuntimeManifest {
  apiVersion: number;
  requires: readonly string[];
}
export interface ApplicationModule {
  default: AppDefinition;
  migrations: readonly AppMigration[];
  runtimeManifest: RuntimeManifest;
}

/** Emitted by this SDK's builder; breaking interface changes increment apiVersion. */
export const runtimeManifest = {
  apiVersion: 1,
  requires: ["database", "actions"],
} as const satisfies RuntimeManifest;
