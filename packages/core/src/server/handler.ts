import { RPCHandler } from "@orpc/server/fetch";
import { appsList, previewAccepted } from "@tailorkit/client-platform/client";
import { createClient } from "@tailorkit/client-platform/client/client/index";
import type {
  NoComponentFieldCallbackConflicts,
  NoMixedActionContexts,
  ResolveActionTreeContext,
  ViewContextHierarchy,
  SlotDefinitions,
} from "../schema/index";
import { createTailorKitSchema } from "../schema/schema";
import { flattenActionRouter } from "./actions";
import { normalizeBasePath } from "./apps";
import { handleCliAuthApprovalPage } from "./cli-auth-page";
import { handlePreviewConsent, readPreviewGrantIds } from "./preview-consent";
import { createContext } from "./context";
import {
  selectTailorKitScopes,
  validateTailorKitScopeSchemas,
  validateTailorKitScopes,
} from "./scope";
import { tailorkitRouter } from "./router";
import type {
  InferTailorKitServerActions,
  InferTailorKitServerComponents,
  InferTailorKitServerContexts,
  InferTailorKitServerScopes,
  TailorKitHandlerOptions,
  TailorKitScopes,
  TailorKitServer,
  TailorKitServerInputOptions,
} from "./types";

const defaultPlatformBaseUrl = "https://tailorkit.dev/api/platform";
type AbsolutePath = `/${string}`;
const previewShareIdPattern = /^[A-Za-z0-9_-]{43}$/u;

export function createTailorKitServer<const TOptions extends TailorKitServerInputOptions>(
  options: TOptions & {
    slots?: SlotDefinitions<keyof InferTailorKitServerContexts<NoInfer<TOptions>> & string>;
    actions?: InferTailorKitServerActions<TOptions> &
      NoMixedActionContexts<InferTailorKitServerActions<TOptions>>;
    components: InferTailorKitServerComponents<TOptions> &
      NoComponentFieldCallbackConflicts<InferTailorKitServerComponents<TOptions>>;
    contexts?: InferTailorKitServerContexts<TOptions> &
      ViewContextHierarchy<InferTailorKitServerContexts<TOptions>>;
  },
): TailorKitServer<
  InferTailorKitServerComponents<TOptions>,
  InferTailorKitServerContexts<TOptions>,
  InferTailorKitServerActions<TOptions>,
  ResolveActionTreeContext<InferTailorKitServerActions<TOptions>>,
  InferTailorKitServerScopes<TOptions>
