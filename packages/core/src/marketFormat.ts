/**
 * 마켓플레이스 저장소 형식의 단일 원본: 패키지 id·semver·engines·저장소 주소·패키지 파일 경로.
 * 서버·앱·CLI 가 같이 쓰므로 Node 전용 API 를 쓰지 않는다. 설계 docs/superpowers/specs/2026-11-10-marketplace-design.md 「저장소 형식」.
 */
import { CONTRAST_MIN, contrastLabel, isThemeColor, themeContrast } from "./color.js";
import { PathError } from "./errors.js";
import { fromUtf8 } from "./hash.js";
import { checkPack } from "./i18n.js";
import { THEME_TOKENS } from "./themeTokens.js";
import { checkWidgetMessages } from "./widgetMessages.js";

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

/** `pkg check` 가 경고하는 frame.js 크기(막지는 않는다 — 상한은 MARKET_LIMITS.fileBytes) */
export const FRAME_JS_WARN_BYTES = 1048576;

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
// 프리릴리스는 소문자만: `1.0.0-Beta` 와 `1.0.0-beta` 는 semver 로는 다른 판이지만 대소문자를 가리지 않는
// 파일 시스템(macOS·Windows)에서 같은 폴더·캐시 자리가 된다.
const NUM = "(0|[1-9][0-9]*)";
const PRE_ID = "(?:0|[1-9][0-9]*|[0-9]*[a-z-][0-9a-z-]*)";
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

/** 오류 글·응답에 되돌려 줄 주소: `scheme://user:pass@` 의 자격 증명을 지운다(URL 로 읽히지 않는 글에도) */
export function redactUrl(url: string): string {
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1");
}

/** 저장소 주소의 정규형: https(허용 시 http)·사용자/비밀번호·?·# 없음·끝 / 하나. 같은지는 이 글자로 본다. */
export function normalizeRepoUrl(url: string, opts: { allowHttp?: boolean } = {}): string {
  let u: URL;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new PathError("market_url_invalid", { url: redactUrl(String(url)) });
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && opts.allowHttp)) throw new PathError("market_url_protocol", { url: redactUrl(String(url)) });
  if (u.username || u.password) throw new PathError("market_url_credentials", { url: `${u.protocol}//${u.host}${u.pathname}` });
  // `?`·`#` 만 있고 값이 비면 search·hash 가 "" 라 href 로 본다
  if (!u.hostname || u.href.includes("?") || u.href.includes("#")) throw new PathError("market_url_invalid", { url: redactUrl(String(url)) });
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

// ── index.json ──

export interface IndexFile {
  path: string;
  sha256: string;
  size: number;
}
/**
 * 판마다의 표시 필드(name·description·author·license)는 둘러보기 표시용일 뿐이다 — 설치 판정·적용은 sha256 을 확인한
 * 매니페스트가 원본이고, 둘이 다르면 설치 뒤 화면은 매니페스트를 보인다. 설계 「저장소 형식」.
 */
export interface IndexVersion {
  engines: { keyring: string };
  name?: Record<string, string>;
  description?: Record<string, string>;
  author?: string;
  license?: string;
  files: IndexFile[];
}

/** index 표시 필드의 상한(글자 수는 UTF-16 길이). 읽기(parseRepoIndex)·쓰기(pkg index)·검사(checkPackageFiles 경고)가 같이 본다 */
export const INDEX_TEXT_LIMITS = { tags: 20, name: 100, description: 500, author: 100, license: 100 } as const;

type DisplayFields = Pick<IndexVersion, "name" | "description" | "author" | "license">;

/** 언어 태그 → 비지 않은 글자(상한 안). 틀리면 이유 */
function langTextProblem(v: unknown, max: number): string | null {
  if (!isRecord(v)) return "";
  const entries = Object.entries(v);
  if (!entries.length) return "";
  if (entries.length > INDEX_TEXT_LIMITS.tags) return "";
  for (const [k, t] of entries) {
    if (!LANG_TAG_RE.test(k) || typeof t !== "string" || !t.trim()) return "";
    if (t.length > max) return `.${k}`;
  }
  return null;
}

