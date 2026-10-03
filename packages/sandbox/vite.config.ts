import { iframeRuntimePlugin } from "./iframe-plugin.ts";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [iframeRuntimePlugin()],
  build: {
    lib: {
      formats: ["es"],
      entry: {
        host: resolve(import.meta.dirname, "src/host/index.ts"),
        protocol: resolve(import.meta.dirname, "src/protocol.ts"),
      },
      name: "@tailorkit/sandbox",
    },
    rolldownOptions: {
      external: [],
    },
  },
});