> & {
  readonly $slots?: TOptions extends { slots: infer V } ? V : Record<never, never>;
} {
  const basePath = normalizeBasePath(options.basePath ?? "/api/tailorkit");
  const scopeSchemas = validateTailorKitScopeSchemas(options.scopes);
  const previewReturnPath = options.preview?.returnPath ?? "/";
  if (
    !previewReturnPath.startsWith("/") ||
    previewReturnPath.startsWith("//") ||
    previewReturnPath.includes("\\") ||
    /[\r\n]/u.test(previewReturnPath)
  ) {
    throw new Error("preview.returnPath must be a same-origin root-relative path.");
  }
  const schema = createTailorKitSchema<
    InferTailorKitServerComponents<TOptions>,
    InferTailorKitServerContexts<TOptions>,
    InferTailorKitServerActions<TOptions>
  >({
    actions: options.actions as
      | (InferTailorKitServerActions<TOptions> &
          NoMixedActionContexts<InferTailorKitServerActions<TOptions>>)
      | undefined,
    slots: options.slots,
    components: options.components,
    contexts: options.contexts,
  });
  const platformBaseUrl = options.$internal?.platformBaseUrl ?? defaultPlatformBaseUrl;
  const assetsBaseUrl = options.assetsBaseUrl;
  const actions = flattenActionRouter(options.actions);
  const platform = createClient({
    baseUrl: platformBaseUrl,
    fetch: options.$internal?.platformFetch,
    responseStyle: "data",
    throwOnError: true,
  });
  const platformHeaders =
    options.$internal?.platformHeaders ??
    (options.projectKey ? { authorization: `Bearer ${options.projectKey}` } : undefined);
  const rpcHandler = new RPCHandler(tailorkitRouter);

  // oxlint-disable-next-line complexity -- request dispatch is intentionally centralized here.
  const handler = async (
    request: Request,
    handlerOptions: TailorKitHandlerOptions<
      ResolveActionTreeContext<InferTailorKitServerActions<TOptions>>,
      InferTailorKitServerScopes<TOptions>
    >,
  ) => {
    const authenticate = async ({ request }: { request: Request }) => {
      const hostContext = await handlerOptions.authenticate({ request });
      if (!hostContext) {
        return null;
      }

      return {
        ...hostContext,
        scopes: await validateTailorKitScopes(scopeSchemas, hostContext.scopes),
      };
    };
    const url = new URL(request.url);
    const previewPrefix = `${basePath}/preview/`;
    if (url.pathname === `${basePath}/schema`) {
      return Response.json(schema.serialize());
    }

    if (url.pathname === `${basePath}/meta`) {
      return Response.json({
        assetsBaseUrl: assetsBaseUrl ?? null,
        schema: schema.serialize(),
      });
    }

    const previewShareId = url.pathname.startsWith(previewPrefix)
      ? url.pathname.slice(previewPrefix.length)
      : "";
    if (
      (request.method === "GET" || request.method === "POST") &&
      previewShareIdPattern.test(previewShareId)
    ) {
      const context = await createContext({
        actions,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
        authenticate,
      });
      return handlePreviewConsent({
        request,
        shareId: previewShareId,
        basePath,
        returnPath: previewReturnPath,
        signInPath: options.cliAuth?.signInPath,
        platform: context.platform,
        platformHeaders: context.platformHeaders,
        authenticate: context.authenticate,
      });
    }

    if (request.method === "GET" && url.pathname === `${basePath}/preview/metadata`) {
      const context = await createContext({
        actions,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
        authenticate,
      });
      const viewer = await context.authenticate({ request });
      if (!viewer) {
        return new Response("Unauthorized", { status: 401 });
      }
      const scopes = resolveReadScopes(url, viewer.scopes);
      if (scopes instanceof Response) {
        return scopes;
      }
      if (scopes.length === 0) {
        return new Response("Preview unavailable", {
          status: 404,
          headers: { "cache-control": "no-store" },
        });
      }
      const result = await previewAccepted({
        body: { grantIds: readPreviewGrantIds(request), scopes },
        client: context.platform,
        headers: context.platformHeaders,
        throwOnError: true,
      });
      const data = "data" in result ? result.data : result;
      const selected = data.items.find(
        (item) => item.preview.sessionId === url.searchParams.get("sessionId"),
      );
      return selected
        ? Response.json(selected.preview, { headers: { "cache-control": "no-store" } })
        : new Response("Preview unavailable", {
            status: 404,
            headers: { "cache-control": "no-store" },
          });
    }

    if (request.method === "GET" && url.pathname === `${basePath}/apps`) {
      const context = await createContext({
        actions,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
        authenticate,
      });
      const tailorkit = await context.authenticate({ request });

      if (!tailorkit) {
        return new Response("Unauthorized", { status: 401 });
      }

      const scopes = resolveReadScopes(url, tailorkit.scopes);
      if (scopes instanceof Response) {
        return scopes;
      }
      if (scopes.length === 0) {
        return Response.json([], { headers: { "cache-control": "no-store" } });
      }

      const items: Record<string, unknown>[] = [];
      let page = 1;
      for (;;) {
        const result = await appsList({
          client: context.platform,
          headers: context.platformHeaders,
          body: { page, pageSize: 100, scopes },
          throwOnError: true,
        });
        const data = "data" in result ? result.data : result;
        items.push(...data.items);
        if (!data.pagination.hasMore) {
          break;
        }
        page += 1;
      }
      const grantIds = readPreviewGrantIds(request);
      if (grantIds.length) {
        const result = await previewAccepted({
          body: { grantIds, scopes },
          client: context.platform,
          headers: context.platformHeaders,
          throwOnError: true,
        });
        const data = "data" in result ? result.data : result;
        const byId = new Map(items.map((item, index) => [item.id, index]));
        for (const accepted of data.items) {
          const index = byId.get(accepted.app.id);
          if (index === undefined) {
            byId.set(accepted.app.id, items.length);
            items.push({ ...accepted.app, preview: accepted.preview });
          } else {
            items[index] = { ...items[index], preview: accepted.preview };
          }
        }
      }
      return Response.json(items, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === `${basePath}/cli-auth/approve`) {
      const context = await createContext({
        actions,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
        authenticate,
      });

      return handleCliAuthApprovalPage({
        authenticate: context.authenticate,
        platform: context.platform,
        platformHeaders: context.platformHeaders,
        request,
        signInPath: options.cliAuth?.signInPath,
      });
    }

    const rpcResult = await rpcHandler.handle(request, {
      context: await createContext({
        actions,
        platform,
        platformHeaders,
        request,
        schema,
        scopeSchemas,
        authenticate,
      }),
      prefix: basePath as AbsolutePath,
    });

    if (rpcResult.response) {
      return rpcResult.response;
    }

    return new Response("TailorKit route not found", { status: 404 });
  };

  return {
    $internal: { assetsBaseUrl, platformBaseUrl, router: tailorkitRouter, schema },
    handler,
  };
}

function resolveReadScopes(url: URL, availableScopes: TailorKitScopes) {
  try {
    const names = url.searchParams.getAll("scopes");
    if (names.length === 1 && names[0] === "") {
      return [];
    }
    return selectTailorKitScopes(availableScopes, names.length ? names : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid scope selection.";
    return new Response(message, { status: 400 });
  }
}