/** index 판의 표시 필드 읽기 — 틀린 필드는 그것만 뺀다(던지지 않는다, ignored 에 세지 않는다) */
function readDisplay(raw: Record<string, unknown>): DisplayFields {
  const out: DisplayFields = {};
  for (const f of ["name", "description"] as const)
    if (raw[f] !== undefined && langTextProblem(raw[f], INDEX_TEXT_LIMITS[f]) === null) out[f] = { ...(raw[f] as Record<string, string>) };
  for (const f of ["author", "license"] as const) {
    const v = raw[f];
    // 빈 글은 보일 것이 없다 — pkg index 도 쓰지 않는다(manifestDisplay)
    if (typeof v === "string" && v.trim() && v.length <= INDEX_TEXT_LIMITS[f]) out[f] = v;
  }
  return out;
}

/**
 * 매니페스트에서 index 에 옮길 표시 필드와, 상한을 넘어 옮기지 않는 필드(`display_too_long: <필드>[.<태그>]`).
 * 넘는 필드는 자르지 않고 통째로 뺀다 — 작성자의 글을 몰래 바꾸지 않게. 매니페스트 검사 자체는 상한이 없다(이미 받은 패키지를 깨지 않게).
 */
export function manifestDisplay(m: PackageManifest): { fields: DisplayFields; tooLong: string[] } {
  const fields: DisplayFields = {};
  const tooLong: string[] = [];
  for (const f of ["name", "description"] as const) {
    const p = langTextProblem(m[f], INDEX_TEXT_LIMITS[f]);
    if (p === null) fields[f] = { ...m[f] };
    else tooLong.push(`display_too_long: ${f}${p}`);
  }
  for (const f of ["author", "license"] as const) {
    if (!m[f]) continue;
    if (m[f].length <= INDEX_TEXT_LIMITS[f]) fields[f] = m[f];
    else tooLong.push(`display_too_long: ${f}`);
  }
  return { fields, tooLong };
}

/** 언어 태그 → 글 묶음에서 보일 글: 같은 태그 → 같은 첫 조각(`ko-KR` → `ko`) → `en` → 처음 것. 없으면 null */
export function displayText(rec: Record<string, string> | undefined, lang: string): string | null {
  if (!rec) return null;
  const keys = Object.keys(rec);
  if (!keys.length) return null;
  const lower = lang.toLowerCase();
  const first = lower.split("-")[0];
  const pick =
    keys.find((k) => k.toLowerCase() === lower) ??
    keys.find((k) => k.toLowerCase() === first) ??
    keys.find((k) => k.toLowerCase().split("-")[0] === first) ??
    keys.find((k) => k.toLowerCase() === "en") ??
    keys[0]!;
  return rec[pick]!;
}
export interface RepoIndex {
  format: 1;
  name: string;
  packages: Record<string, { type: PackageType; versions: Record<string, IndexVersion> }>;
}

const SHA256_RE = /^[0-9a-f]{64}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isSha256(v: unknown): v is string {
  return typeof v === "string" && SHA256_RE.test(v);
}

/** 한 판 안의 경로 묶음 검사: 허용 꼴·겹침·대소문자만 다른 겹침(macOS·Windows 에서 같은 파일이 된다)·매니페스트. 문제면 이유, 아니면 null */
function pathsProblem(type: PackageType, paths: string[]): string | null {
  const seen = new Set<string>();
  const lower = new Set<string>();
  for (const p of paths) {
    if (!packageFileAllowed(type, p)) return `file:${p}`;
    if (seen.has(p)) return `duplicate:${p}`;
    if (lower.has(p.toLowerCase())) return `case:${p}`;
    seen.add(p);
    lower.add(p.toLowerCase());
  }
  if (!seen.has(MANIFEST_FILE)) return "no_manifest";
  return null;
}

function parseIndexVersion(type: PackageType, raw: unknown): IndexVersion | string {
  if (!isRecord(raw)) return "shape";
  const engines = raw.engines;
  if (!isRecord(engines) || typeof engines.keyring !== "string" || !validRange(engines.keyring)) return "engines";
  if (!Array.isArray(raw.files)) return "files";
  const files: IndexFile[] = [];
  let total = 0;
  for (const f of raw.files) {
    if (!isRecord(f) || typeof f.path !== "string") return "files";
    if (!isSha256(f.sha256)) return `sha256:${f.path}`;
    const size = f.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > MARKET_LIMITS.fileBytes) return `size:${f.path}`;
    total += size;
    files.push({ path: f.path, sha256: f.sha256, size });
  }
  const problem = pathsProblem(
    type,
    files.map((f) => f.path),
  );
  if (problem) return problem;
  if (total > MARKET_LIMITS.packageBytes) return "too_large";
  return { engines: { keyring: engines.keyring }, ...readDisplay(raw), files };
}

