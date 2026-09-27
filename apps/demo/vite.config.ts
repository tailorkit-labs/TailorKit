import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";
import type { Plugin, ViteDevServer } from "vite-plus";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

function demoSyncPlugin(): Plugin {
  const channels = new Map<string, Set<WebSocket>>();

  function broadcast(channel: string, payload: string, sender?: WebSocket) {
    for (const socket of channels.get(channel) ?? []) {
      if (socket === sender || socket.readyState !== socket.OPEN) {
        continue;
      }
      socket.send(payload);
    }
  }

  function remove(socket: WebSocket) {
    for (const sockets of channels.values()) {
      sockets.delete(socket);
    }
  }

  return {
    name: "demo-sync-websocket",
    configureServer(server: ViteDevServer) {
      return () => {
        const httpServer = server.httpServer;
        if (!httpServer) {
          return;
        }

        const websocketServer = new WebSocketServer({ noServer: true });
        websocketServer.on("connection", (socket, request) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          const channel = url.searchParams.get("channel") || "default";
          let sockets = channels.get(channel);
          if (!sockets) {
            sockets = new Set();
            channels.set(channel, sockets);
          }
          sockets.add(socket);

          socket.on("message", (message) => {
            broadcast(channel, message.toString(), socket);
          });
          socket.on("close", () => remove(socket));
          socket.on("error", () => remove(socket));
        });

        const viteUpgradeListeners = httpServer.listeners("upgrade");
        httpServer.removeAllListeners("upgrade");
        httpServer.on("upgrade", (request, socket, head) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (url.pathname !== "/tailorkit-demo-sync") {
            for (const listener of viteUpgradeListeners) {
              listener.call(httpServer, request, socket, head);
            }
            return;
          }

          websocketServer.handleUpgrade(request, socket, head, (websocket) => {
            websocketServer.emit("connection", websocket, request);
          });
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [demoSyncPlugin(), tailwindcss(), tanstackStart(), viteReact()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    port: 3000,
  },
  preview: {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
});
