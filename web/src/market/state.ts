import {
  enginesOk,
  KeyedError,
  MANIFEST_FILE,
  parseManifest,
  planCache,
  resolveInstall,
  sha256Hex,
  type LockEntry,
  type MarketplaceSettings,
  type PackageManifest,
  type PackageType,
  type RepoIndexResult,
} from "@keyring-notes/core";
import type { PackageCache } from "./cache";
import type { PackageSource } from "./source";

/**
 * 이 기기의 마켓 상태. 잠금(공통 설정 marketplace.packages)이 원천이다 — 설치 화면을 거치지 않은 변경(손으로 고침·동기화)도
 * 잠금이 바뀔 때마다 기기 캐시를 맞춘다(없는 것은 받고, 잠금에 없는 판은 바로 지운다). 오프라인이면 캐시에 있는 것을 쓴다.
 * 2·3단계는 registerPackageKind 로 종류별 적용자를 걸고, readPackageFile 로 바이트를 읽는다.
 */
export interface InstalledPackage {
  id: string;
  /** 잠금 항목을 읽지 못했으면(market_lock_invalid) 종류를 모른다 */
  type: PackageType | null;
  version: string;
  repo: string;
  manifest: PackageManifest | null;
  status: "ready" | "fetching" | "error" | "incompatible";
  error?: { code: string; params: Record<string, string | number> };
}

export interface MarketState {
  installedPackages(): InstalledPackage[];
  readPackageFile(id: string, path: string): Promise<Uint8Array>;
  readPackageText(id: string, path: string): Promise<string>;
  /** 지금 잠금 항목(없으면 null) — 위젯 적용자가 그 순간의 판·sha 를 붙잡는다 */
  lockEntry(id: string): LockEntry | null;
  /** 지금 잠금이 entry 와 판·repo·sha256 묶음이 모두 같을 때만 readPackageFile 처럼 읽는다. 다르면 market_stale */
  readPackageFileAt(id: string, entry: LockEntry, path: string): Promise<Uint8Array>;
  readPackageTextAt(id: string, entry: LockEntry, path: string): Promise<string>;
  onPackagesChange(fn: () => void): () => void;
  registerPackageKind(type: PackageType, applier: { apply(pkgs: InstalledPackage[]): void | Promise<void> }): () => void;
  /** fresh: 마켓 화면을 열 때·「새로 고침」(서버 캐시를 건너뜀). 그 밖의 길(설치 판정)은 캐시 */
  repoIndexes(opts?: { fresh?: boolean }): Promise<RepoIndexResult[]>;
  installPackage(id: string, opts?: { version?: string; repo?: string }): Promise<InstalledPackage>;
  uninstallPackage(id: string): Promise<void>;
  marketAvailability(): "ok" | "unavailable";
  reconcile(): Promise<void>;
  /**
   * 공통 설정(잠금)을 읽고 첫 맞추기를 마쳤는가(한 번 참이면 계속 참). 거짓인 동안 적용자가 받는 빈 목록은 「아직 모름」 이라
   * 테마·언어 적용자는 시작 캐시를 지우지 않는다 — 오프라인에서 이미 깐 것이 사라지지 않게.
   */
  ready(): boolean;
}

export interface MarketDeps {
  /** 지금 받는 쪽(모드·동기화 연결에 따라 바뀐다). null = 받지 않는다 */
  source: () => PackageSource | null;
  cache: PackageCache;
  /** 공통 설정의 marketplace. 읽지 못했으면(깨짐·아직 모름) null — 그때는 아무것도 지우지 않는다 */
  settings: () => MarketplaceSettings | null;
  onSettings(fn: () => void): () => void;
  writeLock(id: string, entry: LockEntry | null): Promise<void>;
  appVersion: string;
}

function errorOf(e: unknown): { code: string; params: Record<string, string | number> } {
  if (e instanceof KeyedError) return { code: e.code, params: e.params as Record<string, string | number> };
  return { code: "market_fetch_failed", params: { reason: e instanceof Error ? e.name : "network" } };
}

