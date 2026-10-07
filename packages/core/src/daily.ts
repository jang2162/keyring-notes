import { parseFrontmatter } from "./markdown.js";
import { setFrontmatterField } from "./frontmatter.js";
import { vaultText, type VaultLang } from "./vaultText.js";

/**
 * 날짜 형식과 데일리 노트 판정. 웹·앱·서버(링크 해석·위젯·정리 점검)가 같은 규칙을 쓴다.
 *
 * 날짜 토큰: YYYY YY GGGG(주 기준 연도) M MM MMMM(월 이름) D DD W WW(주차) H HH m mm s ss ddd(요일) dddd(요일 긴 이름) [글자]
 * 월·요일 이름은 볼트 언어를 따른다(한국어: 10월·수·수요일, 영어: October·Wed·Wednesday). 볼트에 남는 글이라 화면 언어가 아니다.
 * 주차는 주 시작 요일이 월요일이면 ISO 8601(목요일이 든 해의 주), 일요일이면 같은 규칙을 일요일 시작 주에 적용한다
 * (그 주의 수요일이 든 해·주. 주의 나흘 이상이 새해에 있으면 1주차).
 */
export type WeekStart = "monday" | "sunday";

export interface DateFormatOptions {
  /** 주 시작 요일(기본 월요일, ISO) */
  weekStart?: WeekStart;
  /** 볼트 언어(월·요일 이름). 기본 영어 */
  lang?: VaultLang;
}

/** 형식 검사 결과(화면이 번역한다) */
export interface FormatProblem {
  code: "empty" | "noYear" | "noMonth" | "noDay" | "emptySegment" | "dotSegment" | "dotStart" | "badChar";
  segment?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 하루 단위 날짜 계산은 UTC로 한다(서머타임으로 하루가 23·25시간인 날에도 어긋나지 않게) */
const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 86400_000;

/** 주차와 주 기준 연도. 월요일 시작이면 ISO 8601과 같다(2026-12-31·2027-01-01 → 2026-W53, 2027-01-04 → 2027-W01). */
export function weekOf(d: Date, weekStart: WeekStart = "monday"): { year: number; week: number } {
  const start = weekStart === "sunday" ? 0 : 1;
  const day = utcDay(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (d.getDay() - start + 7) % 7;
  // 그 주의 가운데 날(월요일 시작이면 목요일)이 든 해가 주 기준 연도
  const mid = new Date((day - offset + 3) * 86400_000);
  const year = mid.getUTCFullYear();
  const week = Math.floor((day - offset + 3 - utcDay(year, 0, 1)) / 7) + 1;
  return { year, week };
}

const TOKEN_RE = /YYYY|GGGG|YY|MMMM|MM|M|WW|W|DD|D|HH|H|mm|m|ss|s|dddd|ddd|\[([^\]]*)\]/g;

export function formatDate(d: Date, format: string, opts: DateFormatOptions = {}): string {
  const t = vaultText(opts.lang);
  let wk: { year: number; week: number } | null = null;
  const week = () => (wk ??= weekOf(d, opts.weekStart));
  return format.replace(TOKEN_RE, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit; // [글자]는 그대로
    switch (tok) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return String(d.getFullYear()).slice(-2);
      case "GGGG":
        return String(week().year);
      case "MMMM":
        return t.months[d.getMonth()];
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "WW":
        return pad(week().week);
      case "W":
        return String(week().week);
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "HH":
        return pad(d.getHours());
      case "H":
        return String(d.getHours());
      case "mm":
        return pad(d.getMinutes());
      case "m":
        return String(d.getMinutes());
      case "ss":
        return pad(d.getSeconds());
      case "s":
        return String(d.getSeconds());
      case "dddd":
        return t.weekdaysLong[d.getDay()];
      case "ddd":
        return t.weekdaysShort[d.getDay()];
    }
    return tok;
  });
}

export function shiftDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** YYYY-MM-DD(이 기기 시간대 기준) */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-07" → 그날 0시(이 기기 시간대). 없는 날짜면 null */
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** 데일리 노트 설정(모든 기기 공통 설정 파일의 워크스페이스 묶음에서 온다) */
export interface DailyConfig {
  /** 볼트 기준 폴더(워크스페이스 포함, 예: 개인/일기) */
  folder: string;
  /** 파일 이름 형식(/가 있으면 하위 폴더, 예: YYYY/MM/YYYY-MM-DD) */
  format: string;
  weekStart?: WeekStart;
  /** 볼트 언어(월·요일 이름 토큰) */
  lang?: VaultLang;
}

