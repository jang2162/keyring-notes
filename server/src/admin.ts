import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { isLevel, type Level } from "./access.js";
import { parseCron, type Automation } from "./automation.js";
import type { BackupService } from "./backup.js";
import { randomBytes } from "node:crypto";
import { AGENT_NAME_RE, SESSION_COOKIE, validateBackupSettings, validateJobs, validateWebhooks, WEBHOOK_EVENTS, type ConfigStore, type WebhookConfig } from "./config.js";
import type { NoteIndex } from "./noteindex.js";
import { PathError } from "./paths.js";
import type { ScopedVault } from "./scoped.js";
import { ForbiddenError, NotFoundError, type Vault } from "./vault.js";
import { APP_VERSION } from "./version.js";
import type { Wiki } from "./wiki.js";
import type { BlobStore } from "./blobs.js";
import type { S3Client } from "./s3.js";

export interface AdminDeps {
  vault: Vault;
  index: NoteIndex;
  wiki: Wiki;
  config: ConfigStore;
  backups: BackupService;
  /** 쿠키 Secure 판단 등에 쓰는 공개 주소(예: https://notes.example.com) */
  publicUrl?: string;
  allowedHosts?: string[];
  /** 업데이트 확인 주소(GitHub releases/latest 형식의 JSON). 빈 문자열이면 확인하지 않는다. */
  updateUrl?: string;
  /** 업로드로 복원할 백업 파일 최대 크기(바이트) */
  maxBackupUpload?: number;
  /** 웹훅·정기 작업 */
  automation?: Automation;
  /** S3(설정했을 때): 원격 백업 */
  s3?: S3Client | null;
  /** S3 첨부 보관(KEYRING_S3_BLOBS=1) */
  blobs?: BlobStore | null;
}

const startedAt = new Date();

async function dirSize(dir: string, skip: (name: string) => boolean): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (skip(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        bytes += (await stat(p).catch(() => ({ size: 0 }))).size;
        files++;
      }
    }
  };
  await walk(dir);
  return { bytes, files };
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

let updateCache: { at: number; value: unknown } | null = null;

