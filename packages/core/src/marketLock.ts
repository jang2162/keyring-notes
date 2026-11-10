/**
 * 공통 설정의 `marketplace`(저장소 목록·잠금)와 그 위의 판정. 잠금이 원천이다 — 설계 docs/superpowers/specs/2026-11-10-marketplace-design.md 「설정과 잠금」.
 * settings.ts 가 이 파일을 쓴다(반대로 쓰면 순환).
 */
import {
  compareSemver,
  isOfficialRepo,
  latestVersion,
  MANIFEST_FILE,
  normalizeRepoUrl,
  OFFICIAL_REPO_URL,
  PACKAGE_TYPES,
  packageFileAllowed,
  parsePackageId,
  parseSemver,
  satisfies,
  type PackageManifest,
  type PackageType,
  type RepoIndex,
} from "./marketFormat.js";

/** sha256 의 키 = 받을 파일 전부 */
export interface LockEntry {
  version: string;
  repo: string;
  sha256: Record<string, string>;
}

export interface MarketplaceSettings {
  /** 순서가 우선순위(정규형) */
  repos: string[];
  /** 잠금 순서 그대로 */
  packages: Record<string, LockEntry>;
  /** 읽지 못한 항목 — 아무 파일도 받거나 쓰거나 지우지 않는다 */
  problems: { id: string; code: "market_lock_invalid" }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 저장소 주소를 읽어 둔다. http 도 받는다 — 허용은 받는 쪽(서버 환경 변수·앱 기기 설정)이 판정하고, 설정은 기록이다. */
function repoOf(v: unknown): string | null {
  try {
    return typeof v === "string" ? normalizeRepoUrl(v, { allowHttp: true }) : null;
  } catch {
    return null;
  }
}

/** 잠금 항목 하나. 캐시 경로에 들어가는 id·판·파일 이름을 여기서 다 거른다(Review Focus 3). */
function parseEntry(id: string, raw: unknown): LockEntry | null {
  if (!parsePackageId(id) || !isRecord(raw)) return null;
  const version = typeof raw.version === "string" ? raw.version : null;
  if (!version || !parseSemver(version)) return null;
  const repo = repoOf(raw.repo);
  if (!repo || !isRecord(raw.sha256)) return null;
  const entries = Object.entries(raw.sha256);
  if (entries.length > 64) return null;
  const sha256: Record<string, string> = {};
  for (const [path, hash] of entries) {
    if (!PACKAGE_TYPES.some((t) => packageFileAllowed(t, path))) return null;
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
    sha256[path] = hash;
  }
  if (!(MANIFEST_FILE in sha256)) return null;
  return { version, repo, sha256 };
}

/** repos 가 없을 때만 공식 하나로 시작한다(`repos: []` 는 사람이 공식을 지운 것). 잘못된 주소는 빼고, 잘못된 항목은 problems. */
export function parseMarketplace(raw: unknown): MarketplaceSettings {
  const m = isRecord(raw) ? raw : {};
  let repos: string[];
  if (!Array.isArray(m.repos)) repos = [OFFICIAL_REPO_URL];
  else {
    repos = [];
    for (const r of m.repos) {
      const url = repoOf(isRecord(r) ? r.url : r);
      if (url && !repos.includes(url)) repos.push(url);
    }
  }
  const packages: Record<string, LockEntry> = {};
  const problems: MarketplaceSettings["problems"] = [];
  for (const [id, e] of Object.entries(isRecord(m.packages) ? m.packages : {})) {
    const entry = parseEntry(id, e);
    if (entry) packages[id] = entry;
    else problems.push({ id, code: "market_lock_invalid" });
  }
  return { repos, packages, problems };
}

/** 설정 파일에 쓸 꼴(키 순서 version·repo·sha256, sha256 키 정렬 — 두 기기가 쓴 같은 항목이 같은 글이 되게) */
export function lockEntryValue(e: LockEntry): Record<string, unknown> {
  const sha256: Record<string, string> = {};
  for (const k of Object.keys(e.sha256).sort()) sha256[k] = e.sha256[k]!;
  return { version: e.version, repo: e.repo, sha256 };
}

// ── 설치 판정 ──

export interface RepoIndexResult {
  repo: string;
  index: RepoIndex | null;
  ignored: string[];
  error?: { code: string; params: Record<string, string | number> };
}

type InstallFail = { ok: false; code: "market_not_found" | "market_scope_reserved" | "market_engines"; params: Record<string, string> };

/**
 * 저장소 순서가 우선순위. 이미 잠금에 있으면 그 repo 에서만(opts.repo 로 바꿀 수 없다 — 바꾸려면 먼저 제거).
 * 판을 안 주면 latestVersion. @keyring 은 index 가 이미 걸렀어도 고른 repo 로 한 번 더 막는다.
 */
export function resolveInstall(
  indexes: RepoIndexResult[],
  lock: Record<string, LockEntry>,
  id: string,
  appVersion: string,
  opts: { version?: string; repo?: string } = {},
): { ok: true; entry: LockEntry; sizes: Record<string, number>; type: PackageType; alsoIn: string[] } | InstallFail {
  const pid = parsePackageId(id);
  if (!pid) return { ok: false, code: "market_not_found", params: { id } };
  const pinned = lock[id]?.repo ?? (opts.repo !== undefined ? repoOf(opts.repo) : null);
  if (pid.scope === "keyring" && pinned !== null && !isOfficialRepo(pinned)) return { ok: false, code: "market_scope_reserved", params: { id } };
  const having = indexes.filter((r) => r.index?.packages[id] && (pid.scope !== "keyring" || isOfficialRepo(r.repo)));
  const chosen = pinned === null ? having[0] : having.find((r) => repoOf(r.repo) === pinned);
  if (!chosen) return { ok: false, code: "market_not_found", params: { id } };
  const pkg = chosen.index!.packages[id]!;
  let version = opts.version;
  if (version === undefined) {
    version = latestVersion(chosen.index!, id, appVersion) ?? undefined;
    if (version === undefined) {
      // 판은 있는데 이 앱에 맞는 것이 없다 — 가장 높은 판의 범위를 알린다
      const top = Object.keys(pkg.versions).sort(compareSemver).pop()!;
      return { ok: false, code: "market_engines", params: { range: pkg.versions[top]!.engines.keyring, version: appVersion } };
    }
  }
  const ver = pkg.versions[version];
  if (!ver) return { ok: false, code: "market_not_found", params: { id, version } };
  if (!satisfies(appVersion, ver.engines.keyring)) return { ok: false, code: "market_engines", params: { range: ver.engines.keyring, version: appVersion } };
  return {
    ok: true,
    entry: { version, repo: repoOf(chosen.repo) ?? chosen.repo, sha256: Object.fromEntries(ver.files.map((f) => [f.path, f.sha256])) },
    sizes: Object.fromEntries(ver.files.map((f) => [f.path, f.size])),
    type: pkg.type,
    alsoIn: having.filter((r) => r !== chosen).map((r) => r.repo),
  };
}

export interface CachedVersion {
  id: string;
  version: string;
  sha256: Record<string, string>;
}

const sameHashes = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** 잠금 ↔ 캐시: 받을 것(없거나 sha 가 다름), 지울 것(잠금에 없는 id·판) */
export function planCache(
  lock: Record<string, LockEntry>,
  cached: CachedVersion[],
): { fetch: { id: string; entry: LockEntry }[]; remove: { id: string; version: string }[] } {
  const fetch: { id: string; entry: LockEntry }[] = [];
  for (const [id, entry] of Object.entries(lock)) {
    const have = cached.find((c) => c.id === id && c.version === entry.version);
    if (!have || !sameHashes(have.sha256, entry.sha256)) fetch.push({ id, entry });
  }
  const remove = cached.filter((c) => lock[c.id]?.version !== c.version).map((c) => ({ id: c.id, version: c.version }));
  return { fetch, remove };
}

export function enginesOk(manifest: Pick<PackageManifest, "engines">, appVersion: string): boolean {
  return satisfies(appVersion, manifest.engines.keyring);
}