/**
 * 워크스페이스별 데일리 설정. 경로의 워크스페이스로 그 설정을 고른다(꺼져 있으면 null).
 * 링크 해석(`[[2026-10-07]]`)은 링크를 쓴 문서의 워크스페이스 것을 먼저 본다.
 */
export interface DailyLookup {
  /** 그 워크스페이스의 데일리 설정(꺼져 있으면 null) */
  of(workspace: string | null): DailyConfig | null;
  /** 켜진 워크스페이스 설정 전부 */
  all(): { workspace: string; config: DailyConfig }[];
}

/** 워크스페이스 하나에만 데일리 설정이 있는 조회(시험·단순한 경우) */
export function singleDaily(workspace: string, config: DailyConfig): DailyLookup {
  return { of: (ws) => (ws === workspace ? config : null), all: () => [{ workspace, config }] };
}

/** 경로의 워크스페이스 데일리 설정으로 그 경로를 판정한다 */
export function dailyOfPath(path: string, lookup: DailyLookup | null | undefined): DailyNote | null {
  if (!lookup) return null;
  const ws = path.includes("/") ? path.slice(0, path.indexOf("/")) : null;
  return parseDailyPath(path, lookup.of(ws));
}

const trimSlashes = (s: string) => s.trim().replace(/^\/+|\/+$/g, "");

/** 데일리 노트 경로: 폴더 + 형식 */
export function dailyNotePath(folder: string, format: string, d: Date, opts: DateFormatOptions = {}): string {
  const name = trimSlashes(formatDate(d, format || "YYYY-MM-DD", opts));
  const dir = trimSlashes(folder);
  return `${dir ? `${dir}/` : ""}${name}.md`;
}

/** 묶음 방식 보기(이름은 화면이 번역한다: daily.preset.<id>) */
export const DAILY_PRESETS: { id: string; format: string }[] = [
  { id: "flat", format: "YYYY-MM-DD" },
  { id: "year", format: "YYYY/YYYY-MM-DD" },
  { id: "month", format: "YYYY/MM/YYYY-MM-DD" },
  { id: "week", format: "GGGG/[W]WW/YYYY-MM-DD" },
];

/**
 * 형식이 쓸 수 있는지. 못 쓰면 이유(코드), 쓸 수 있으면 null.
 * 연·월·일을 모두 읽을 수 있어야 하고, 결과 경로에 파일 이름으로 못 쓰는 글자·빈 칸·..·점 폴더가 없어야 한다.
 */
