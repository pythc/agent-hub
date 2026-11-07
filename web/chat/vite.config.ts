import { configurationContent } from "./configuration-plugin.ts";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [configurationContent()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/chat-assets/",
  build: {
    outDir: "../../dist/chat",
    emptyOutDir: true,
    assetsDir: "",
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      onwarn(warning, handler) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        handler(warning);
      },
    },
  },
});
