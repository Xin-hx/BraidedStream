import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: { __LOCAL_TCM__: true },
  test: {
    include: ["app/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
