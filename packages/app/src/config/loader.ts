import { cosmiconfig } from "cosmiconfig";
import path from "node:path";
import type { ResolvedTailorKitConfig } from "./config";
import { tailorkitConfigSchema } from "./config";

export interface LoadedTailorKitConfig {
  config: ResolvedTailorKitConfig;
  filepath: string;
  root: string;
}

const explorer = cosmiconfig("tailorkit", {
  searchPlaces: ["tailorkit.config.ts", "tailorkit.config.mjs", "tailorkit.config.js"],
});

export const loadTailorKitConfig = async (
  configPath: string | undefined,
  cwd = process.cwd(),
): Promise<LoadedTailorKitConfig> => {
  const searchFrom = path.resolve(cwd);
  const result =
    configPath === undefined
      ? await explorer.search(searchFrom)
      : await explorer.load(path.resolve(searchFrom, configPath));

  if (result === null) {
    throw new Error(`Could not find tailorkit config from ${searchFrom}.`);
  }
  if (result.config && typeof result.config === "object" && "storage" in result.config) {
    throw new Error(
      "The legacy storage configuration was removed. Use server configuration and @tailorkit/apps-server.",
    );
  }

  return {
    config: tailorkitConfigSchema.parse(result.config),
    filepath: result.filepath,
    root: path.dirname(result.filepath),
  };
};