/** /api/admin/* — 소유자만. 인증 미들웨어 뒤에 붙는다. */
export function adminRoutes(deps: AdminDeps) {
  const { vault, index, wiki, config, backups } = deps;
  const admin = new Hono<{ Variables: { scoped: ScopedVault } }>();

  admin.use("*", async (c, next) => {
    const p = c.var.scoped.principal;
    if (p.kind !== "owner") throw new ForbiddenError("관리 콘솔은 소유자만 쓸 수 있습니다");
    if (p.device) throw new ForbiddenError("앱(기기 토큰)으로는 관리 콘솔을 쓸 수 없습니다. 웹에서 로그인하세요");
    await next();
  });

  // ── 서버 상태 ──
  admin.get("/status", async (c) => {
    const docs = index.docs();
    const vaultSize = await dirSize(vault.root, (n) => n === ".history" || n === ".keyring");
    const historySize = await dirSize(path.join(vault.root, ".history"), () => false);
    const indexSize = await dirSize(path.join(vault.root, ".keyring"), () => false);
    const fs = await statfs(vault.root).catch(() => null);
    const head = await vault.git.head();
    const last = head ? (await vault.git.log(undefined, 1))[0] : null;
    const commits = head ? Number((await vault.git.raw(["rev-list", "--count", "HEAD"])).stdout.trim()) : 0;
    const list = await backups.list();
    const cfg = config.get();
    return c.json({
      app: { version: APP_VERSION, node: process.version, startedAt: startedAt.toISOString(), uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) },
      vault: {
        path: vault.root,
        documents: docs.length,
        files: vaultSize.files,
        bytes: vaultSize.bytes,
        topics: (await readdir(vault.root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).length,
        wikiTopics: [...wiki.topics],
      },
      history: { commits, bytes: historySize.bytes, last: last ? { author: last.author, date: last.date, message: last.message } : null },
      index: { documents: docs.length, bytes: indexSize.bytes },
      disk: fs ? { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize } : null,
      backups: {
        dir: backups.dir,
        count: list.length,
        last: list[0] ?? null,
        next: await backups.nextScheduled(),
        settings: cfg.backup,
        lastError: backups.lastError,
      },
      agents: cfg.agents.map((a) => ({ name: a.name, lastUsed: config.lastUsed.get(a.name)?.toISOString() ?? null })),
      storage: {
        s3: deps.s3 ? deps.s3.describe() : null,
        remoteBackups: deps.s3 ? { enabled: cfg.backup.remote, encrypted: backups.crypto !== null, lastUpload: backups.lastRemoteUpload, lastError: backups.lastRemoteError } : null,
        blobs: deps.blobs ? deps.blobs.status() : null,
      },
      security: {
        https: new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https",
        publicUrl: deps.publicUrl ?? null,
        allowedHosts: deps.allowedHosts ?? null,
      },
    });
  });

  // ── 업데이트 확인 ──
  admin.get("/update", async (c) => {
    const url = deps.updateUrl;
    const base = {
      current: APP_VERSION,
      instructions: {
        docker: "docker compose pull && docker compose up -d   # 직접 빌드했다면: git pull && docker compose up -d --build",
        source: "git pull && npm ci && npm run build && (서버 재시작)",
      },
    };
    if (!url) return c.json({ ...base, latest: null, checked: false, error: "업데이트 확인 주소가 꺼져 있습니다(KEYRING_UPDATE_URL)" });
    if (updateCache && Date.now() - updateCache.at < 3600_000 && c.req.query("force") !== "1") {
      return c.json({ ...base, ...(updateCache.value as object) });
    }
    let value: Record<string, unknown>;
    try {
      const res = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "keyring-notes" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tag_name?: string; html_url?: string; published_at?: string; body?: string };
      if (!data.tag_name) throw new Error("버전 정보가 없습니다");
      value = {
        latest: data.tag_name.replace(/^v/, ""),
        url: data.html_url ?? null,
        publishedAt: data.published_at ?? null,
        notes: (data.body ?? "").slice(0, 4000),
        updateAvailable: compareVersions(data.tag_name, APP_VERSION) > 0,
        checked: true,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      value = { latest: null, checked: false, error: `업데이트 확인 실패: ${e instanceof Error ? e.message : e}` };
    }
    updateCache = { at: Date.now(), value };
    return c.json({ ...base, ...value });
  });

  // ── 에이전트 토큰·권한 ──
  // ── 기기(데스크톱·모바일 앱) ──
  admin.get("/devices", (c) =>
    c.json({
      devices: config.get().devices.map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        lastUsed: config.lastUsed.get(`device:${d.id}`)?.toISOString() ?? null,
      })),
    }),
  );
  admin.delete("/devices/:id", (c) => {
    const id = c.req.param("id");
    if (!config.get().devices.some((d) => d.id === id)) throw new NotFoundError(`기기가 없습니다: ${id}`);
    config.removeDevice(id);
    return c.json({ ok: true });
  });

  admin.get("/agents", (c) => {
    const cfg = config.get();
    return c.json({
      agents: cfg.agents.map((a) => ({
        name: a.name,
        createdAt: a.createdAt,
        rules: a.rules,
        lastUsed: config.lastUsed.get(a.name)?.toISOString() ?? null,
      })),
    });
  });

  admin.post("/agents", async (c) => {
    const { name } = await c.req.json();
    if (typeof name !== "string" || !AGENT_NAME_RE.test(name)) throw new PathError("에이전트 이름은 영문 소문자·숫자·-·_ 로 64자 이내여야 합니다");
    if (config.get().agents.some((a) => a.name === name)) throw new PathError(`이미 있는 에이전트입니다: ${name}`);
    return c.json({ name, token: config.issueToken(name) });
  });

  const agentName = (n: string) => {
    if (!config.get().agents.some((a) => a.name === n)) throw new NotFoundError(`에이전트가 없습니다: ${n}`);
    return n;
  };

  admin.post("/agents/:name/rotate", (c) => {
    const name = agentName(c.req.param("name"));
    return c.json({ name, token: config.issueToken(name) });
  });

  admin.put("/agents/:name/rules", async (c) => {
    const name = agentName(c.req.param("name"));
    const { rules } = await c.req.json();
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new PathError("rules는 {경로: 권한} 객체여야 합니다");
    for (const v of Object.values(rules)) if (!isLevel(v)) throw new PathError(`권한 값이 잘못되었습니다: ${String(v)}`);
    try {
      config.setRules(name, rules as Record<string, Level>);
    } catch (e) {
      throw new PathError(e instanceof Error ? e.message : String(e));
    }
    return c.json({ name, rules: config.get().agents.find((a) => a.name === name)!.rules });
  });

  admin.delete("/agents/:name", (c) => {
    const name = agentName(c.req.param("name"));
    config.removeAgent(name);
    config.lastUsed.delete(name);
    return c.json({ ok: true });
  });

  // ── 비밀번호 변경 ──
  admin.post("/password", async (c) => {
    const { current, next } = await c.req.json();
    if (typeof current !== "string" || !config.checkPassword(current)) throw new ForbiddenError("현재 비밀번호가 맞지 않습니다");
    if (typeof next !== "string" || next.length < 8) throw new PathError("새 비밀번호는 8자 이상이어야 합니다");
    config.setPassword(next);
    // 다른 기기의 세션은 모두 끊고, 지금 쓰는 브라우저에는 새 세션을 준다.
    const s = config.issueSession();
    setCookie(c, SESSION_COOKIE, s.value, {
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https" || (deps.publicUrl ?? "").startsWith("https:"),
      path: "/",
      maxAge: s.maxAge,
    });
    return c.json({ ok: true });
  });

  // ── 자동화: 웹훅·정기 작업 ──
  const automation = () => {
    if (!deps.automation) throw new PathError("자동화가 꺼져 있습니다");
    return deps.automation;
  };
  const maskSecret = (w: WebhookConfig) => ({ ...w, secret: `${w.secret.slice(0, 4)}…` });

  admin.get("/automation", (c) => {
    const a = automation();
    const cfg = config.get();
    return c.json({
      events: WEBHOOK_EVENTS,
      webhooks: cfg.webhooks.map(maskSecret),
      jobs: cfg.jobs.map((j) => a.jobStatus(j)),
      deliveries: a.deliveries.slice(0, 50),
    });
  });

  // 웹훅 목록 통째로 저장. secret을 비워 보내면 같은 id의 기존 값을 쓰고, 새 웹훅이면 만들어 준다(응답에 한 번만 원문).
  admin.put("/automation/webhooks", async (c) => {
    const { webhooks } = await c.req.json();
    if (!Array.isArray(webhooks)) throw new PathError("webhooks 목록이 필요합니다");
    const prev = new Map(config.get().webhooks.map((w) => [w.id, w]));
    const created: Record<string, string> = {};
    const merged = webhooks.map((w: Partial<WebhookConfig>) => {
      let secret = typeof w.secret === "string" && w.secret && !w.secret.endsWith("…") ? w.secret : prev.get(String(w.id))?.secret;
      if (!secret) {
        secret = randomBytes(24).toString("base64url");
        created[String(w.id)] = secret;
      }
      return { ...w, secret };
    });
    let valid;
    try {
      valid = validateWebhooks(merged);
    } catch (e) {
      throw new PathError(e instanceof Error ? e.message : String(e));
    }
    config.update((cfg) => {
      cfg.webhooks = valid;
    });
    return c.json({ webhooks: valid.map(maskSecret), newSecrets: created });
  });

  admin.put("/automation/jobs", async (c) => {
    const { jobs } = await c.req.json();
    let valid;
    try {
      valid = validateJobs(jobs, (expr) => void parseCron(expr));
      const hooks = new Set(config.get().webhooks.map((w) => w.id));
      for (const j of valid) if (!hooks.has(j.webhook)) throw new Error(`${j.id}: 없는 웹훅입니다(${j.webhook})`);
    } catch (e) {
      throw new PathError(e instanceof Error ? e.message : String(e));
    }
    config.update((cfg) => {
      cfg.jobs = valid;
    });
    return c.json({ jobs: valid.map((j) => automation().jobStatus(j)) });
  });

  admin.post("/automation/webhooks/:id/test", async (c) => {
    const w = config.get().webhooks.find((x) => x.id === c.req.param("id"));
    if (!w) throw new NotFoundError("웹훅이 없습니다");
    const a = automation();
    a.emit("ping", { message: "Keyring Notes 웹훅 시험" }, [w]);
    await a.idle();
    return c.json(a.deliveries.find((d) => d.webhook === w.id && d.event === "ping"));
  });

  admin.post("/automation/jobs/:id/run", async (c) => {
    const job = config.get().jobs.find((x) => x.id === c.req.param("id"));
    if (!job) throw new NotFoundError("작업이 없습니다");
    const d = await automation().runJob(job);
    return c.json({ delivery: d, job: automation().jobStatus(job) });
  });

  // ── 백업·복원 ──
  admin.get("/backups", async (c) => c.json({ backups: await backups.list(), settings: config.get().backup }));

  admin.post("/backups", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const includeConfig = typeof body.includeConfig === "boolean" ? body.includeConfig : undefined;
    return c.json(await backups.create("manual", { includeConfig }));
  });

  admin.put("/backups/settings", async (c) => {
    const body = await c.req.json();
    let settings;
    try {
      settings = validateBackupSettings({ ...config.get().backup, ...body });
    } catch (e) {
      throw new PathError(e instanceof Error ? e.message : String(e));
    }
    config.update((cfg) => {
      cfg.backup = settings;
    });
    void backups.prune();
    return c.json({ settings });
  });

  // ── S3 원격 백업 ──
  admin.get("/backups/remote", async (c) => {
    if (!deps.s3) return c.json({ configured: false, backups: [] });
    try {
      return c.json({ configured: true, location: deps.s3.describe(), backups: await backups.listRemote(), lastError: backups.lastRemoteError });
    } catch (e) {
      return c.json({ configured: true, location: deps.s3.describe(), backups: [], lastError: e instanceof Error ? e.message : String(e) });
    }
  });
  admin.post("/backups/remote/:name/fetch", async (c) => c.json(await backups.fetchRemote(c.req.param("name"))));
  admin.post("/backups/:name/push", async (c) => {
    await backups.pushRemote(c.req.param("name"));
    return c.json({ ok: true });
  });

  admin.get("/backups/:name", async (c) => {
    const name = c.req.param("name");
    const file = await backups.file(name);
    const size = (await stat(file)).size;
    return new Response(Readable.toWeb(backups.stream(file)) as ReadableStream, {
      headers: {
        "content-type": "application/gzip",
        "content-length": String(size),
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  });

  admin.delete("/backups/:name", async (c) => {
    await backups.remove(c.req.param("name"));
    return c.json({ ok: true });
  });

  // 다른 서버에서 받은 백업 파일 올리기(원본 바이트, x-keyring-upload 헤더 필요). 디스크로 바로 흘려 쓴다.
  admin.post("/backups/upload", async (c) => {
    const max = deps.maxBackupUpload ?? 4 * 1024 ** 3;
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > max) throw new PathError("백업 파일이 너무 큽니다");
    const body = c.req.raw.body;
    if (!body) throw new PathError("빈 파일입니다");
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "keyring-upload-"));
    const tmp = path.join(tmpDir, "upload.tar.gz");
    try {
      let total = 0;
      const counted = Readable.fromWeb(body as never).on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > max) counted.destroy(new PathError("백업 파일이 너무 큽니다"));
      });
      await pipeline(counted, createWriteStream(tmp, { mode: 0o600 }));
      return c.json(await backups.importFile(tmp));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  admin.post("/backups/:name/restore", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await backups.restore(c.req.param("name"), { restoreConfig: body.restoreConfig === true });
    return c.json(result);
  });

  return admin;
}
