import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { TailorKitRouterClient } from "./router";

type HeaderInput = ConstructorParameters<typeof Headers>[0];

export interface TailorKitClientOptions {
  fetch?: typeof fetch;
  headers?: HeaderInput | (() => HeaderInput | Promise<HeaderInput>);
  url: string;
}

export function createTailorKitClient(options: TailorKitClientOptions): TailorKitRouterClient {
  const url = URL.canParse(options.url) ? new URL(options.url) : undefined;
  const link = new RPCLink({
    origin: url?.origin,
    async fetch(url, init) {
      const configuredHeaders = await (typeof options.headers === "function"
        ? options.headers()
        : options.headers);
      const headers = new Headers(configuredHeaders);
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });

      return (options.fetch ?? fetch)(url, {
        ...init,
        headers,
      });
    },
    url: (url ? `${url.pathname}${url.search}${url.hash}` : options.url) as `/${string}`,
  });

  return createORPCClient<TailorKitRouterClient>(link);
}
