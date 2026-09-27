import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { getRequest } from "@tanstack/react-start/server";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createContext, appRouter } from "@tailorkit/api";
import { QueryClient } from "@tanstack/react-query";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { deploymentHeaders } from "./deployment-headers";

export const getQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Prevent SSR-prefetched queries from immediately refetching after hydration.
        staleTime: 60_000,
      },
    },
  });

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(appRouter, {
      context: () => createContext({ request: getRequest() }),
    }),
  )
  .client((): RouterClient<typeof appRouter> => {
    const link = new RPCLink({
      url: `${window.location.origin}/api/rpc`,
      headers: deploymentHeaders,
    });

    return createORPCClient(link);
  });

export const client: RouterClient<typeof appRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
