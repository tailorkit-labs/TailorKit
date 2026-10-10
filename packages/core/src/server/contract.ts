import { appsGet } from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { TailorKitContract } from "../schema/contract";
import type { ToolImplementations, ToolContext } from "../schema/tools";
import { flattenTools, validateToolValue } from "../schema/tools";
import { createTailorKitServer } from "./handler";
import { normalizeTailorKitNamedScope } from "./scope";
import { normalizeBasePath } from "./apps";
import { normalizePublicOrigin } from "./origin";
import { createToolVerifier } from "./tool-auth";
import type { MaybePromise } from "../schema/shared";
import type {
  TailorKitServerBaseOptions,
  TailorKitHandlerOptions,
  TailorKitServerInputOptions,
} from "./types";

export type { ToolImplementations } from "../schema/tools";
export type ContractScopes<T extends TailorKitContract> = {
  [N in keyof T["scopes"]]: StandardSchemaV1.InferInput<T["scopes"][N]>;
};
type Authentication<T extends TailorKitContract> = (options: {
  request: Request;
}) => MaybePromise<{ scopes: Partial<ContractScopes<T>>; subjectId?: string } | null>;
function getImplementation(tree: unknown, path: string): unknown {
  let value = tree;
  for (const name of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, name)) return undefined;
    value = (value as Record<string, unknown>)[name];
  }
  return value;
}
function implementationPaths(tree: unknown, prefix = ""): string[] {
  if (!tree || typeof tree !== "object") return [];
  return Object.entries(tree).flatMap(([name, value]) =>
    typeof value === "function" ? [prefix + name] : implementationPaths(value, prefix + name + "."),
  );
}
/** Bind server tools without placing their implementations in the shared contract. */
export function createServer<const T extends TailorKitContract>(
  options: Omit<TailorKitServerBaseOptions<T["scopes"]>, "scopes"> & {
    contract: T;
    authenticate?: Authentication<T>;
  } & (keyof ToolImplementations<T["tools"], "server"> extends never
      ? { tools?: ToolImplementations<T["tools"], "server"> }
      : { tools: ToolImplementations<T["tools"], "server"> }),
) {
  const { contract, authenticate, tools, ...configuration } = options;
  const declarations = flattenTools(contract.tools);
  for (const [path, leaf] of declarations) {
    if (leaf.kind === "server" && typeof getImplementation(tools, path) !== "function")
      throw new Error(`Missing implementation for tool "${path}"`);
  }
  for (const path of implementationPaths(tools))
    if (declarations.get(path)?.kind !== "server")
      throw new Error(`Undeclared server tool "${path}"`);
  type InternalOptions = TailorKitServerInputOptions & {
    views: T["views"];
    slots: T["slots"];
    tools: T["tools"];
  };
  const server = createTailorKitServer<InternalOptions>({
    ...configuration,
    ...contract,
  } as Parameters<typeof createTailorKitServer<InternalOptions>>[0]);
  const platformUrl = server.$internal.platformBaseUrl;
  const requestPlatform = configuration.$internal?.platformFetch ?? globalThis.fetch;
  const platform = createClient({
    baseUrl: platformUrl,
    fetch: requestPlatform,
    responseStyle: "data",
    throwOnError: true,
  });
  const platformHeaders =
    configuration.$internal?.platformHeaders ??
    (configuration.projectKey
      ? { authorization: `Bearer ${configuration.projectKey}` }
      : undefined);
  const verify = createToolVerifier({ platformUrl, fetch: requestPlatform });
  const basePath = normalizeBasePath(configuration.basePath ?? "/api/tailorkit");
  const publicOrigin = normalizePublicOrigin(configuration.publicUrl);
  return {
    ...server,
    contract,
    async handler(
      request: Request,
      handlerOptions?: TailorKitHandlerOptions<Partial<ContractScopes<T>>>,
    ) {
      const authentication = handlerOptions?.authenticate ?? authenticate;
      if (!authentication) throw new Error("Supply authenticate to createServer or its handler");
      const url = new URL(request.url);
      if (url.pathname === basePath + "/tools/execute") {
        const headers = {
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
        };
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
        if (request.method !== "POST")
          return new Response("Method not allowed", { status: 405, headers });
        let input: { path: string; input?: unknown; requestId: string };
        try {
          input = await request.json();
          if (
            !input ||
            typeof input.path !== "string" ||
            typeof input.requestId !== "string" ||
            !/^[0-9a-f-]{36}$/u.test(input.requestId) ||
            Object.keys(input).some((k) => !["path", "input", "requestId"].includes(k))
          )
            throw new Error();
        } catch {
          return new Response("Invalid tool request", { status: 400, headers });
        }
        const declaration = declarations.get(input.path);
        if (declaration?.kind !== "server")
          return new Response("Tool not found", { status: 404, headers });
        let context: ToolContext;
        try {
          const authorization = request.headers.get("authorization");
          if (!authorization?.startsWith("Bearer ")) throw new Error();
          const identity = await verify(
            authorization.slice(7),
            (publicOrigin ?? url.origin) + basePath + "/tools/execute",
          );
          const schema = contract.scopes[identity.scope.name];
          if (!schema) throw new Error();
          await validateToolValue(schema, identity.scope.value);
          const headers = await (typeof platformHeaders === "function"
            ? platformHeaders()
            : platformHeaders);
          const installation = await appsGet({
            client: platform,
            headers,
            path: { appId: identity.installationId },
            body: { scopes: [normalizeTailorKitNamedScope(identity.scope)] },
            throwOnError: true,
          });
          const installed = "data" in installation ? installation.data : installation;
          if (
            installed.id !== identity.installationId ||
            installed.projectId !== identity.projectId ||
            installed.currentDeployment?.id !== identity.deploymentId
          )
            throw new Error("Installation unavailable");
          context = Object.freeze({ identity, scope: identity.scope, requestId: input.requestId });
        } catch {
          return new Response("Unauthorized", { status: 401, headers });
        }
        let value;
        try {
          value = await validateToolValue(declaration.definition.input, input.input);
        } catch {
          return new Response("Invalid tool input", { status: 400, headers });
        }
        try {
          const implementation = getImplementation(tools, input.path) as (args: {
            input: unknown;
            context: ToolContext;
          }) => unknown;
          const result = await validateToolValue(
            declaration.definition.output,
            await implementation({ input: value, context }),
          );
          return Response.json({ output: result }, { headers });
        } catch {
          return new Response("Tool execution failed", { status: 500, headers });
        }
      }
      return server.handler(request, { authenticate: authentication } as Parameters<
        typeof server.handler
      >[1]);
    },
  };
}
