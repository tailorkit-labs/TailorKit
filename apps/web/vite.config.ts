import { resolve } from "node:path";
import { workflow } from "workflow/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { nitro } from "nitro/vite";
import { env } from "#env";

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
      "import.meta.env.VITE_ORG_CREATION_MANAGED": JSON.stringify(env.VERCEL_ENV === "production"),
      "import.meta.env.VITE_VERCEL_DEPLOYMENT_ID": JSON.stringify(env.VERCEL_DEPLOYMENT_ID ?? ""),
      "import.meta.env.VITE_VERCEL_SKEW_PROTECTION_ENABLED": JSON.stringify(
        env.VERCEL_SKEW_PROTECTION_ENABLED === "1",
      ),
    },
    plugins: isTest
      ? [reactPlugin]
      : [
          workflow({
            dirs: [resolve(import.meta.dirname, "workflows")],
            runtime: "nodejs24.x",
          }),
          devtools(),
          tailwindcss(),
          tanstackStart(),
          nitro({
            // Workflow's Nitro builder must resolve package IDs from the same
            // app root as its Vite transform, rather than the monorepo root.
            workspaceDir: import.meta.dirname,
            serverDir: false,
            // Preview uploads and viewer revisions share this Nitro deployment.
            // KV leases give the CLI 75 seconds to reconnect after an upgrade.
            features: { websocket: !isTest },
            // Nitro's dev server otherwise treats client.js as a Vite static asset.
            // Forward this prefix to Start, which owns the endpoint and its handlers.
            handlers: [{ route: "/api/assets/**", handler: "#start-assets", env: "dev" }],
            virtual: {
              "#start-assets": `
            import { fetchViteEnv } from "nitro/vite/runtime";
            export default ({ req }) => fetchViteEnv("ssr", req);
          `,
            },
            routeRules: {
              "/signup": {
                redirect: {
                  to: "/sign-up",
                  status: 308,
                },
              },
              "/signin": {
                redirect: {
                  to: "/login",
                  status: 308,
                },
              },
              "/sign-in": {
                redirect: {
                  to: "/login",
                  status: 308,
                },
              },
            },
          }),
          reactPlugin,
        ],
    server: {
      port: 3000,
    },
    ssr: {
      external: isDev ? undefined : serverPackages,
      noExternal: ["@tailorkit/api-platform", "@tailorkit/app-agent"],
    },
  };
});