/**
 * 잘못된 패키지·판은 빼고 ignored 에 「id[@판]: 이유」. 공식이 아니면 @keyring/… 를 뺀다(개인 저장소가 공식 패키지를 같은 id 로 가리지 못하게).
 * 맨 모양이 틀리면 PathError(market_index_invalid).
 */
export function parseRepoIndex(raw: unknown, opts: { official: boolean }): { index: RepoIndex; ignored: string[] } {
  if (!isRecord(raw)) throw new PathError("market_index_invalid", { reason: "shape" });
  if (raw.format !== 1) throw new PathError("market_index_invalid", { reason: "format" });
  if (!isRecord(raw.packages)) throw new PathError("market_index_invalid", { reason: "packages" });
  const index: RepoIndex = { format: 1, name: typeof raw.name === "string" ? raw.name.slice(0, 200) : "", packages: {} };
  const ignored: string[] = [];
  for (const [id, pkg] of Object.entries(raw.packages)) {
    const pid = parsePackageId(id);
    if (!pid) {
      ignored.push(`${id}: id`);
      continue;
    }
    if (pid.scope === "keyring" && !opts.official) {
      ignored.push(`${id}: scope_reserved`);
      continue;
    }
    if (!isRecord(pkg) || !PACKAGE_TYPES.includes(pkg.type as PackageType) || !isRecord(pkg.versions)) {
      ignored.push(`${id}: shape`);
      continue;
    }
    const type = pkg.type as PackageType;
    const versions: Record<string, IndexVersion> = {};
    for (const [v, ver] of Object.entries(pkg.versions)) {
      if (!parseSemver(v)) {
        ignored.push(`${id}@${v}: version`);
        continue;
      }
      const r = parseIndexVersion(type, ver);
      if (typeof r === "string") ignored.push(`${id}@${v}: ${r}`);
      else versions[v] = r;
    }
    if (Object.keys(versions).length) index.packages[id] = { type, versions };
  }
  return { index, ignored };
}

/** engines 가 맞는 가장 높은 정식 판(프리릴리스는 「가장 높은 판」 으로 고르지 않는다 — 판을 지정하면 설치는 된다) */
export function latestVersion(index: RepoIndex, id: string, appVersion: string): string | null {
  const pkg = index.packages[id];
  if (!pkg) return null;
  let best: string | null = null;
  for (const [v, ver] of Object.entries(pkg.versions)) {
    if (parseSemver(v)?.pre.length) continue;
    if (!satisfies(appVersion, ver.engines.keyring)) continue;
    if (best === null || compareSemver(v, best) > 0) best = v;
  }
  return best;
}

// ── 매니페스트 ──

export interface PackageManifest {
  id: string;
  version: string;
  type: PackageType;
  name: Record<string, string>;
  description: Record<string, string>;
  author: string;
  license: string;
  engines: { keyring: string };
  widget?: {
    stateVersion: number;
    display: "block" | "inline";
    dataFile?: { ext: string; initial: string; name?: Record<string, string> };
    defaultState: unknown;
  };
  colors?: { light?: Record<string, string>; dark?: Record<string, string> };
}

const LANG_TAG_RE = new RegExp(`^${LANG_TAG}$`);

function invalid(reason: string): PathError {
  return new PathError("market_manifest_invalid", { reason });
}

/** 언어 태그 → 비지 않은 글자, 하나 이상 */
function langText(v: unknown, field: string): Record<string, string> {
  if (!isRecord(v)) throw invalid(field);
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) {
    if (!LANG_TAG_RE.test(k) || typeof t !== "string" || !t.trim()) throw invalid(field);
    out[k] = t;
  }
  if (!Object.keys(out).length) throw invalid(field);
  return out;
}

