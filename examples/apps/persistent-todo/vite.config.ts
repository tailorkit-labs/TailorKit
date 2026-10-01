import { issueStorageToken } from "@tailorkit/app-storage/auth";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTailorKitServer } from "@tailorkit/core/server";
import { primitives } from "@tailorkit/core/primitives/zod";
import { defineConfig } from "vite";
import { z } from "zod";
// Development-only authenticated host. Vite binds to loopback; production hosts must use their real session/membership checks.
const privateKey = JSON.parse(
  await readFile(new URL(".tailorkit-storage/dev-host-key.json", import.meta.url), "utf-8"),
) as JsonWebKey;
const hostOptions = {
  scopes: { workspace: z.object({ id: z.string() }) },
  components: {
    ...primitives(),
    Button: {
      fields: z.object({ variant: z.enum(["default", "secondary"]).optional() }),
      children: true,
      callbacks: { onClick: {} },
    },
  },
  contexts: { "/": z.object({}) },
  slots: { panel: { views: ["/"] } },
  // This loopback fixture substitutes the platform issuer for the legacy local gateway.
  $internal: {
    platformFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (!request.url.endsWith("/apps/persistent-todo-demo/runtime/session"))
        throw new Error("Unexpected fixture platform request");
      const body = (await request.json()) as { userId: string; installationId: string };
      return Response.json(
        await issueStorageToken(
          {
            issuer: "http://localhost:5011",
            audience: "tailorkit-storage",
            keyId: "local-dev",
            privateKey,
          },
          {
            userId: body.userId,
            installationId: body.installationId,
            appId: "persistent-todo-demo",
          },
        ),
      );
    },
  },
  storage: {
    resolveInstallation: ({
      appId,
      scopes,
    }: {
      appId: string;
      scopes: Record<string, Record<string, unknown>>;
    }) =>
      appId === "persistent-todo-demo" && scopes.workspace?.id === "demo"
        ? {
            userId: "local-user",
            appId,
            installationId: "demo",
            deploymentId: "local",
            url: "http://localhost:8787/rpc",
          }
        : null,
  },
} as const;
export const host = createTailorKitServer(hostOptions);
export default defineConfig({
  oxc: { jsx: { importSource: "react" } },
  server: { strictPort: true, host: "localhost", port: 5011 },
  plugins: [
    {
      name: "tailorkit-local-host",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const handle = async () => {
            if (req.url === "/app/client.js") {
              try {
                res.setHeader("content-type", "application/javascript");
                res.end(await readFile(path.resolve(".tailorkit/client.js")));
              } catch {
                res.statusCode = 404;
                res.end("Build the app first");
              }
              return;
            }
            if (!req.url?.startsWith("/api/tailorkit/")) {
              return next();
            }
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(Buffer.from(chunk));
            }
            const request = new Request(`http://localhost:5011${req.url}`, {
              method: req.method,
              headers: req.headers as Record<string, string>,
              body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
            });
            const response = await host.handler(request, {
              authenticate: () => ({ scopes: { workspace: { id: "demo" } } }),
            });
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
          };
          // Connect requires errors to be forwarded to its next callback.
          // eslint-disable-next-line promise/no-callback-in-promise
          void handle().catch(next);
        });
      },
    },
  ],
});
