import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { LazyMotion, domMax } from "motion/react";
import { useState } from "react";

import appCss from "#styles/app.css?url";

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      {
        href: "/favicon.svg",
        rel: "icon",
        type: "image/svg+xml",
      },
      {
        href: "/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
      },
      {
        href: "/favicon-32x32.png",
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
      },
      {
        href: "/favicon-16x16.png",
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
      },
      {
        href: "/site.webmanifest",
        rel: "manifest",
      },
      {
        href: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&display=swap",
        rel: "stylesheet",
      },
    ],
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "TailorKit",
      },
    ],
  }),
});

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
          },
        },
      }),
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen relative">
        <div className="isolate">
          <LazyMotion features={domMax}>
            <QueryClientProvider client={queryClient}>
              <RootProvider theme={{ disableTransitionOnChange: false }}>
                <Outlet />
              </RootProvider>
            </QueryClientProvider>
          </LazyMotion>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
