import { parseFrontmatter } from "./markdown.js";
import { setFrontmatterField } from "./frontmatter.js";

/**
 * 날짜 형식과 데일리 노트 판정. 웹·앱·서버(링크 해석·위젯·정리 점검)가 같은 규칙을 쓴다.
 *
 * 날짜 토큰: YYYY YY GGGG(주 기준 연도) M MM MMMM(10월) D DD W WW(주차) H HH m mm s ss ddd(수) dddd(수요일) [글자]
 * 주차는 주 시작 요일이 월요일이면 ISO 8601(목요일이 든 해의 주), 일요일이면 같은 규칙을 일요일 시작 주에 적용한다
 * (그 주의 수요일이 든 해·주. 주의 나흘 이상이 새해에 있으면 1주차).
 */
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export type WeekStart = "monday" | "sunday";

export interface DateFormatOptions {
  /** 주 시작 요일(기본 월요일, ISO) */
  weekStart?: WeekStart;
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
        return `${d.getMonth() + 1}월`;
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
        return `${DAYS[d.getDay()]}요일`;
      case "ddd":
        return DAYS[d.getDay()];
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

/** 데일리 노트 설정(모든 기기 공통 설정 파일에서 온다) */
export interface DailyConfig {
  folder: string;
  /** 파일 이름 형식(/가 있으면 하위 폴더, 예: YYYY/MM/YYYY-MM-DD) */
  format: string;
  weekStart?: WeekStart;
}

const trimSlashes = (s: string) => s.trim().replace(/^\/+|\/+$/g, "");

/** 데일리 노트 경로: 폴더 + 형식 */
export function dailyNotePath(folder: string, format: string, d: Date, opts: DateFormatOptions = {}): string {
  const name = trimSlashes(formatDate(d, format || "YYYY-MM-DD", opts));
  const dir = trimSlashes(folder);
  return `${dir ? `${dir}/` : ""}${name}.md`;
}

export const DAILY_PRESETS: { id: string; label: string; format: string }[] = [
  { id: "flat", label: "묶지 않음", format: "YYYY-MM-DD" },
  { id: "year", label: "연도별", format: "YYYY/YYYY-MM-DD" },
  { id: "month", label: "연·월별", format: "YYYY/MM/YYYY-MM-DD" },
  { id: "week", label: "연·주차별", format: "GGGG/[W]WW/YYYY-MM-DD" },
];

/**
 * 형식이 쓸 수 있는지. 못 쓰면 이유(사람이 읽을 글), 쓸 수 있으면 null.
 * 연·월·일을 모두 읽을 수 있어야 하고, 결과 경로에 파일 이름으로 못 쓰는 글자·빈 칸·..·점 폴더가 없어야 한다.
 */
export function dailyFormatProblem(folder: string, format: string): string | null {
  if (!format.trim()) return "형식이 비어 있습니다";
  const toks = tokensOf(format);
  if (!toks.some((t) => t === "YYYY" || t === "YY")) return "연도(YYYY)가 없습니다";
  if (!toks.some((t) => t === "MM" || t === "M" || t === "MMMM")) return "월(MM)이 없습니다";
  if (!toks.some((t) => t === "DD" || t === "D")) return "일(DD)이 없습니다";
  const sample = dailyNotePath(folder, format, new Date(2026, 11, 31));
  const segs = sample.replace(/\.md$/, "").split("/");
  for (const s of segs) {
    if (!s.trim()) return "빈 폴더 이름이 생깁니다(// 또는 앞뒤 /)";
    if (s === "." || s === "..") return "'..'·'.' 폴더는 쓸 수 없습니다";
    if (s.startsWith(".")) return "점(.)으로 시작하는 폴더·파일은 동기화·API에서 빠져 쓸 수 없습니다";
    // eslint-disable-next-line no-control-regex
    if (/[\\:*?"<>|\u0000-\u001f]/.test(s)) return `파일 이름에 못 쓰는 글자가 있습니다: ${s}`;
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
function tokenPattern(tok: string, used: Set<string>): string {
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
    case "MMMM":
      return `${group("M", "(\\d{1,2})")}월`;
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
      return "[일월화수목금토]요일";
    case "ddd":
      return "[일월화수목금토]";
  }
  return escapeRe(tok);
}

function formatPattern(format: string, used: Set<string>): string {
  let out = "";
  let last = 0;
  for (const m of format.matchAll(TOKEN_RE)) {
    out += escapeRe(format.slice(last, m.index));
    out += m[1] !== undefined ? escapeRe(m[1]) : tokenPattern(m[0], used);
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
  const key = `${cfg.folder}\0${cfg.format}\0${cfg.weekStart ?? "monday"}`;
  if (matcherCache.has(key)) return matcherCache.get(key)!;
  let m: Matcher | null = null;
  if (!dailyFormatProblem(cfg.folder, cfg.format)) {
    const dir = trimSlashes(cfg.folder);
    const used = new Set<string>();
    const body = formatPattern(trimSlashes(cfg.format), used);
    // 날짜 뒤는 이름 끝이거나 구분 글자(공백·_·· 그리고 " - ")로 시작하는 제목. 숫자가 바로 이어지면 아니다.
    const re = new RegExp(`^${dir ? `${escapeRe(dir)}/` : ""}(?<date>${body})(?:(?<sep> - |[ _·]+)(?<title>[^/]*?))?\\.md$`);
    m = { re, cfg };
  }
  if (matcherCache.size > 50) matcherCache.clear();
  matcherCache.set(key, m);
  return m;
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
  const year = g.Y !== undefined ? Number(g.Y) : g.y !== undefined ? 2000 + Number(g.y) : NaN;
  const date = validDate(year, Number(g.M), Number(g.D));
  if (!date) return null;
  const dir = trimSlashes(cfg.folder);
  const expected = dailyNotePath(cfg.folder, cfg.format, date, { weekStart: cfg.weekStart });
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
    const g = new RegExp(`^${formatPattern(fmt, new Set())}$`).exec(rel)?.groups;
    if (!g) continue;
    const year = g.Y !== undefined ? Number(g.Y) : g.y !== undefined ? 2000 + Number(g.y) : NaN;
    const d = validDate(year, Number(g.M), Number(g.D));
    if (d && formatDate(d, fmt, { weekStart: cfg.weekStart }) === rel) return d;
  }
  return null;
}

/** 데일리 노트 자동 속성(만들 때 넣고, 이름의 날짜를 바꿀 때 같이 고친다) */
export const DAILY_PROP_KEYS = ["daily", "date", "year", "month", "monthday", "week", "weekday"] as const;

export function dailyProps(d: Date, weekStart: WeekStart = "monday"): Record<(typeof DAILY_PROP_KEYS)[number], string | number | boolean> {
  const w = weekOf(d, weekStart);
  return {
    daily: true,
    date: ymd(d),
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    monthday: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    week: `${w.year}-W${pad(w.week)}`,
    weekday: DAYS[d.getDay()],
  };
}

/**
 * 데일리 노트 내용에 자동 속성을 합친다. 템플릿 프런트매터와 같은 키는 자동 값이 이기고,
 * icon은 템플릿 값이 있으면 그것을 둔다(없으면 설정의 데일리 기본 아이콘).
 */
export function withDailyProps(content: string, d: Date, opts: { weekStart?: WeekStart; icon?: string } = {}): string {
  let out = content;
  for (const [k, v] of Object.entries(dailyProps(d, opts.weekStart))) out = setFrontmatterField(out, k, v);
  const fm = parseFrontmatter(out).data;
  if (opts.icon && !(typeof fm?.icon === "string" && fm.icon.trim())) out = setFrontmatterField(out, "icon", opts.icon);
  return out;
}

/**
 * 이름의 날짜가 바뀐 데일리 노트: 이미 있는 자동 속성만 새 날짜로 고친다(없던 속성은 넣지 않는다).
 * 바뀐 것이 없으면 null.
 */
export function updateDailyProps(content: string, d: Date, weekStart: WeekStart = "monday"): string | null {
  const fm = parseFrontmatter(content).data;
  if (!fm) return null;
  const want = dailyProps(d, weekStart);
  let out = content;
  for (const k of DAILY_PROP_KEYS) {
    if (!(k in fm) || k === "daily") continue;
    if (String(fm[k]) !== String(want[k])) out = setFrontmatterField(out, k, want[k]);
  }
  return out === content ? null : out;
}

/** 자동 속성이 이름의 날짜와 다른 키(정리 점검용). 없는 속성은 보지 않는다 */
export function dailyPropMismatch(frontmatter: Record<string, unknown> | null, d: Date, weekStart: WeekStart = "monday"): string[] {
  if (!frontmatter) return [];
  const want = dailyProps(d, weekStart);
  return DAILY_PROP_KEYS.filter((k) => k !== "daily" && k in frontmatter && frontmatter[k] !== null && String(frontmatter[k]) !== String(want[k]));
}

/** 읽기 좋은 날짜: 10월 7일 (수), 올해가 아니면 2027년 1월 1일 (금) */
export function friendlyDate(d: Date, now = new Date()): string {
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
  return d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()}년 ${base}`;
}

/**
 * "기존 데일리 노트를 새 형식으로 옮기기" 계획: 데일리 폴더 아래 문서 중 새 형식에 맞지 않는 것의 이름 앞에서
 * 날짜(YYYY-MM-DD, YYYY.MM.DD, YYYY_MM_DD, YYYYMMDD)를 읽어 새 경로를 만든다. 날짜 뒤 제목은 살린다.
 * 날짜를 못 읽거나 옮길 자리에 이미 문서가 있으면 skipped.
 */
export function planDailyMigration(paths: string[], cfg: DailyConfig): { moves: { from: string; to: string; date: Date }[]; skipped: { path: string; reason: string }[] } {
  const dir = trimSlashes(cfg.folder);
  const taken = new Set(paths.map((p) => p.toLowerCase()));
  const moves: { from: string; to: string; date: Date }[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const p of paths) {
    if (!/\.md$/i.test(p) || (dir && !p.startsWith(dir + "/"))) continue;
    if (parseDailyPath(p, cfg)) continue;
    const stem = p.slice(p.lastIndexOf("/") + 1, -3);
    const m = /^(\d{4})[-._]?(\d{2})[-._]?(\d{2})(?!\d)(.*)$/.exec(stem);
    const d = m ? validDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    if (!m || !d) {
      skipped.push({ path: p, reason: "이름에서 날짜를 읽지 못함" });
      continue;
    }
    const rest = m[4];
    const title = rest.replace(/^(?: - |[\s_·-])+/, "").trim();
    const sep = /^ - /.test(rest) ? " - " : /^_/.test(rest) ? "_" : /^·/.test(rest) ? "·" : " ";
    const base = dailyNotePath(cfg.folder, cfg.format, d, { weekStart: cfg.weekStart });
    const to = title ? `${base.slice(0, -3)}${sep}${title}.md` : base;
    if (to === p) continue;
    if (taken.has(to.toLowerCase())) {
      skipped.push({ path: p, reason: `옮길 자리에 이미 문서가 있음: ${to}` });
      continue;
    }
    taken.add(to.toLowerCase());
    moves.push({ from: p, to, date: d });
  }
  return { moves, skipped };
}
