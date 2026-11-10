/**
 * 마켓플레이스 저장소 형식의 단일 원본: 패키지 id·semver·engines·저장소 주소·패키지 파일 경로.
 * 서버·앱·CLI 가 같이 쓰므로 Node 전용 API 를 쓰지 않는다. 설계 docs/superpowers/specs/2026-11-10-marketplace-design.md 「저장소 형식」.
 */
import { PathError } from "./errors.js";

/** 위젯 ref 의 조각 꼴(`parseWidgetRef`)과 같게 둔다 — 3단계가 `@scope/name@N` 을 받을 때 그대로 쓴다. */
export const PACKAGE_ID_RE = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

/** 앱 판에 박힌 공식 저장소(정규형 — 끝 /). 사용자 결정, 설계 「설정과 잠금」. */
export const OFFICIAL_REPO_URL = "https://keyring-notes-marketplace.develma.com/";

/** 크기·시간 상한. 시간은 「요청 하나 = 첫 접속부터 마지막 리다이렉트의 본문 끝까지」 전체에 건다(홉마다면 최악이 리다이렉트 수만큼 늘어난다). */
export const MARKET_LIMITS = {
  fileBytes: 8388608,
  packageBytes: 16777216,
  indexBytes: 2097152,
  requestMs: 30000,
  indexMs: 15000,
  redirects: 5,
} as const;

export type PackageType = "widget" | "theme" | "language";
export const PACKAGE_TYPES: readonly PackageType[] = ["widget", "theme", "language"];

// ── semver ──

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

// `+build` 는 받지 않는다 — 판이 캐시·저장소 경로에 그대로 들어간다.
const NUM = "(0|[1-9][0-9]*)";
const PRE_ID = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?$`);

export function parseSemver(v: string): SemVer | null {
  if (typeof v !== "string" || v.length > 64) return null;
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  const nums = [m[1], m[2], m[3]].map(Number);
  if (!nums.every(Number.isSafeInteger)) return null;
  const pre = m[4] ? m[4].split(".").map((p) => (/^[0-9]+$/.test(p) ? Number(p) : p)) : [];
  return { major: nums[0]!, minor: nums[1]!, patch: nums[2]!, pre };
}

function cmp(a: SemVer, b: SemVer): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  // 프리릴리스가 있는 판은 없는 판보다 낮다
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** 잘못된 판은 올바른 판보다 낮다. 둘 다 잘못이면 0. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  return cmp(x, y);
}

type Comparator = { op: "=" | ">" | ">=" | "<" | "<="; v: SemVer };

function plain(major: number, minor: number, patch: number): SemVer {
  return { major, minor, patch, pre: [] };
}

/** 한 비교(`>=1.2.0`·`^1.2.0`·`1.2.0`·`*`)를 기본 비교들로. 잘못이면 null */
function comparators(token: string): Comparator[] | null {
  if (token === "*") return [];
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token)!;
  const v = parseSemver(m[2]!);
  if (!v) return null;
  const op = m[1] ?? "=";
  if (op === "^") {
    const upper = v.major > 0 ? plain(v.major + 1, 0, 0) : v.minor > 0 ? plain(0, v.minor + 1, 0) : plain(0, 0, v.patch + 1);
    return [
      { op: ">=", v },
      { op: "<", v: upper },
    ];
  }
  if (op === "~")
    return [
      { op: ">=", v },
      { op: "<", v: plain(v.major, v.minor + 1, 0) },
    ];
  return [{ op: op as Comparator["op"], v }];
}

/** `||` 로 나눈 묶음마다 빈칸으로 이은 비교(그리고). 잘못이면 null */
function parseRange(range: string): Comparator[][] | null {
  if (typeof range !== "string" || !range.trim() || range.length > 256) return null;
  const sets: Comparator[][] = [];
  for (const part of range.split("||")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const set: Comparator[] = [];
    for (const t of tokens) {
      const c = comparators(t);
      if (!c) return null;
      set.push(...c);
    }
    sets.push(set);
  }
  return sets;
}

export function validRange(range: string): boolean {
  return parseRange(range) !== null;
}

/** 범위가 잘못이거나 판이 잘못이면 false. 프리릴리스는 semver 순서로만 비교한다(npm 의 「같은 튜플만」 규칙은 두지 않는다). */
export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version);
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((set) =>
    set.every(({ op, v: w }) => {
      const c = cmp(v, w);
      return op === "=" ? c === 0 : op === ">" ? c > 0 : op === ">=" ? c >= 0 : op === "<" ? c < 0 : c <= 0;
    }),
  );
}

// ── id·주소·경로 ──

export function parsePackageId(id: string): { scope: string; name: string } | null {
  if (typeof id !== "string" || id.length > 214) return null;
  const m = PACKAGE_ID_RE.exec(id);
  return m ? { scope: m[1]!, name: m[2]! } : null;
}

/** 저장소 주소의 정규형: https(허용 시 http)·사용자/비밀번호·?·# 없음·끝 / 하나. 같은지는 이 글자로 본다. */
export function normalizeRepoUrl(url: string, opts: { allowHttp?: boolean } = {}): string {
  let u: URL;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new PathError("market_url_invalid", { url: String(url) });
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && opts.allowHttp)) throw new PathError("market_url_protocol", { url: String(url) });
  if (u.username || u.password) throw new PathError("market_url_credentials", { url: `${u.protocol}//${u.host}${u.pathname}` });
  // `?`·`#` 만 있고 값이 비면 search·hash 가 "" 라 href 로 본다
  if (!u.hostname || u.href.includes("?") || u.href.includes("#")) throw new PathError("market_url_invalid", { url: String(url) });
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}/`;
}

export function isOfficialRepo(url: string): boolean {
  try {
    return normalizeRepoUrl(url, { allowHttp: true }) === OFFICIAL_REPO_URL;
  } catch {
    return false;
  }
}

/** checkPack 의 언어 id 꼴과 같다 */
const LANG_TAG = "[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*";
const WIDGET_FILE_RE = new RegExp(`^(?:frame\\.js|frame\\.css|messages/${LANG_TAG}\\.json)$`);
export const MANIFEST_FILE = "keyring-package.json";

/** format 1 의 파일 이름(종류별) — 이 꼴만 저장소·캐시 경로에 들어간다(`..`·절대 경로·백슬래시가 들어갈 수 없다). */
export function packageFileAllowed(type: PackageType, path: string): boolean {
  if (path === MANIFEST_FILE) return true;
  if (type === "widget") return WIDGET_FILE_RE.test(path);
  if (type === "language") return path === "messages.json";
  return false;
}

function anyTypeAllows(path: string): boolean {
  return PACKAGE_TYPES.some((t) => packageFileAllowed(t, path));
}

function checkedParts(id: string, version: string): [string, string] {
  const p = parsePackageId(id);
  if (!p || !parseSemver(version)) throw new PathError("market_lock_invalid", { id: String(id) });
  return [p.scope, p.name];
}

/** `<repo>/packages/<scope>/<name>/<version>/<path>` — 저장소 안은 `@` 없는 scope */
export function packageFileUrl(repo: string, id: string, version: string, path: string): string {
  const [scope, name] = checkedParts(id, version);
  if (!anyTypeAllows(path)) throw new PathError("market_lock_invalid", { id });
  return `${repo.endsWith("/") ? repo : `${repo}/`}packages/${scope}/${name}/${version}/${path}`;
}

/** 서버·기기 캐시 안 자리: id 그대로(`@scope`, node_modules 꼴) */
export function packageCacheDir(id: string, version: string): string[] {
  const [scope, name] = checkedParts(id, version);
  return [`@${scope}`, name, version];
}
