import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename as fsRename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  checkPackageFiles,
  isOfficialRepo,
  KeyedError,
  MARKET_LIMITS,
  normalizeRepoUrl,
  NotFoundError,
  PACKAGE_TYPES,
  packageCacheDir,
  packageFileAllowed,
  packageFileUrl,
  parseMarketplace,
  parsePackageId,
  parseRepoIndex,
  parseVaultSettings,
  PathError,
  planCache,
  redactUrl,
  settingsObject,
  sha256Hex,
  VAULT_SETTINGS_PATH,
  type CachedVersion,
  type LockEntry,
  type MarketplaceSettings,
  type RepoIndexResult,
} from "@keyring-notes/core";
import { marketFetch } from "./marketFetch.js";
import { resolveInVault } from "./paths.js";
import type { Vault } from "./vault.js";

/**
 * 서버의 패키지 캐시: `<root>/@scope/name/<version>/<파일들>` + 같은 폴더의 `.keyring-cache.json`.
 * 메타는 sha256·크기·매니페스트 검사를 모두 지난 뒤에만 쓴다 — 메타가 있는 폴더 = 확인을 마친 바이트.
 * 잠금이 원천이다: 시작할 때와 공통 설정 파일이 커밋될 때마다 reconcile 로 맞춘다(attachMarketReconcile).
 */

const META = ".keyring-cache.json";

interface Meta {
  id: string;
  version: string;
  repo: string;
  sha256: Record<string, string>;
  /** 마지막으로 받은 시각(ms). 잠금에 없는 판을 지울 때의 유예 기준 */
  at: number;
}

export interface MarketCacheOptions {
  root: string;
  allowHttp: boolean;
  allowPrivate: boolean;
  fetch?: typeof marketFetch;
  now?: () => number;
  /** 잠금에 없는 캐시를 지우기 전 유예(기본 24시간) — 기기 볼트 + 동기화 기기가 받게 한 뒤 잠금이 동기화로 오기 전에 지우지 않게 */
  graceMs?: number;
  /** index.json 캐시(기본 5분) */
  indexTtlMs?: number;
  /** index.json 실패를 다시 묻지 않는 시간(기본 30초) */
  failTtlMs?: number;
  /** 시험용: 이름 바꾸기(교체 도중 멈춤을 흉내 낸다) */
  rename?: (from: string, to: string) => Promise<void>;
}

type Status = { state: "ready" | "fetching" | "error"; version: string; error?: { code: string; params: Record<string, string | number> } };

function errorOf(e: unknown): { code: string; params: Record<string, string | number> } {
  if (e instanceof KeyedError) return { code: e.code, params: e.params as Record<string, string | number> };
  return { code: "market_fetch_failed", params: { reason: e instanceof Error ? e.message : String(e) } };
}

