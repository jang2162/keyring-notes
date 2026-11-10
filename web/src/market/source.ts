import {
  checkPackageFiles,
  isOfficialRepo,
  KeyedError,
  MARKET_LIMITS,
  normalizeRepoUrl,
  packageFileUrl,
  parsePackageId,
  parseRepoIndex,
  sha256Hex,
  type LockEntry,
  type RepoIndexResult,
} from "@keyring-notes/core";
import { marketClient, MarketHttpError } from "./client";

/**
 * 마켓 패키지를 「누가 받는가」 — 설계 docs/superpowers/specs/2026-11-10-marketplace-design.md 「모드별로 누가 받는가」 표.
 * 화면은 저장소에 직접 요청하지 않는다(CSP connect-src 'self'): 서버가 받거나(서버 API) 앱이 네이티브로 받는다(market_fetch).
 * 어느 쪽이 받았든 화면이 sha256 을 다시 잰다.
 */
export type MarketMode = "server" | "app" | "app+sync" | "browser+sync" | "browser";

export function marketMode(env: { local: boolean; kind: "app" | "browser" | null; sync: boolean }): MarketMode {
  if (!env.local) return "server";
  if (env.kind === "app") return env.sync ? "app+sync" : "app";
  return env.sync ? "browser+sync" : "browser";
}

export interface PackageSource {
  /** fresh: 서버 쪽은 캐시를 건너뛰게 묻고, 네이티브는 캐시가 없어 늘 새로 받는다 */
  index(repo: string, opts?: { fresh?: boolean }): Promise<RepoIndexResult>;
  /** 잠금 항목의 파일을 다 받아 sha256·크기 확인을 마친 묶음. 실패는 KeyedError(market_* 코드) */
  fetch(id: string, entry: LockEntry, sizes?: Record<string, number>): Promise<Map<string, Uint8Array>>;
}

function errorOf(e: unknown): { code: string; params: Record<string, string | number> } {
  if (e instanceof KeyedError) return { code: e.code, params: e.params as Record<string, string | number> };
  return { code: "market_fetch_failed", params: { reason: e instanceof Error ? e.name : "network" } };
}

async function checkHashes(entry: LockEntry, files: Map<string, Uint8Array>): Promise<void> {
  for (const [p, sha] of Object.entries(entry.sha256)) {
    const b = files.get(p);
    if (!b || (await sha256Hex(b)) !== sha) throw new KeyedError("market_hash_mismatch", { path: p });
  }
}

export function serverSource(base: string, fetchFn: typeof fetch, token?: string): PackageSource {
  const api = marketClient(base, fetchFn, token);
  return {
    index: (repo, opts) => api.index(repo, opts),
    async fetch(id, entry, sizes) {
      await api.ensure(id, entry, sizes);
      const files = new Map<string, Uint8Array>();
      for (const p of Object.keys(entry.sha256).sort()) files.set(p, await api.file(id, entry.version, p, entry.sha256[p]!));
      await checkHashes(entry, files);
      return files;
    },
  };
}

type InvokeFn = (cmd: string, args: unknown) => Promise<ArrayBuffer>;

const defaultInvoke: InvokeFn = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ArrayBuffer>(cmd, args as Record<string, unknown>);
};

/** Rust market_fetch 의 오류 글("code" 또는 "market_fetch_failed:<이유>")을 KeyedError 로 */
function nativeError(e: unknown, path?: string): KeyedError {
  if (typeof e !== "string") return e instanceof KeyedError ? e : new KeyedError("market_fetch_failed", { reason: "invoke" });
  const [code, reason] = e.split(":");
  if (code === "market_size_mismatch" && path) return new KeyedError(code, { path });
  return new KeyedError(code || "market_fetch_failed", reason ? { reason } : {});
}