export function dailyFormatProblem(folder: string, format: string, lang?: VaultLang): FormatProblem | null {
  if (!format.trim()) return { code: "empty" };
  const toks = tokensOf(format);
  if (!toks.some((t) => t === "YYYY" || t === "YY")) return { code: "noYear" };
  if (!toks.some((t) => t === "MM" || t === "M" || t === "MMMM")) return { code: "noMonth" };
  if (!toks.some((t) => t === "DD" || t === "D")) return { code: "noDay" };
  const sample = dailyNotePath(folder, format, new Date(2026, 11, 31), { lang });
  const segs = sample.replace(/\.md$/, "").split("/");
  for (const s of segs) {
    if (!s.trim()) return { code: "emptySegment" };
    if (s === "." || s === "..") return { code: "dotSegment" };
    if (s.startsWith(".")) return { code: "dotStart" };
    // eslint-disable-next-line no-control-regex
    if (/[\\:*?"<>|\u0000-\u001f]/.test(s)) return { code: "badChar", segment: s };
  }
  return null;
}

function tokensOf(format: string): string[] {
  const out: string[] = [];
  for (const m of format.matchAll(TOKEN_RE)) if (m[1] === undefined) out.push(m[0]);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 토큰 → 정규식 조각(날짜 값을 읽는 이름 있는 그룹) */
function tokenPattern(tok: string, used: Set<string>, lang?: VaultLang): string {
  const t = vaultText(lang);
  const group = (name: string, body: string) => {
    if (used.has(name)) return body.replace(/^\(/, "(?:");
    used.add(name);
    return `(?<${name}>${body.slice(1)}`;
  };
  switch (tok) {
    case "YYYY":
      return group("Y", "(\\d{4})");
    case "YY":
      return group("y", "(\\d{2})");
    case "GGGG":
      return "\\d{4}";
    case "MMMM": {
      // 월 이름(볼트 언어). 읽을 때는 이름 순서로 월을 정한다
      const names = [...t.months].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
      if (used.has("Mn")) return `(?:${names})`;
      used.add("Mn");
      return `(?<Mn>${names})`;
    }
    case "MM":
      return group("M", "(\\d{2})");
    case "M":
      return group("M", "(\\d{1,2})");
    case "DD":
      return group("D", "(\\d{2})");
    case "D":
      return group("D", "(\\d{1,2})");
    case "WW":
      return "\\d{2}";
    case "W":
      return "\\d{1,2}";
    case "HH":
    case "mm":
    case "ss":
      return "\\d{2}";
    case "H":
    case "m":
    case "s":
      return "\\d{1,2}";
    case "dddd":
      return `(?:${t.weekdaysLong.map(escapeRe).join("|")})`;
    case "ddd":
      return `(?:${t.weekdaysShort.map(escapeRe).join("|")})`;
  }
  return escapeRe(tok);
}

function formatPattern(format: string, used: Set<string>, lang?: VaultLang): string {
  let out = "";
  let last = 0;
  for (const m of format.matchAll(TOKEN_RE)) {
    out += escapeRe(format.slice(last, m.index));
    out += m[1] !== undefined ? escapeRe(m[1]) : tokenPattern(m[0], used, lang);
    last = m.index! + m[0].length;
  }
  return out + escapeRe(format.slice(last));
}

export interface DailyNote {
  path: string;
  /** 그날 0시(이 기기 시간대) */
  date: Date;
  /** YYYY-MM-DD */
  ymd: string;
  /** 파일 이름에서 날짜 부분(형식대로) */
  datePart: string;
  /** 날짜 뒤 제목(없으면 "") */
  title: string;
  /** 날짜와 제목 사이 구분 글자(없으면 "") */
  sep: string;
}

interface Matcher {
  re: RegExp;
  cfg: DailyConfig;
}

const matcherCache = new Map<string, Matcher | null>();

function matcherOf(cfg: DailyConfig): Matcher | null {
  const key = `${cfg.folder}\0${cfg.format}\0${cfg.weekStart ?? "monday"}\0${cfg.lang ?? "en"}`;
  if (matcherCache.has(key)) return matcherCache.get(key)!;
  let m: Matcher | null = null;
  if (!dailyFormatProblem(cfg.folder, cfg.format, cfg.lang)) {
    const dir = trimSlashes(cfg.folder);
    const used = new Set<string>();
    const body = formatPattern(trimSlashes(cfg.format), used, cfg.lang);
    // 날짜 뒤는 이름 끝이거나 구분 글자(공백·_·· 그리고 " - ")로 시작하는 제목. 숫자가 바로 이어지면 아니다.
    const re = new RegExp(`^${dir ? `${escapeRe(dir)}/` : ""}(?<date>${body})(?:(?<sep> - |[ _·]+)(?<title>[^/]*?))?\\.md$`);
    m = { re, cfg };
  }
  if (matcherCache.size > 50) matcherCache.clear();
  matcherCache.set(key, m);
  return m;
}

/** 읽은 그룹 → 날짜(월은 숫자 M 또는 이름 Mn) */
function dateOfGroups(g: Record<string, string | undefined>, lang?: VaultLang): Date | null {
  const year = g.Y !== undefined ? Number(g.Y) : g.y !== undefined ? 2000 + Number(g.y) : NaN;
  const month = g.Mn !== undefined ? vaultText(lang).months.indexOf(g.Mn) + 1 : Number(g.M);
  return validDate(year, month, Number(g.D));
}

/**
 * 데일리 노트 판정(파일 경로·이름만 본다): 데일리 폴더 아래, 형식의 폴더 부분과 맞고 이름이 형식의 날짜 부분으로 시작하면
 * 데일리 노트. 날짜 뒤는 이름 끝이거나 구분 글자(공백, " - ", "_", "·")여야 한다. 읽은 날짜로 다시 만든 경로가
 * 실제 폴더·이름과 맞아야 한다(예: 2026/W41/ 폴더에 2026-10-20은 아님).
 */
export function parseDailyPath(path: string, cfg: DailyConfig | null | undefined): DailyNote | null {
  if (!cfg) return null;
  const m = matcherOf(cfg);
  if (!m) return null;
  const r = m.re.exec(path);
  if (!r?.groups) return null;
  const g = r.groups;
  const date = dateOfGroups(g, cfg.lang);
  if (!date) return null;
  const dir = trimSlashes(cfg.folder);
  const expected = dailyNotePath(cfg.folder, cfg.format, date, { weekStart: cfg.weekStart, lang: cfg.lang });
  if (expected !== `${dir ? `${dir}/` : ""}${g.date}.md`) return null;
  const datePart = expected.slice(expected.lastIndexOf("/") + 1, -3);
  return { path, date, ymd: ymd(date), datePart, title: (g.title ?? "").trim(), sep: g.sep ?? "" };
}

/** 경로 목록에서 데일리 노트를 모두 찾는다(날짜순, 같은 날이면 날짜만 있는 이름 먼저) */
export function dailyNotes(paths: Iterable<string>, cfg: DailyConfig | null | undefined): DailyNote[] {
  if (!cfg || !matcherOf(cfg)) return [];
  const out: DailyNote[] = [];
  const dir = trimSlashes(cfg.folder);
  for (const p of paths) {
    if (dir && !p.startsWith(dir + "/")) continue;
    const n = parseDailyPath(p, cfg);
    if (n) out.push(n);
  }
  return out.sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : Number(!!a.title) - Number(!!b.title) || a.path.localeCompare(b.path)));
}

/** 그날 데일리 노트들(날짜만 있는 이름 먼저) */
export function dailyNotesOn(paths: Iterable<string>, cfg: DailyConfig | null | undefined, day: Date): DailyNote[] {
  const key = ymd(day);
  return dailyNotes(paths, cfg).filter((n) => n.ymd === key);
}

/**
 * 링크 대상이 데일리 날짜인지: 형식의 날짜 부분(예: 2026-10-07)이나 전체 형식(예: 2026/10/2026-10-07)으로 쓴 것.
 * 맞으면 그 날짜, 아니면 null.
 */
export function dailyLinkDate(target: string, cfg: DailyConfig | null | undefined): Date | null {
  if (!cfg) return null;
  const t = trimSlashes(target).replace(/\.md$/i, "");
  if (!t || !/\d/.test(t)) return null;
  const folder = trimSlashes(cfg.folder);
  const rel = folder && t.startsWith(folder + "/") ? t.slice(folder.length + 1) : t;
  const full = trimSlashes(cfg.format);
  for (const fmt of new Set([full.split("/").pop()!, full])) {
    const g = new RegExp(`^${formatPattern(fmt, new Set(), cfg.lang)}$`).exec(rel)?.groups;
    if (!g) continue;
    const d = dateOfGroups(g, cfg.lang);
    if (d && formatDate(d, fmt, { weekStart: cfg.weekStart, lang: cfg.lang }) === rel) return d;
  }
  return null;
}

/** 데일리 노트 자동 속성(만들 때 넣고, 이름의 날짜를 바꿀 때 같이 고친다) */
export const DAILY_PROP_KEYS = ["daily", "date", "year", "month", "monthday", "week", "weekday"] as const;

export function dailyProps(d: Date, weekStart: WeekStart = "monday", lang?: VaultLang): Record<(typeof DAILY_PROP_KEYS)[number], string | number | boolean> {
  const w = weekOf(d, weekStart);
  return {
    daily: true,
    date: ymd(d),
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    monthday: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    week: `${w.year}-W${pad(w.week)}`,
    weekday: vaultText(lang).weekdaysShort[d.getDay()],
  };
}

/**
 * 데일리 노트 내용에 자동 속성을 합친다. 템플릿 프런트매터와 같은 키는 자동 값이 이기고,
 * icon은 템플릿 값이 있으면 그것을 둔다(없으면 설정의 데일리 기본 아이콘).
 */
export function withDailyProps(content: string, d: Date, opts: { weekStart?: WeekStart; icon?: string; lang?: VaultLang } = {}): string {
  let out = content;
  for (const [k, v] of Object.entries(dailyProps(d, opts.weekStart, opts.lang))) out = setFrontmatterField(out, k, v);
  const fm = parseFrontmatter(out).data;
  if (opts.icon && !(typeof fm?.icon === "string" && fm.icon.trim())) out = setFrontmatterField(out, "icon", opts.icon);
  return out;
}

/**
 * 이름의 날짜가 바뀐 데일리 노트: 이미 있는 자동 속성만 새 날짜로 고친다(없던 속성은 넣지 않는다).
 * 바뀐 것이 없으면 null.
 */
export function updateDailyProps(content: string, d: Date, weekStart: WeekStart = "monday", lang?: VaultLang): string | null {
  const fm = parseFrontmatter(content).data;
  if (!fm) return null;
  const want = dailyProps(d, weekStart, lang);
  let out = content;
  for (const k of DAILY_PROP_KEYS) {
    if (!(k in fm) || k === "daily") continue;
    if (String(fm[k]) !== String(want[k])) out = setFrontmatterField(out, k, want[k]);
  }
  return out === content ? null : out;
}

/** 자동 속성이 이름의 날짜와 다른 키(정리 점검용). 없는 속성은 보지 않는다 */
export function dailyPropMismatch(frontmatter: Record<string, unknown> | null, d: Date, weekStart: WeekStart = "monday", lang?: VaultLang): string[] {
  if (!frontmatter) return [];
  const want = dailyProps(d, weekStart, lang);
  return DAILY_PROP_KEYS.filter((k) => k !== "daily" && k in frontmatter && frontmatter[k] !== null && String(frontmatter[k]) !== String(want[k]));
}

/**
 * 읽기 좋은 날짜(화면 언어): ko "10월 7일 (수)", en "Wed, October 7". 올해가 아니면 연도를 붙인다.
 */
export function friendlyDate(d: Date, now = new Date(), locale = "en"): string {
  const thisYear = d.getFullYear() === now.getFullYear();
  if (locale.toLowerCase().startsWith("ko")) {
    const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${vaultText("ko").weekdaysShort[d.getDay()]})`;
    return thisYear ? base : `${d.getFullYear()}년 ${base}`;
  }
  return new Intl.DateTimeFormat(locale, { weekday: "short", month: "long", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }).format(d);
}

/**
 * "기존 데일리 노트를 새 형식으로 옮기기" 계획: 데일리 폴더 아래 문서 중 새 형식에 맞지 않는 것의 이름 앞에서
 * 날짜(YYYY-MM-DD, YYYY.MM.DD, YYYY_MM_DD, YYYYMMDD)를 읽어 새 경로를 만든다. 날짜 뒤 제목은 살린다.
 * 날짜를 못 읽거나 옮길 자리에 이미 문서가 있으면 skipped.
 */
export interface DailyMigrationSkip {
  path: string;
  /** noDate: 이름에서 날짜를 읽지 못함, taken: 옮길 자리(to)에 이미 문서가 있음 */
  reason: "noDate" | "taken";
  to?: string;
}

export function planDailyMigration(paths: string[], cfg: DailyConfig): { moves: { from: string; to: string; date: Date }[]; skipped: DailyMigrationSkip[] } {
  const dir = trimSlashes(cfg.folder);
  const taken = new Set(paths.map((p) => p.toLowerCase()));
  const moves: { from: string; to: string; date: Date }[] = [];
  const skipped: DailyMigrationSkip[] = [];
  for (const p of paths) {
    if (!/\.md$/i.test(p) || (dir && !p.startsWith(dir + "/"))) continue;
    if (parseDailyPath(p, cfg)) continue;
    const stem = p.slice(p.lastIndexOf("/") + 1, -3);
    const m = /^(\d{4})[-._]?(\d{2})[-._]?(\d{2})(?!\d)(.*)$/.exec(stem);
    const d = m ? validDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    if (!m || !d) {
      skipped.push({ path: p, reason: "noDate" });
      continue;
    }
    const rest = m[4];
    const title = rest.replace(/^(?: - |[\s_·-])+/, "").trim();
    const sep = /^ - /.test(rest) ? " - " : /^_/.test(rest) ? "_" : /^·/.test(rest) ? "·" : " ";
    const base = dailyNotePath(cfg.folder, cfg.format, d, { weekStart: cfg.weekStart, lang: cfg.lang });
    const to = title ? `${base.slice(0, -3)}${sep}${title}.md` : base;
    if (to === p) continue;
    if (taken.has(to.toLowerCase())) {
      skipped.push({ path: p, reason: "taken", to });
      continue;
    }
    taken.add(to.toLowerCase());
    moves.push({ from: p, to, date: d });
  }
  return { moves, skipped };
}
