import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    plugins: [react({ compiler: true })],
    suppressWarnings: /semantics of the module level directive/i,
  },
});
