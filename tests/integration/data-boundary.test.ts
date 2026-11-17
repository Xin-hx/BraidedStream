import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

describe("local dataset boundary", () => {
  it("serves public examples and blocks direct filesystem access to private records", async () => {
    const server = await createServer({
      configFile: resolve("app/vite.config.ts"), root: resolve("app"),
      server: { host: "127.0.0.1", port: 0, hmr: false },
    });
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === "string") throw new Error("Missing local test server address");
      const base = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${base}/dataset/illustration.csv`)).status).toBe(200);
      const path = resolve("examples/data/private/TCMRecord.csv");
      const response = await fetch(`${base}/dataset/TCMRecord.csv`);
      if (existsSync(path)) {
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
        expect(digest(new Uint8Array(await response.arrayBuffer()))).toBe(digest(readFileSync(path)));
      } else {
        expect(response.status).toBe(404);
      }
      if (existsSync(path)) {
        expect((await fetch(`${base}/@fs/${path.replaceAll("\\", "/")}`)).status).toBe(403);
      }
      expect((await fetch(`${base}/dataset/not-a-public-file.csv`)).status).toBe(404);
    } finally {
      await server.close();
    }
  }, 30_000);
});