function sameHashes(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

export class MarketCache {
  private readonly fetch: typeof marketFetch;
  private readonly now: () => number;
  private readonly rename: (from: string, to: string) => Promise<void>;
  private readonly ready: Promise<void>;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly indexes = new Map<string, { at: number; result: RepoIndexResult }>();
  private readonly states = new Map<string, Status>();
  /** 마지막 reconcile 의 잠금. status 는 잠금의 패키지만 보인다(null 이면 아직 모름) */
  private lock: Record<string, LockEntry> | null = null;
  /** 바이트를 잠금 sha 로 다시 잰 판 폴더 → 그때의 메타 at. read 가 불일치를 보면 지운다 */
  private readonly verified = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: MarketCacheOptions) {
    this.fetch = opts.fetch ?? marketFetch;
    this.now = opts.now ?? Date.now;
    this.rename = opts.rename ?? fsRename;
    this.ready = this.recover();
  }

  // ── 경로 ──

  /** 검사를 지난 id·판 조각으로만 잇고, 이은 뒤 루트 밖이면 거부 */
  private versionDir(id: string, version: string): string {
    return resolveInVault(this.opts.root, path.join(...packageCacheDir(id, version)));
  }

  /** 링크로 루트 밖을 가리키면 null */
  private async insideRoot(abs: string): Promise<boolean> {
    try {
      const [r, a] = await Promise.all([realpath(this.opts.root), realpath(abs)]);
      const rel = path.relative(r, a);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    } catch {
      return false;
    }
  }

  /**
   * 폴더의 파일이 메타의 sha256 그대로인가. 캐시를 「있다」 고 보는 모든 길(빠른 길·시작 정리·맞추기)이 거친다 —
   * 메타만 보면 확인 뒤 쓰기가 끊겼거나 디스크에서 바뀐 판이 ready 로 남은 채 영원히 404 가 된다.
   * 경로 중간의 링크도 거부한다(실제 경로가 폴더 아래 그 이름 그대로여야 한다).
   */
  private async verifyDir(dir: string, meta: Meta, memo = true): Promise<boolean> {
    if (memo && this.verified.get(dir) === meta.at) return true;
    try {
      if (!(await this.insideRoot(dir))) return false;
      const real = await realpath(dir);
      for (const [p, sha] of Object.entries(meta.sha256)) {
        if (!PACKAGE_TYPES.some((t) => packageFileAllowed(t, p))) return false;
        const abs = resolveInVault(dir, p);
        if ((await realpath(abs)) !== path.join(real, p)) return false;
        if (!(await lstat(abs)).isFile()) return false;
        if ((await sha256Hex(new Uint8Array(await readFile(abs)))) !== sha) return false;
      }
    } catch {
      return false;
    }
    if (memo) this.verified.set(dir, meta.at);
    return true;
  }

  /** 잠금에 있는 그 판(같은 sha)일 때만 status 를 바꾼다 — 잠금에 없는 id 나 다른 판을 받게 한 ensure 가 잠금의 상태를 덮지 않게 */
  private setState(id: string, entry: LockEntry, s: Status): void {
    const locked = this.lock?.[id];
    if (!locked || locked.version !== entry.version || !sameHashes(locked.sha256, entry.sha256)) return;
    this.states.set(id, s);
  }

  private async readMeta(dir: string): Promise<Meta | null> {
    try {
      const m = JSON.parse(await readFile(path.join(dir, META), "utf8")) as Meta;
      return m && typeof m.id === "string" && typeof m.version === "string" && m.sha256 && typeof m.at === "number" ? m : null;
    } catch {
      return null;
    }
  }

  /**
   * 시작 정리. 교체는 ① 판 → .old ② .tmp → 판 ③ .old 삭제 순서라, 멈춘 자리에 따라 둘이 남는다.
   * 메타가 있는 .tmp 는 확인을 마친 판이라 판 폴더가 비어 있으면 그것을 놓는다(지우면 서버가 오프라인일 때 한 판을 잃는다).
   * 그래도 판 폴더가 없으면 .old 를 되돌리고, 나머지는 지운다.
   */
  private async recover(): Promise<void> {
    await mkdir(this.opts.root, { recursive: true });
    const names = (await readdir(this.opts.root)).filter((n) => n.startsWith(".tmp-") || n.startsWith(".old-"));
    const order = [...names.filter((n) => n.startsWith(".tmp-")), ...names.filter((n) => n.startsWith(".old-"))];
    for (const n of order) {
      const dir = path.join(this.opts.root, n);
      const meta = await this.readMeta(dir);
      // 메타가 있어도 바이트를 다시 잰다 — 확인 뒤 쓰기가 끊긴 .tmp 를 놓으면 그 판은 스스로 낫지 않는다
      if (meta && (await this.verifyDir(dir, meta, false))) {
        try {
          const target = this.versionDir(meta.id, meta.version);
          if (!(await this.exists(target))) {
            await mkdir(path.dirname(target), { recursive: true });
            await fsRename(dir, target);
            continue;
          }
        } catch {
          /* 메타가 틀렸다 — 지운다 */
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await lstat(p);
      return true;
    } catch {
      return false;
    }
  }

  // ── 받기 ──

  /** 잠금 항목 하나를 캐시에 둔다(이미 같은 sha 면 바로). 같은 id@판은 한 번만 돈다. sizes 가 있으면 expectSize */
  async ensure(id: string, entry: LockEntry, sizes?: Record<string, number>): Promise<void> {
    await this.ready;
    // API 로 들어온 항목도 설정 파일에서 읽은 항목과 같은 검사를 지난다(id·판·파일 이름·해시 꼴)
    const parsed = parseMarketplace({ repos: [], packages: { [id]: entry } });
    const clean = parsed.packages[id];
    if (!clean) throw new PathError("market_lock_invalid", { id: String(id) });
    const key = `${id}@${clean.version}`;
    for (;;) {
      const running = this.inflight.get(key);
      if (!running) break;
      await running.catch(() => undefined);
    }
    const job = this.fetchVersion(id, clean, sizes);
    this.inflight.set(key, job);
    try {
      await job;
    } finally {
      if (this.inflight.get(key) === job) this.inflight.delete(key);
    }
  }

  private async fetchVersion(id: string, entry: LockEntry, sizes?: Record<string, number>): Promise<void> {
    const dir = this.versionDir(id, entry.version);
    const have = await this.readMeta(dir);
    if (have && have.repo === entry.repo && sameHashes(have.sha256, entry.sha256) && (await this.verifyDir(dir, have))) {
      this.setState(id, entry, { state: "ready", version: entry.version });
      return;
    }
    this.setState(id, entry, { state: "fetching", version: entry.version });
    const tmp = path.join(this.opts.root, `.tmp-${randomBytes(6).toString("hex")}`);
    try {
      if (parsePackageId(id)!.scope === "keyring" && !isOfficialRepo(entry.repo)) throw new PathError("market_scope_reserved", { id });
      const repo = normalizeRepoUrl(entry.repo, { allowHttp: this.opts.allowHttp });
      const paths = Object.keys(entry.sha256).sort();
      if (sizes && paths.reduce((n, p) => n + (sizes[p] ?? 0), 0) > MARKET_LIMITS.packageBytes) throw new PathError("market_too_large");
      await mkdir(tmp, { recursive: true });
      const files = new Map<string, Uint8Array>();
      let total = 0;
      for (const p of paths) {
        let bytes: Uint8Array;
        try {
          bytes = await this.fetch(packageFileUrl(repo, id, entry.version, p), {
            allowHttp: this.opts.allowHttp,
            allowPrivate: this.opts.allowPrivate,
            maxBytes: Math.min(MARKET_LIMITS.fileBytes, MARKET_LIMITS.packageBytes - total),
            timeoutMs: MARKET_LIMITS.requestMs,
            expectSize: sizes?.[p],
          });
        } catch (e) {
          if (e instanceof PathError && e.code === "market_size_mismatch") throw new PathError("market_size_mismatch", { path: p });
          throw e;
        }
        total += bytes.byteLength;
        if (total > MARKET_LIMITS.packageBytes) throw new PathError("market_too_large");
        if ((await sha256Hex(bytes)) !== entry.sha256[p]) throw new PathError("market_hash_mismatch", { path: p });
        files.set(p, bytes);
        await mkdir(path.dirname(path.join(tmp, p)), { recursive: true });
        await writeFile(path.join(tmp, p), bytes);
      }
      const { manifest } = checkPackageFiles(files);
      if (manifest.id !== id) throw new PathError("market_manifest_invalid", { reason: "id" });
      if (manifest.version !== entry.version) throw new PathError("market_manifest_invalid", { reason: "version" });
      const meta: Meta = { id, version: entry.version, repo: entry.repo, sha256: entry.sha256, at: this.now() };
      await writeFile(path.join(tmp, META), JSON.stringify(meta));
      await this.place(tmp, dir);
      this.verified.set(dir, meta.at);
      this.setState(id, entry, { state: "ready", version: entry.version });
    } catch (e) {
      if (!(e as { keepTmp?: boolean }).keepTmp) await rm(tmp, { recursive: true, force: true });
      this.setState(id, entry, { state: "error", version: entry.version, error: errorOf(e) });
      throw e;
    }
  }

  /**
   * 놓기: ① 판 → .old ② .tmp → 판 ③ .old 삭제. 비지 않은 폴더 위로의 디렉터리 rename 은 POSIX 에서 ENOTEMPTY 라
   * 덮어 놓을 수 없다. ①과 ② 사이에는 판 폴더가 없어 read 는 NotFound — 틀린 바이트를 내는 순간은 없다.
   * 세 이름은 모두 root 아래, 같은 파일 시스템이라 rename 이 원자적이다.
   */
  private async place(tmp: string, dir: string): Promise<void> {
    await mkdir(path.dirname(dir), { recursive: true });
    let old: string | null = null;
    if (await this.exists(dir)) {
      old = path.join(this.opts.root, `.old-${randomBytes(6).toString("hex")}`);
      await this.rename(dir, old);
    }
    try {
      await this.rename(tmp, dir);
    } catch (e) {
      let reverted = true;
      if (old) await this.rename(old, dir).catch(() => (reverted = false));
      // 되돌리기도 실패하면(멈춤과 같다) 확인을 마친 .tmp 를 남긴다 — 다음 시작 정리(recover)가 판 폴더에 놓는다
      throw Object.assign(e as Error, { keepTmp: !reverted });
    }
    if (old) await rm(old, { recursive: true, force: true });
  }

  /** 잠금의 sha 와 캐시 메타가 같을 때만 바이트. 아니면 NotFoundError(market_not_found) */
  async read(id: string, version: string, file: string, sha256: string): Promise<Uint8Array> {
    await this.ready;
    const dir = this.versionDir(id, version);
    if (!PACKAGE_TYPES.some((t) => packageFileAllowed(t, file))) throw new PathError("market_lock_invalid", { id });
    const missing = () => new NotFoundError("market_not_found", { id });
    if (!(await this.insideRoot(dir))) throw missing();
    const meta = await this.readMeta(dir);
    if (!meta || meta.id !== id || meta.version !== version || meta.sha256[file] !== sha256) throw missing();
    const abs = resolveInVault(dir, file);
    try {
      // 판 폴더 안쪽 링크(messages -> 밖)도 따라가지 않는다
      if ((await realpath(abs)) !== path.join(await realpath(dir), file)) throw missing();
      const st = await lstat(abs);
      if (!st.isFile()) throw missing();
      const bytes = new Uint8Array(await readFile(abs));
      // 메타는 놓을 때 확인한 값이다 — 그 뒤 디스크에서 바뀐 바이트는 내지 않고, 다음 맞추기가 다시 받게 한다
      if ((await sha256Hex(bytes)) !== sha256) {
        this.verified.delete(dir);
        const entry = this.lock?.[id];
        if (entry) this.setState(id, entry, { state: "error", version, error: { code: "market_hash_mismatch", params: { path: file } } });
        throw missing();
      }
      return bytes;
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      throw missing();
    }
  }

  // ── 저장소 목록 ──

  async index(repoInput: string): Promise<RepoIndexResult> {
    let repo: string;
    try {
      repo = normalizeRepoUrl(repoInput, { allowHttp: this.opts.allowHttp });
    } catch (e) {
      return { repo: redactUrl(String(repoInput)), index: null, ignored: [], error: errorOf(e) };
    }
    const hit = this.indexes.get(repo);
    const ttl = (r: RepoIndexResult) => (r.error ? (this.opts.failTtlMs ?? 30_000) : (this.opts.indexTtlMs ?? 5 * 60_000));
    if (hit && this.now() - hit.at < ttl(hit.result)) return hit.result;
    let result: RepoIndexResult;
    try {
      const bytes = await this.fetch(`${repo}index.json`, {
        allowHttp: this.opts.allowHttp,
        allowPrivate: this.opts.allowPrivate,
        maxBytes: MARKET_LIMITS.indexBytes,
        timeoutMs: MARKET_LIMITS.indexMs,
      });
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new PathError("market_index_invalid", { reason: "json" });
      }
      const { index, ignored } = parseRepoIndex(raw, { official: isOfficialRepo(repo) });
      result = { repo, index, ignored };
    } catch (e) {
      result = { repo, index: null, ignored: [], error: errorOf(e) };
    }
    this.indexes.set(repo, { at: this.now(), result });
    return result;
  }

  // ── 잠금 맞추기 ──

  private async scan(): Promise<(CachedVersion & { dir: string; at: number })[]> {
    const out: (CachedVersion & { dir: string; at: number })[] = [];
    const root = this.opts.root;
    const dirs = async (p: string) => (await readdir(p, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith("."));
    for (const s of await dirs(root)) {
      for (const n of await dirs(path.join(root, s.name))) {
        for (const v of await dirs(path.join(root, s.name, n.name))) {
          const dir = path.join(root, s.name, n.name, v.name);
          const id = `${s.name}/${n.name}`;
          const meta = await this.readMeta(dir);
          // 바이트가 상한 판은 「없는 것」 으로 — planCache 가 다시 받는다
          const ok = meta !== null && (await this.verifyDir(dir, meta));
          out.push({ id, version: v.name, sha256: ok ? meta.sha256 : {}, dir, at: meta?.at ?? 0 });
        }
      }
    }
    return out;
  }

  /** null(공통 설정을 읽지 못함)이면 아무것도 지우지 않는다 */
  reconcile(settings: MarketplaceSettings | null): Promise<void> {
    const run = this.queue.then(() => this.reconcileNow(settings));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async reconcileNow(settings: MarketplaceSettings | null): Promise<void> {
    await this.ready;
    if (!settings) return;
    this.lock = settings.packages;
    const cached = await this.scan();
    const plan = planCache(settings.packages, cached);
    for (const { id, entry } of plan.fetch) await this.ensure(id, entry).catch(() => undefined);
    for (const id of Object.keys(settings.packages)) {
      if (plan.fetch.some((f) => f.id === id)) continue;
      this.states.set(id, { state: "ready", version: settings.packages[id]!.version });
    }
    for (const r of plan.remove) {
      const c = cached.find((x) => x.id === r.id && x.version === r.version)!;
      if (this.now() - c.at <= (this.opts.graceMs ?? 24 * 3600_000)) continue;
      await rm(c.dir, { recursive: true, force: true });
      // 비게 된 이름·범위 폴더도 지운다
      for (const up of [path.dirname(c.dir), path.dirname(path.dirname(c.dir))]) await rmdir(up).catch(() => undefined);
    }
    // 읽지 못한 항목도 보인다 — 받지도 지우지도 않는다
    const bad = new Set(settings.problems.map((p) => p.id));
    for (const p of settings.problems) this.states.set(p.id, { state: "error", version: "", error: { code: p.code, params: { id: p.id } } });
    for (const id of this.states.keys()) if (!(id in settings.packages) && !bad.has(id)) this.states.delete(id);
  }

  status(): Record<string, Status> {
    return Object.fromEntries(this.states);
  }
}

/** 공통 설정 파일의 marketplace. 파일이 없으면 기본(빈 잠금), 깨졌으면 null */
async function readMarketplace(vault: Vault): Promise<MarketplaceSettings | null> {
  let content: string | null = null;
  try {
    content = (await vault.read(VAULT_SETTINGS_PATH)).content;
  } catch (e) {
    if (!(e instanceof NotFoundError)) return null;
  }
  if (content !== null && settingsObject(content) === null) return null;
  return parseVaultSettings(content).marketplace;
}

/** 시작 때 한 번, 그리고 공통 설정 파일이 든 커밋마다 reconcile. 맞추기는 뒤에서 — 커밋 큐를 막지 않는다 */
export function attachMarketReconcile(vault: Vault, cache: MarketCache): Promise<void> {
  const run = () =>
    readMarketplace(vault)
      .then((s) => cache.reconcile(s))
      .catch((e: unknown) => console.warn(`market reconcile: ${e instanceof Error ? e.message : String(e)}`));
  vault.onChange((paths) => {
    if (paths.includes(VAULT_SETTINGS_PATH)) void run();
  });
  return run();
}
