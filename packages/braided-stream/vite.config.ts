import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
export default defineConfig({
  plugins: [{
    name: "chart-styles",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "style.css", source: readFileSync(resolve(__dirname, "src/style.css")) });
    },
  }],
  build: {
    target: "es2022",
    lib: { entry: { index: resolve(__dirname, "src/index.ts"), core: resolve(__dirname, "src/core.ts") }, formats: ["es"] },
    rollupOptions: { external: ["d3"] },
  },
});
