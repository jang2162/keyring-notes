import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ConfigStore } from "./config.js";
import { Vault } from "./vault.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vaultDir = path.resolve(process.env.KEYRING_VAULT ?? path.join(here, "../../vault"));
const configFile = path.resolve(process.env.KEYRING_CONFIG ?? path.join(here, "../../config/keyring.json"));
const webDist = path.resolve(process.env.KEYRING_WEB_DIST ?? path.join(here, "../../web/dist"));
const host = process.env.KEYRING_HOST ?? "127.0.0.1";
const port = Number(process.env.KEYRING_PORT ?? 8787);

const config = new ConfigStore(configFile);
const vault = new Vault(vaultDir);
await vault.init();

const app = createApp({ vault, config });

if (existsSync(path.join(webDist, "index.html"))) {
  const root = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root }));
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`keyring-notes: http://${info.address}:${info.port}  (vault: ${vaultDir}, config: ${configFile})`);
  console.log(`MCP: http://${info.address}:${info.port}/mcp  (Authorization: Bearer <에이전트 토큰>)`);
  if (config.get().owner.passwordHash === null) {
    console.warn("소유자 비밀번호가 없습니다. `npm run keyring -- passwd` 로 설정하세요.");
  }
});
