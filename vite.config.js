import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        research: fileURLToPath(new URL("research.html", import.meta.url)),
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:4198" } },
});
