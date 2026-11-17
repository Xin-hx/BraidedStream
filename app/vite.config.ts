import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dataDir = resolve(__dirname, "../examples/data");
const publicDatasets = ["illustration.csv", "covid_inc_case_trained_members.json"];

export default defineConfig(({ command }) => ({
  plugins: [vue(), {
    name: "example-datasets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const filename = request.url?.split("?")[0]?.replace(/^\/dataset\//, "");
        if (!request.url?.startsWith("/dataset/")) return next();
        if (filename === "TCMRecord.csv" && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) {
          response.statusCode = 403; response.end("Local access only"); return;
        }
        const path = filename === "TCMRecord.csv" ? resolve(dataDir, "private/TCMRecord.csv")
          : publicDatasets.includes(filename ?? "") ? resolve(dataDir, filename!) : undefined;
        if (!path || !existsSync(path)) { response.statusCode = 404; response.end("Dataset not available locally"); return; }
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", filename?.endsWith(".json") ? "application/json" : "text/csv; charset=utf-8");
        response.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const filename of publicDatasets) {
        this.emitFile({ type: "asset", fileName: `dataset/${filename}`, source: readFileSync(resolve(dataDir, filename)) });
      }
    },
  }],
  // Development reads package sources for HMR; production uses the built package exports.
  resolve: { alias: command === "serve" ? [
    { find: "braided-stream/core", replacement: resolve(__dirname, "../packages/braided-stream/src/core.ts") },
    { find: "braided-stream/style.css", replacement: resolve(__dirname, "../packages/braided-stream/src/style.css") },
    { find: /^braided-stream$/, replacement: resolve(__dirname, "../packages/braided-stream/src/index.ts") },
  ] : [] },
  define: { __LOCAL_TCM__: command === "serve" && existsSync(resolve(dataDir, "private/TCMRecord.csv")) },
  server: {
    fs: { deny: ["**/examples/data/private/**", "**/TCMRecord.csv", "**/artifacts/**", ".env", ".env.*", "*.{crt,pem}", "**/.git/**"] },
  },
  build: { target: "es2022" },
}));