function parseWidget(raw: unknown): NonNullable<PackageManifest["widget"]> {
  if (!isRecord(raw)) throw invalid("widget");
  const { stateVersion, display, dataFile, defaultState, isolation } = raw;
  if (typeof stateVersion !== "number" || !Number.isSafeInteger(stateVersion) || stateVersion < 1) throw invalid("widget.stateVersion");
  if (display !== "block" && display !== "inline") throw invalid("widget.display");
  // 받은 위젯은 모두 iframe(위젯 설계 「인라인/iframe 기준」)
  if (isolation !== undefined && isolation !== "frame") throw invalid("widget.isolation");
  if (defaultState === undefined) throw invalid("widget.defaultState");
  const widget: NonNullable<PackageManifest["widget"]> = { stateVersion, display, defaultState };
  if (dataFile !== undefined) {
    // initial 이 비면 안 된다 — 서버가 빈 첨부를 거절한다
    // md 면 데이터 파일이 노트가 된다(트리·검색·동기화가 노트로 다룬다)
    if (!isRecord(dataFile) || typeof dataFile.ext !== "string" || !/^[a-z0-9]{1,16}$/.test(dataFile.ext) || dataFile.ext === "md")
      throw invalid("widget.dataFile.ext");
    if (typeof dataFile.initial !== "string" || !dataFile.initial) throw invalid("widget.dataFile.initial");
    widget.dataFile = { ext: dataFile.ext, initial: dataFile.initial };
    if (dataFile.name !== undefined) widget.dataFile.name = langText(dataFile.name, "widget.dataFile.name");
  }
  return widget;
}

/** 아니면 PathError(market_manifest_invalid, { reason }) */
export function parseManifest(raw: unknown): PackageManifest {
  if (!isRecord(raw)) throw invalid("shape");
  if (typeof raw.id !== "string" || !parsePackageId(raw.id)) throw invalid("id");
  if (typeof raw.version !== "string" || !parseSemver(raw.version)) throw invalid("version");
  if (!PACKAGE_TYPES.includes(raw.type as PackageType)) throw invalid("type");
  const type = raw.type as PackageType;
  if (typeof raw.author !== "string") throw invalid("author");
  if (typeof raw.license !== "string") throw invalid("license");
  if (!isRecord(raw.engines) || typeof raw.engines.keyring !== "string" || !validRange(raw.engines.keyring)) throw invalid("engines");
  const m: PackageManifest = {
    id: raw.id,
    version: raw.version,
    type,
    name: langText(raw.name, "name"),
    description: langText(raw.description, "description"),
    author: raw.author,
    license: raw.license,
    engines: { keyring: raw.engines.keyring },
  };
  if (type === "widget") m.widget = parseWidget(raw.widget);
  if (type === "theme") {
    const c = raw.colors;
    if (!isRecord(c) || (c.light === undefined && c.dark === undefined)) throw invalid("colors");
    const colors: NonNullable<PackageManifest["colors"]> = {};
    for (const mode of ["light", "dark"] as const) {
      if (c[mode] === undefined) continue;
      if (!isRecord(c[mode])) throw invalid(`colors.${mode}`);
      const entries = Object.entries(c[mode]);
      if (entries.some(([, v]) => typeof v !== "string")) throw invalid(`colors.${mode}`);
      colors[mode] = Object.fromEntries(entries) as Record<string, string>;
    }
    const { errors } = checkThemeColors(colors);
    if (errors.length) throw invalid(`colors: ${errors[0]}`);
    m.colors = colors;
  }
  return m;
}

// ── 테마 색 ──

// 색 값의 꼴 검사(주입을 막는 유일한 자리)는 color.ts 의 isThemeColor 다 — 이름을 지키려고 여기서도 내보낸다.
export { isThemeColor };

const TOKEN_RE = /^--[a-z][a-z0-9-]*$/;
// 테마는 색만 바꾼다(사용자 ①) — 크기·글꼴·간격 꼴은 받지 않는다
const NON_COLOR_TOKEN_RE = /^--(?:fs-|font-|radius-)|-(?:h|w)$/;

export function checkThemeColors(colors: PackageManifest["colors"], known?: readonly string[]): { errors: string[]; unknownTokens: string[] } {
  const errors: string[] = [];
  const unknown = new Set<string>();
  for (const mode of ["light", "dark"] as const) {
    for (const [token, value] of Object.entries(colors?.[mode] ?? {})) {
      if (!TOKEN_RE.test(token)) errors.push(`${mode}.${token}: name`);
      else if (NON_COLOR_TOKEN_RE.test(token)) errors.push(`${mode}.${token}: not_color_token`);
      else if (!isThemeColor(value)) errors.push(`${mode}.${token}: value`);
      else if (known && !known.includes(token)) unknown.add(token);
    }
  }
  return { errors, unknownTokens: [...unknown] };
}

