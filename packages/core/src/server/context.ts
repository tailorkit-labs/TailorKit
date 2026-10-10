import type { Client as PlatformClient } from "@tailorkit/client-platform/client/client/index";
import type { TailorKitSchema } from "../schema/index";
import type { TailorKitScopeSchemas } from "./scope";
import type { TailorKitPlatformOptions, TailorKitScopes } from "./types";

export interface TailorKitRuntimeContext {
  subjectId?: string;
  scopes: TailorKitScopes;
}

export interface Context {
  platform: PlatformClient;
  platformHeaders: Record<string, string>;
  request: Request;
  schema: TailorKitSchema;
  scopeSchemas: TailorKitScopeSchemas;
  tailorkit?: TailorKitRuntimeContext;
  authenticate: (ctx: {
    request: Request;
  }) => TailorKitRuntimeContext | null | Promise<TailorKitRuntimeContext | null>;
}

export interface CreateContextOptions {
  platform: PlatformClient;
  platformHeaders?: TailorKitPlatformOptions["headers"];
  request: Request;
  schema: TailorKitSchema;
  scopeSchemas: TailorKitScopeSchemas;
  authenticate: (ctx: {
    request: Request;
  }) => TailorKitRuntimeContext | null | Promise<TailorKitRuntimeContext | null>;
}

export async function createContext(options: CreateContextOptions): Promise<Context> {
  const configuredHeaders = await (typeof options.platformHeaders === "function"
    ? options.platformHeaders()
    : options.platformHeaders);

  const platformHeaders = Object.fromEntries(new Headers(configuredHeaders));

  return {
    platform: options.platform,
    platformHeaders,
    request: options.request,
    schema: options.schema,
    scopeSchemas: options.scopeSchemas,
    authenticate: options.authenticate,
  };
}
