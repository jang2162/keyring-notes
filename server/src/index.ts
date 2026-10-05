import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ConfigStore } from "./config.js";
import { Ingestor } from "./ingest.js";
import { NoteIndex } from "./noteindex.js";
import { Wiki } from "./wiki.js";
import { Vault } from "./vault.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vaultDir = path.resolve(process.env.KEYRING_VAULT ?? path.join(here, "../../vault"));
const configFile = path.resolve(process.env.KEYRING_CONFIG ?? path.join(here, "../../config/keyring.json"));
const webDist = path.resolve(process.env.KEYRING_WEB_DIST ?? path.join(here, "../../web/dist"));
const host = process.env.KEYRING_HOST ?? "127.0.0.1";
const port = Number(process.env.KEYRING_PORT ?? 8787);

const config = new ConfigStore(configFile);
const vault = new Vault(vaultDir);
await mkdir(vaultDir, { recursive: true });

// 인덱스는 지워도 되는 캐시다. 볼트 안 숨김 폴더에 두고 Git 추적에서는 뺀다.
const index = new NoteIndex(path.resolve(process.env.KEYRING_INDEX ?? path.join(vaultDir, ".keyring", "index.db")));
const wiki = new Wiki(vault, index);
const started = Date.now();
// 순서: 위키 토픽을 먼저 찾아 자동 생성 문서를 Git·인덱스 제외 목록에 올린 뒤 볼트를 연다.
await wiki.prepare();
await vault.init();
await wiki.init();
const synced = await index.sync(vault);
for (const t of wiki.topics) await wiki.regenerate(t);
console.log(`인덱스 동기화: ${synced.updated}개 갱신, ${synced.removed}개 제거, 위키 토픽 ${wiki.topics.size}개 (${Date.now() - started}ms)`);
// 순서가 중요하다: 인덱스를 먼저 고친 뒤 그 인덱스로 위키 index·log를 만든다.
vault.onChange((paths) => index.refresh(vault.root, paths));
vault.onChange((paths) => wiki.onChange(paths));

const ingestor = new Ingestor(vault, wiki, { allowPrivate: process.env.KEYRING_FETCH_ALLOW_PRIVATE === "1" });
const app = createApp({ vault, index, config, wiki, ingestor });

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