// ── 파일 묶음 ──

function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(fromUtf8(bytes));
  } catch {
    throw invalid(`json:${path}`);
  }
}

/** 파일 묶음 전체 검사(CLI check·서버·앱이 받은 뒤 같이 씀): 매니페스트, 필수 파일, 허용 꼴, 종류별 내용. 아니면 PathError */
export function checkPackageFiles(
  files: Map<string, Uint8Array>,
  expect?: { id: string; version: string; type: PackageType },
): { manifest: PackageManifest; warnings: string[] } {
  const raw = files.get(MANIFEST_FILE);
  if (!raw) throw invalid("no_manifest");
  if (raw.byteLength > MARKET_LIMITS.fileBytes) throw invalid(`size:${MANIFEST_FILE}`);
  const manifest = parseManifest(parseJson(raw, MANIFEST_FILE));
  if (expect) {
    if (manifest.id !== expect.id) throw invalid("id");
    if (manifest.version !== expect.version) throw invalid("version");
    if (manifest.type !== expect.type) throw invalid("type");
  }
  const problem = pathsProblem(manifest.type, [...files.keys()]);
  if (problem) throw invalid(problem);
  let total = 0;
  for (const [p, b] of files) {
    if (b.byteLength > MARKET_LIMITS.fileBytes) throw invalid(`size:${p}`);
    total += b.byteLength;
  }
  if (total > MARKET_LIMITS.packageBytes) throw invalid("too_large");
  const warnings: string[] = [...manifestDisplay(manifest).tooLong];
  if (manifest.type === "widget") {
    const frameJs = files.get("frame.js");
    if (!frameJs) throw invalid("no_frame_js");
    // iframe 마다 코드를 postMessage 로 다시 건넨다 — 막지는 않는다
    if (frameJs.byteLength > FRAME_JS_WARN_BYTES) warnings.push(`large_frame_js: ${Math.ceil(frameJs.byteLength / 1024)}`);
    for (const [p, b] of files) {
      if (!p.startsWith("messages/")) continue;
      const msgs = parseJson(b, p);
      if (!isRecord(msgs) || Object.values(msgs).some((v) => typeof v !== "string")) throw invalid(`messages:${p}`);
      const { dropped } = checkWidgetMessages(msgs)!;
      if (dropped.length) warnings.push(`messages_dropped: ${p}: ${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? ", …" : ""}`);
    }
  }
  if (manifest.type === "language") {
    const b = files.get("messages.json");
    if (!b) throw invalid("no_messages_json");
    const r = checkPack(parseJson(b, "messages.json"), b.byteLength);
    if ("error" in r) throw invalid(`messages.json:${r.error}`);
    const { missing, unknown, placeholderMismatch, notString, htmlLike } = r.report;
    if (missing.length) warnings.push(`missing: ${missing.length}`);
    if (unknown.length) warnings.push(`unknown: ${unknown.join(", ")}`);
    if (placeholderMismatch.length) warnings.push(`placeholder: ${placeholderMismatch.join(", ")}`);
    if (notString.length) warnings.push(`not_string: ${notString.join(", ")}`);
    if (htmlLike.length) warnings.push(`html: ${htmlLike.join(", ")}`);
  }
  if (manifest.type === "theme") {
    const { unknownTokens } = checkThemeColors(manifest.colors, THEME_TOKENS);
    if (unknownTokens.length) warnings.push(`unknown_tokens: ${unknownTokens.join(", ")}`);
    // 대비는 막지 않는다(설계 「테마 토큰」) — 테마가 그리는 모드만 잰다
    for (const mode of ["light", "dark"] as const) {
      if (!manifest.colors?.[mode]) continue;
      const ratio = themeContrast(manifest.colors, mode);
      if (ratio === null || ratio < CONTRAST_MIN) warnings.push(`contrast: ${mode} ${ratio === null ? "?" : contrastLabel(ratio)}`);
    }
  }
  return { manifest, warnings };
}
