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
    rollupOptions: { input: resolve(__dirname, "index.html") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
