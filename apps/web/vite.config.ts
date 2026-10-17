import nodePath from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import { workflow } from "workflow/vite";

import { env } from "#env";

const { resolve } = nodePath;

const serverPackages = [
  "@tailorkit/api",
  "@tailorkit/api-utils",
  "@tailorkit/auth",
  "@tailorkit/db",
  "@tailorkit/env",
  "@tailorkit/observability",
];

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const isTest = mode === "test";
  const reactPlugin = viteReact({ compiler: true });

  return {
    define: {
      "import.meta.env.VITE_ORG_CREATION_MANAGED": JSON.stringify(
        env.VERCEL_ENV === "production"
      ),
      "import.meta.env.VITE_VERCEL_DEPLOYMENT_ID": JSON.stringify(
        env.VERCEL_DEPLOYMENT_ID ?? ""
      ),
      "import.meta.env.VITE_VERCEL_SKEW_PROTECTION_ENABLED": JSON.stringify(
        env.VERCEL_SKEW_PROTECTION_ENABLED === "1"
      ),
    },
    plugins: isTest
      ? [reactPlugin]
      : lazyPlugins(() => [
          workflow({
            dirs: [resolve(import.meta.dirname, "workflows")],
            runtime: "nodejs24.x",
          }),
          devtools(),
          tailwindcss(),
          tanstackStart({}),
          nitro({
            // Nitro's dev server otherwise treats client.js as a Vite static asset.
            // Forward this prefix to Start, which owns the endpoint and its handlers.
            handlers: [
              { env: "dev", handler: "#start-assets", route: "/api/assets/**" },
            ],

            // Split server code into chunks and minify every generated function.
            inlineDynamicImports: false,
            minify: true,

            routeRules: {
              "/sign-in": {
                redirect: {
                  status: 308,
                  to: "/login",
                },
              },
              "/signin": {
                redirect: {
                  status: 308,
                  to: "/login",
                },
              },
              "/signup": {
                redirect: {
                  status: 308,
                  to: "/sign-up",
                },
              },
            },

            serverDir: false,

            vercel: {
              functionRules: {
                // MCP streams stay open for the entire durable agent turn.
                "/api/platform/app-agent/mcp": { maxDuration: 1800 },
              },
            },

            virtual: {
              "#start-assets": `
            import { fetchViteEnv } from "nitro/vite/runtime";
            export default ({ req }) => fetchViteEnv("ssr", req);
          `,
            },

            // Workflow's Nitro builder must resolve package IDs from the same
            // app root as its Vite transform, rather than the monorepo root.
            workspaceDir: import.meta.dirname,
          }),
          reactPlugin,
        ]),
    server: {
      port: 3000,
    },
    ssr: {
      external: isDev ? undefined : serverPackages,
      noExternal: ["@tailorkit/api-platform", "@tailorkit/agent"],
    },
  };
});