export function createMarketState(deps: MarketDeps): MarketState {
  let installed: InstalledPackage[] = [];
  const listeners = new Set<() => void>();
  const appliers = new Map<PackageType, Set<{ apply(pkgs: InstalledPackage[]): void | Promise<void> }>>();
  let running: Promise<void> | null = null;
  let again = false;
  let isReady = false;

  const notify = async () => {
    for (const [type, set] of appliers) {
      const pkgs = installed.filter((p) => p.type === type && p.status === "ready");
      for (const a of set) await Promise.resolve(a.apply(pkgs)).catch((e: unknown) => console.warn(`market apply ${type}:`, e));
    }
    for (const l of listeners) l();
  };

  const manifestOf = async (id: string, version: string): Promise<PackageManifest | null> => {
    const b = await deps.cache.get(id, version, MANIFEST_FILE);
    if (!b) return null;
    try {
      return parseManifest(JSON.parse(new TextDecoder().decode(b)));
    } catch {
      return null;
    }
  };

  const describe = async (id: string, entry: LockEntry, error?: { code: string; params: Record<string, string | number> }): Promise<InstalledPackage> => {
    const manifest = error ? null : await manifestOf(id, entry.version);
    const base = { id, version: entry.version, repo: entry.repo, manifest, type: manifest?.type ?? null };
    if (error) return { ...base, status: "error", error };
    if (!manifest) return { ...base, status: "error", error: { code: "market_manifest_invalid", params: { reason: "cache" } } };
    // engines 가 맞지 않으면 그 기기에서만 쓰지 않는다 — 잠금은 바꾸지 않는다(다른 기기의 판을 끌어내리지 않는다)
    return { ...base, status: enginesOk(manifest, deps.appVersion) ? "ready" : "incompatible" };
  };

  const reconcileOnce = async () => {
    const s = deps.settings();
    if (!s) return;
    const source = deps.source();
    const cached = await deps.cache.list();
    const plan = planCache(s.packages, cached);
    const next: InstalledPackage[] = [];
    for (const [id, entry] of Object.entries(s.packages)) {
      if (!plan.fetch.some((f) => f.id === id)) {
        next.push(await describe(id, entry));
        continue;
      }
      if (!source) {
        next.push(await describe(id, entry, { code: "market_unavailable", params: {} }));
        continue;
      }
      try {
        const files = await source.fetch(id, entry);
        await deps.cache.put(id, entry.version, entry, files);
        next.push(await describe(id, entry));
      } catch (e) {
        next.push(await describe(id, entry, errorOf(e)));
      }
    }
    for (const p of s.problems)
      next.push({ id: p.id, type: null, version: "", repo: "", manifest: null, status: "error", error: { code: p.code, params: { id: p.id } } });
    // 기기 캐시는 잠금을 읽은 뒤에만, 잠금에 없는 판을 바로 지운다(받지 못한 것과 상관없이 — 정리는 캐시만 본다)
    for (const r of plan.remove) await deps.cache.remove(r.id, r.version);
    installed = next;
    // notify 앞에 세운다 — 적용자는 notify 안에서 불리므로, 뒤에 세우면 첫 맞추기 결과를 받은 적용자가 거짓을 보고 돌아간다
    isReady = true;
    await notify();
  };

  /** 한 번에 하나. 돌고 있으면 끝난 뒤 한 번 더 */
  const reconcile = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await reconcileOnce();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  deps.onSettings(() => void reconcile());

  const lockedEntry = (id: string): LockEntry => {
    const e = deps.settings()?.packages[id];
    if (!e) throw new KeyedError("market_not_found", { id });
    return e;
  };

  const state: MarketState = {
    installedPackages: () => installed,
    async readPackageFile(id, path) {
      const p = installed.find((x) => x.id === id);
      if (!p || p.status !== "ready") throw new KeyedError("market_not_found", { id });
      const entry = lockedEntry(id);
      const sha = entry.sha256[path];
      const b = sha ? await deps.cache.get(id, entry.version, path) : null;
      if (!b) throw new KeyedError("market_not_found", { id });
      if ((await sha256Hex(b)) !== sha) {
        // 캐시가 상했다 — 그 판을 버려 다음 맞추기가 다시 받게 하고 지금은 쓰지 않는다
        await deps.cache.remove(id, entry.version);
        installed = installed.map((x) => (x.id === id ? { ...x, status: "error", error: { code: "market_hash_mismatch", params: { path } } } : x));
        await notify();
        throw new KeyedError("market_hash_mismatch", { path });
      }
      return b;
    },
    async readPackageText(id, path) {
      return new TextDecoder().decode(await state.readPackageFile(id, path));
    },
    lockEntry: (id) => deps.settings()?.packages[id] ?? null,
    readPackageFileAt(id, entry, path) {
      const now = deps.settings()?.packages[id];
      const sameEntry =
        !!now &&
        now.version === entry.version &&
        now.repo === entry.repo &&
        Object.keys(now.sha256).length === Object.keys(entry.sha256).length &&
        Object.entries(entry.sha256).every(([p, h]) => now.sha256[p] === h);
      // 잠금이 바뀌었다 — 붙잡은 판의 정의·메시지에 다른 판의 코드를 싣지 않는다
      if (!sameEntry) return Promise.reject(new KeyedError("market_stale", { id }));
      return state.readPackageFile(id, path);
    },
    async readPackageTextAt(id, entry, path) {
      return new TextDecoder().decode(await state.readPackageFileAt(id, entry, path));
    },
    onPackagesChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    registerPackageKind(type, applier) {
      const set = appliers.get(type) ?? new Set();
      set.add(applier);
      appliers.set(type, set);
      void Promise.resolve(applier.apply(installed.filter((p) => p.type === type && p.status === "ready"))).catch(() => undefined);
      return () => set.delete(applier);
    },
    async repoIndexes(opts) {
      const s = deps.settings();
      const source = deps.source();
      if (!s) return [];
      return Promise.all(
        s.repos.map((repo) =>
          source
            ? source.index(repo, opts).catch((e: unknown) => ({ repo, index: null, ignored: [], error: errorOf(e) }))
            : { repo, index: null, ignored: [], error: { code: "market_unavailable", params: {} } },
        ),
      );
    },
    async installPackage(id, opts) {
      const source = deps.source();
      if (!source) throw new KeyedError("market_unavailable");
      const s = deps.settings();
      if (!s) throw new KeyedError("market_unavailable");
      const r = resolveInstall(await state.repoIndexes(), s.packages, id, deps.appVersion, opts);
      if (!r.ok) throw new KeyedError(r.code, r.params);
      // 잠금을 쓰기 전에 받는다 — 받지 못한 패키지는 잠금에 들어가지 않는다
      const files = await source.fetch(id, r.entry, r.sizes);
      await deps.cache.put(id, r.entry.version, r.entry, files);
      await deps.writeLock(id, r.entry);
      await reconcile();
      return installed.find((p) => p.id === id) ?? (await describe(id, r.entry));
    },
    async uninstallPackage(id) {
      await deps.writeLock(id, null);
      for (const c of await deps.cache.list()) if (c.id === id) await deps.cache.remove(c.id, c.version);
      await reconcile();
    },
    marketAvailability: () => (deps.source() ? "ok" : "unavailable"),
    reconcile,
    ready: () => isReady,
  };
  return state;
}