/** 앱(Tauri)의 네이티브 받기. http·사설 주소는 그 기기 설정으로만 */
export function nativeSource(device: { allowHttp: boolean; allowPrivate: boolean }, invokeFn: InvokeFn = defaultInvoke): PackageSource {
  const get = async (url: string, maxBytes: number, timeoutMs: number, expectSize?: number, path?: string) => {
    try {
      return new Uint8Array(
        await invokeFn("market_fetch", {
          url,
          maxBytes,
          expectSize: expectSize ?? null,
          allowHttp: device.allowHttp,
          allowPrivate: device.allowPrivate,
          timeoutMs,
        }),
      );
    } catch (e) {
      throw nativeError(e, path);
    }
  };
  return {
    async index(input) {
      let repo: string;
      try {
        repo = normalizeRepoUrl(input, { allowHttp: device.allowHttp });
      } catch (e) {
        return { repo: input, index: null, ignored: [], error: errorOf(e) };
      }
      try {
        const bytes = await get(`${repo}index.json`, MARKET_LIMITS.indexBytes, MARKET_LIMITS.indexMs);
        let raw: unknown;
        try {
          raw = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new KeyedError("market_index_invalid", { reason: "json" });
        }
        const { index, ignored } = parseRepoIndex(raw, { official: isOfficialRepo(repo) });
        return { repo, index, ignored };
      } catch (e) {
        return { repo, index: null, ignored: [], error: errorOf(e) };
      }
    },
    async fetch(id, entry, sizes) {
      // 서버가 하는 확인을 앱이 같이 한다(marketCache.ts fetchVersion)
      if (parsePackageId(id)?.scope === "keyring" && !isOfficialRepo(entry.repo)) throw new KeyedError("market_scope_reserved", { id });
      const repo = normalizeRepoUrl(entry.repo, { allowHttp: device.allowHttp });
      const paths = Object.keys(entry.sha256).sort();
      if (sizes && paths.reduce((n, p) => n + (sizes[p] ?? 0), 0) > MARKET_LIMITS.packageBytes) throw new KeyedError("market_too_large");
      const files = new Map<string, Uint8Array>();
      let total = 0;
      for (const p of paths) {
        const b = await get(
          packageFileUrl(repo, id, entry.version, p),
          Math.min(MARKET_LIMITS.fileBytes, MARKET_LIMITS.packageBytes - total),
          MARKET_LIMITS.requestMs,
          sizes?.[p],
          p,
        );
        total += b.byteLength;
        if ((await sha256Hex(b)) !== entry.sha256[p]) throw new KeyedError("market_hash_mismatch", { path: p });
        files.set(p, b);
      }
      const { manifest } = checkPackageFiles(files);
      if (manifest.id !== id || manifest.version !== entry.version)
        throw new KeyedError("market_manifest_invalid", { reason: manifest.id !== id ? "id" : "version" });
      return files;
    },
  };
}

/** 서버가 실패했을 때 앱이 대신 받는 오류 — 길의 문제. 파일 자체의 문제(sha·크기·매니페스트·없음·@keyring)는 다른 길로 받아도 같다 */
const FALLBACK = new Set([
  "market_private_address",
  "market_fetch_failed",
  "market_url_protocol",
  "market_timeout",
  "market_too_many_redirects",
  "device_unauthorized",
  "login_required",
]);

function shouldFallback(e: unknown): boolean {
  if (e instanceof TypeError) return true; // 서버에 닿지 못함
  if (e instanceof MarketHttpError && e.status === 401) return true;
  if (e instanceof KeyedError) return FALLBACK.has(e.code);
  return (e as { status?: number })?.status === 401;
}

export function fallbackSource(primary: PackageSource, secondary: PackageSource): PackageSource {
  return {
    async index(repo, opts) {
      try {
        const r = await primary.index(repo, opts);
        if (r.error && FALLBACK.has(r.error.code)) return secondary.index(repo, opts);
        return r;
      } catch (e) {
        if (shouldFallback(e)) return secondary.index(repo, opts);
        throw e;
      }
    },
    async fetch(id, entry, sizes) {
      try {
        return await primary.fetch(id, entry, sizes);
      } catch (e) {
        if (shouldFallback(e)) return secondary.fetch(id, entry, sizes);
        throw e;
      }
    },
  };
}

export interface SourceDeps {
  server?: { base: string; fetchFn: typeof fetch; token?: string };
  device: { allowHttp: boolean; allowPrivate: boolean };
  /** 시험용 */
  invokeFn?: InvokeFn;
}

/** 표대로 고른다. 브라우저 기기 볼트에 동기화가 없으면 받는 쪽이 없다(null) */
export function pickSource(mode: MarketMode, deps: SourceDeps): PackageSource | null {
  const server = deps.server ? serverSource(deps.server.base, deps.server.fetchFn, deps.server.token) : null;
  const native = () => nativeSource(deps.device, deps.invokeFn);
  switch (mode) {
    case "server":
      return server ?? serverSource("", (...a) => fetch(...a));
    case "app":
      return native();
    case "app+sync":
      return server ? fallbackSource(server, native()) : native();
    case "browser+sync":
      return server;
    case "browser":
      return null;
  }
}

const DEVICE_KEY = "keyring:market:device";

/** 마켓 화면의 「이 기기」(Tauri 앱만). 쓰기 실패는 조용히 — 읽는 쪽이 둘 다 false 로 본다 */
export function writeDeviceMarketSettings(v: { allowHttp: boolean; allowPrivate: boolean }): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ allowHttp: v.allowHttp, allowPrivate: v.allowPrivate }));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

/** 이 기기에서만(동기화되지 않음) 켜는 http·사설 주소 허용. 고치는 화면은 마켓 화면의 「이 기기」 */
export function readDeviceMarketSettings(): { allowHttp: boolean; allowPrivate: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "{}") as { allowHttp?: unknown; allowPrivate?: unknown };
    return { allowHttp: v?.allowHttp === true, allowPrivate: v?.allowPrivate === true };
  } catch {
    return { allowHttp: false, allowPrivate: false };
  }
}
