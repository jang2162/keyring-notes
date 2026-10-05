import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { BackupService } from "./backup.js";
import { ConfigStore } from "./config.js";
import { Ingestor } from "./ingest.js";
import { NoteIndex } from "./noteindex.js";
import { ReviewQueue } from "./review.js";
import { Automation } from "./automation.js";
import { ScopedVault } from "./scoped.js";
import { SemanticIndex } from "./embeddings.js";
import { Wiki } from "./wiki.js";
import { Vault } from "./vault.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** 빈 값(docker compose가 설정 안 된 변수를 ""로 넘김)은 설정하지 않은 것으로 본다. */
const env = (name: string): string | undefined => process.env[name] || undefined;
// KEYRING_DATA 하나만 주면(도커의 /data) 볼트·설정·백업이 모두 그 아래에 놓인다.
const dataDir = env("KEYRING_DATA") ? path.resolve(env("KEYRING_DATA")!) : null;
const vaultDir = path.resolve(env("KEYRING_VAULT") ?? (dataDir ? path.join(dataDir, "vault") : path.join(here, "../../vault")));
const configFile = path.resolve(env("KEYRING_CONFIG") ?? (dataDir ? path.join(dataDir, "config", "keyring.json") : path.join(here, "../../config/keyring.json")));
const backupDir = path.resolve(env("KEYRING_BACKUP_DIR") ?? (dataDir ? path.join(dataDir, "backups") : path.join(here, "../../backups")));
const publicUrl = process.env.KEYRING_PUBLIC_URL?.replace(/\/+$/, "") || undefined;
const allowedHosts = (env("KEYRING_ALLOWED_HOSTS") ?? (publicUrl ? new URL(publicUrl).hostname : ""))
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
// KEYRING_UPDATE_URL="" 이면 업데이트 확인을 끈다(그래서 이것만 빈 값을 그대로 쓴다)
const updateUrl = process.env.KEYRING_UPDATE_URL ?? "https://api.github.com/repos/jang2162/keyring-notes/releases/latest";
const webDist = path.resolve(env("KEYRING_WEB_DIST") ?? path.join(here, "../../web/dist"));
const host = env("KEYRING_HOST") ?? "127.0.0.1";
const port = Number(env("KEYRING_PORT") ?? 8787);

const config = new ConfigStore(configFile);
const vault = new Vault(vaultDir);
await mkdir(vaultDir, { recursive: true });

// 인덱스는 지워도 되는 캐시다. 볼트 안 숨김 폴더에 두고 Git 추적에서는 뺀다.
const index = new NoteIndex(path.resolve(env("KEYRING_INDEX") ?? path.join(vaultDir, ".keyring", "index.db")));
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
const backups = new BackupService(vault, config, backupDir, () => wiki.resync());
if (process.env.KEYRING_BACKUP_SCHEDULER !== "0") backups.start();

// 처음 설치: 비밀번호가 없으면 일회용 설정 코드를 만들어 로그에만 보여 준다(웹에서 비밀번호 설정).
let setupCode: string | null = null;
if (config.get().owner.passwordHash === null) {
  setupCode = randomBytes(6).toString("hex").toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

const review = new ReviewQueue(vault, config);

// 의미 검색: OpenAI 호환 임베딩 엔드포인트를 설정했을 때만
const semantic =
  env("KEYRING_EMBED_URL") && env("KEYRING_EMBED_MODEL")
    ? new SemanticIndex(index, vault, { url: env("KEYRING_EMBED_URL")!, model: env("KEYRING_EMBED_MODEL")!, key: env("KEYRING_EMBED_KEY") })
    : undefined;
if (semantic) {
  vault.onChange(() => semantic.schedule());
  void semantic.sync();
  console.log(`의미 검색: ${semantic.cfg.model} (${semantic.cfg.url})`);
}
const ownerPrincipal = () => config.ownerPrincipal();
const automation = new Automation({
  vault,
  wiki,
  config,
  lint: (folder) => new ScopedVault(vault, ownerPrincipal(), index, wiki, review).lint({ folder }),
});
// 인덱스·위키 갱신 뒤에 이벤트를 보낸다
vault.onChange(() => automation.onCommit());
review.onCreate((p) =>
  automation.emit("proposal.created", {
    id: p.id,
    agent: p.agent,
    message: p.message,
    topic: p.preview[0]?.path.split("/")[0] ?? null,
    files: p.preview.map((f) => ({ path: f.path })),
  }),
);
if (process.env.KEYRING_SCHEDULER !== "0") automation.start();

const app = createApp({
  semantic,
  review,
  vault,
  index,
  config,
  wiki,
  ingestor,
  admin: { backups, publicUrl, allowedHosts, updateUrl, automation },
  setupCode: () => (config.get().owner.passwordHash === null ? setupCode : null),
});

if (existsSync(path.join(webDist, "index.html"))) {
  const root = path.relative(process.cwd(), webDist);
  app.use("/*", serveStatic({ root }));
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`keyring-notes: http://${info.address}:${info.port}  (vault: ${vaultDir}, config: ${configFile})`);
  console.log(`MCP: http://${info.address}:${info.port}/mcp  (Authorization: Bearer <에이전트 토큰>)`);
  console.log(`백업: ${backupDir}${allowedHosts.length ? ` · 허용 호스트: ${allowedHosts.join(", ")}` : ""}`);
  if (config.get().owner.passwordHash === null) {
    console.warn(`\n처음 설치: 웹 화면에서 이 설정 코드로 비밀번호를 정하세요 → ${setupCode}`);
    console.warn("(또는 `npm run keyring -- passwd`, 도커는 `docker compose exec keyring keyring passwd`)\n");
  }
});

// 도커 stop(SIGTERM)·Ctrl+C: 새 요청을 받지 않고, 진행 중인 쓰기를 마친 뒤 인덱스를 닫는다.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: 종료하는 중…`);
    backups.stop();
    automation.stop();
    server.close();
    void vault
      .maintenance(async () => index.close())
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
