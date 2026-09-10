/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        compare: resolve(__dirname, "compare.html"),
        "compare-braided": resolve(__dirname, "compare-braided.html"),
        "compare-zhou-glare": resolve(__dirname, "compare-zhou-glare.html"),
        "compare-twist": resolve(__dirname, "compare-twist.html"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
