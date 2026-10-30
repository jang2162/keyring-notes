import { parse as parseYaml } from "yaml";
import { PathError } from "./errors.js";
import { dailyLinkDate, dailyNotesOn, type DailyLookup } from "./daily.js";

export interface Heading {
  level: number;
  text: string;
  /** 1부터 시작하는 줄 번호. */
  line: number;
  /** 하위 제목까지 포함한 섹션의 마지막 줄. */
  endLine: number;
}

export interface Frontmatter {
  data: Record<string, unknown> | null;
  /** 프런트매터가 차지하는 줄 수(구분선 포함). 없으면 0. */
  lines: number;
  error?: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(content: string): Frontmatter {
  // 맨 앞 BOM(Windows 편집기에서 온 파일)은 건너뛴다 — 줄 수는 그대로다
  const m = FM_RE.exec(content.startsWith("\uFEFF") ? content.slice(1) : content);
  if (!m) return { data: null, lines: 0 };
  const lines = m[0].replace(/\r?\n$/, "").split("\n").length;
  try {
    const data = parseYaml(m[1]);
    if (data === null || data === undefined) return { data: {}, lines };
    if (typeof data !== "object" || Array.isArray(data)) return { data: null, lines, error: "프런트매터가 객체가 아닙니다" };
    return { data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, lines };
  } catch (e) {
    return { data: null, lines, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

/** 코드 블록 밖의 ATX 제목(`#`~`######`)을 찾는다. */
export function headings(content: string): Heading[] {
  const lines = content.split("\n");
  const fm = parseFrontmatter(content);
  const out: Heading[] = [];
  let fence: string | null = null;
  for (let i = fm.lines; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0].repeat(f[1].length);
      else if (f[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) out.push({ level: h[1].length, text: h[2].trim(), line: i + 1, endLine: lines.length });
  }
  for (let i = 0; i < out.length; i++) {
    const next = out.slice(i + 1).find((h) => h.level <= out[i].level);
    if (next) out[i].endLine = next.line - 1;
  }
  return out;
}

export interface Section {
  heading: string | null;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

/**
 * 블록 ID(`^id`)가 붙은 블록의 줄 범위(1부터, 포함). 문단 끝에 ` ^id`면 그 문단, 목록 항목이면 그 줄,
 * `^id`만 있는 줄이면 바로 앞 블록(표·인용 등). 없으면 null.
 */
export function blockRange(content: string, id: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  const esc = id.replace(/^\^/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const own = new RegExp(`^\\s*\\^${esc}\\s*$`);
  const tail = new RegExp(`\\s\\^${esc}\\s*$`);
  let at = lines.findIndex((l) => tail.test(l) || own.test(l));
  if (at < 0) return null;
  if (own.test(lines[at])) {
    at--;
    while (at >= 0 && !lines[at].trim()) at--;
    if (at < 0) return null;
  } else if (/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[at])) {
    return { start: at + 1, end: at + 1 };
  }
  let start = at;
  let end = at;
  while (start > 0 && lines[start - 1].trim()) start--;
  while (end < lines.length - 1 && lines[end + 1].trim() && !own.test(lines[end + 1])) end++;
  return { start: start + 1, end: end + 1 };
}

/** 블록 ID가 붙은 블록의 원문(` ^id` 표시는 뺀다). 없으면 null. */
export function blockText(content: string, id: string): string | null {
  const r = blockRange(content, id);
  if (!r) return null;
  const tail = new RegExp(`\\s\\^${id.replace(/^\^/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  return content
    .split("\n")
    .slice(r.start - 1, r.end)
    .map((l) => l.replace(tail, ""))
    .join("\n");
}

/** `#제목` 또는 `#^블록`이 문서에 있는지(출처 점검용) */
export function anchorExists(content: string, anchor: string): boolean {
  if (anchor.startsWith("^")) return blockRange(content, anchor.slice(1)) !== null;
  try {
    section(content, { heading: anchor });
    return true;
  } catch {
    return false;
  }
}

/**
 * 제목 이름(대소문자 무시) 또는 줄 범위로 문서 일부를 자른다.
 * 제목은 "상위 > 하위"처럼 경로로 좁힐 수 있고, `^id`면 그 블록(블록 ID)이다.
 */
export function section(content: string, opts: { heading?: string; startLine?: number; endLine?: number }): Section {
  const lines = content.split("\n");
  const total = lines.length;
  let start: number;
  let end: number;
  let headingText: string | null = null;
  if (opts.heading?.trim().startsWith("^")) {
    const id = opts.heading.trim().slice(1);
    const r = blockRange(content, id);
    if (!r) throw new PathError("block_missing", { id });
    return { heading: `^${id}`, startLine: r.start, endLine: r.end, totalLines: total, content: lines.slice(r.start - 1, r.end).join("\n") };
  }
  if (opts.heading) {
    const want = opts.heading
      .split(">")
      .map((s) =>
        s
          .trim()
          .replace(/^#+\s*/, "")
          .toLowerCase(),
      )
      .filter(Boolean);
    const hs = headings(content);
    const match = hs.find((h, idx) => {
      if (h.text.toLowerCase() !== want[want.length - 1]) return false;
      // 상위 제목 경로 확인
      let level = h.level;
      let wi = want.length - 2;
      for (let j = idx - 1; j >= 0 && wi >= 0; j--) {
        if (hs[j].level < level) {
          if (hs[j].text.toLowerCase() === want[wi]) wi--;
          level = hs[j].level;
        }
      }
      return wi < 0;
    });
    if (!match) throw new PathError("heading_missing", { heading: opts.heading });
    start = match.line;
    end = match.endLine;
    headingText = match.text;
  } else {
    start = Math.max(1, opts.startLine ?? 1);
    end = Math.min(total, opts.endLine ?? total);
    if (start > end) throw new PathError("line_range");
  }
  return { heading: headingText, startLine: start, endLine: end, totalLines: total, content: lines.slice(start - 1, end).join("\n") };
}

/**
 * Obsidian 주석 `%%…%%`(여러 줄 가능)을 지운다. 줄바꿈은 남겨 줄 번호(할 일 체크 등)가 그대로다.
 * 펜스 코드 블록과 인라인 코드 안의 %%는 주석이 아니다.
 * 주석 안의 링크·태그·할 일은 Obsidian처럼 세지 않는다(미리보기에서도 보이지 않는 내용이라).
 */
export function stripComments(content: string): string {
  if (!content.includes("%%")) return content;
  const lines = content.split("\n");
  let fence: string | null = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inComment) {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (fence === null) fence = f[1][0].repeat(f[1].length);
        else if (f[1].startsWith(fence)) fence = null;
        continue;
      }
      if (fence !== null) continue;
    }
    let out = "";
    let pos = 0;
    while (pos < line.length) {
      if (inComment) {
        const end = line.indexOf("%%", pos);
        if (end < 0) {
          pos = line.length;
          break;
        }
        inComment = false;
        pos = end + 2;
        continue;
      }
      const tick = line.indexOf("`", pos);
      const pct = line.indexOf("%%", pos);
      if (pct < 0 && tick < 0) {
        out += line.slice(pos);
        break;
      }
      if (tick >= 0 && (pct < 0 || tick < pct)) {
        // 인라인 코드: 같은 길이의 백틱까지 그대로
        const run = /^`+/.exec(line.slice(tick))![0];
        const close = line.indexOf(run, tick + run.length);
        const stop = close < 0 ? tick + run.length : close + run.length;
        out += line.slice(pos, stop);
        pos = stop;
        continue;
      }
      out += line.slice(pos, pct);
      inComment = true;
      pos = pct + 2;
    }
    lines[i] = out;
  }
  return lines.join("\n");
}

/** `[[대상#제목|별칭]]` 위키링크 대상 이름들(코드 블록·주석 밖, 중복 제거). */
export function wikilinkTargets(content: string): string[] {
  content = stripComments(content);
  const out = new Set<string>();
  let fence = false;
  // 프런트매터(sources 등)의 [[ ]]는 본문 링크로 세지 않는다. 출처는 sourceTargets로 따로 다룬다.
  const lines = content.split("\n").slice(parseFrontmatter(content).lines);
  for (const line of lines) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/!?\[\[([^\]\n|#]*)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g)) {
      const t = m[1].trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

export interface ResolveOptions {
  /**
   * 링크를 쓴 문서 경로. 주면 그 문서의 워크스페이스(볼트 루트 노드) 안에서 먼저 찾고, 없으면 볼트 전체에서 찾는다.
   * `[[업무/…]]`처럼 경로를 쓰면 그 경로가 정확히 맞는 것이 늘 먼저다.
   */
  from?: string | null;
  /** 워크스페이스별 데일리 설정: 주면 `[[2026-10-07]]`처럼 날짜만 쓴 링크가 그날 데일리 노트(날짜 뒤 제목 포함)를 가리킨다 */
  daily?: DailyLookup | null;
}

/** 경로의 워크스페이스(맨 앞 이름. 루트의 X.md는 X) */
function wsOf(p: string): string | null {
  const i = p.indexOf("/");
  if (i >= 0) return p.slice(0, i);
  return /\.md$/i.test(p) ? p.slice(0, -3) : null;
}

/**
 * 링크 해석용 경로 색인(같은 목록으로 여러 번 해석할 때 미리 만들어 둔다: 웹 미리보기·트리).
 */
export class LinkIndex {
  readonly paths: string[];
  private exact = new Map<string, string>();
  /** 파일 이름(소문자) → 경로들 */
  private byBase = new Map<string, string[]>();

  constructor(paths: Iterable<string>) {
    this.paths = [...paths];
    for (const p of this.paths) {
      const l = p.toLowerCase();
      if (!this.exact.has(l)) this.exact.set(l, p);
      const base = l.slice(l.lastIndexOf("/") + 1);
      const list = this.byBase.get(base);
      if (list) list.push(p);
      else this.byBase.set(base, [p]);
    }
  }

  /** 정확한 경로(대소문자 무시) */
  get(path: string): string | null {
    return this.exact.get(path.toLowerCase()) ?? null;
  }

  /**
   * Obsidian식 링크 해석: 정확한 경로가 없으면 같은 파일 이름 중 가장 얕은 경로. 링크를 쓴 문서(from)가 있으면
   * 그 워크스페이스 안의 것이 먼저다. 그래도 없고 대상이 데일리 날짜면 그날 데일리 노트(같은 워크스페이스 먼저,
   * 날짜만 있는 이름 먼저). 정확한 이름의 문서가 늘 먼저다.
   */
  resolve(target: string, opts: ResolveOptions = {}): string | null {
    const t = target.trim().replace(/^\/+/, "").toLowerCase();
    if (!t) return null;
    const candidates = /\.[a-z0-9]+$/i.test(t) ? [t] : [`${t}.md`, t];
    for (const c of candidates) {
      const exact = this.exact.get(c);
      if (exact) return exact;
    }
    const ws = opts.from ? wsOf(opts.from) : null;
    const shallowest = (hits: string[]) => [...hits].sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0))[0];
    const byName = (inWs: boolean): string | null => {
      for (const c of candidates) {
        const base = c.slice(c.lastIndexOf("/") + 1);
        const hits = (this.byBase.get(base) ?? []).filter((p) => {
          const l = p.toLowerCase();
          return (l === c || l.endsWith("/" + c)) && (!inWs || wsOf(p) === ws);
        });
        if (hits.length) return shallowest(hits);
      }
      return null;
    };
    const byDaily = (which: "here" | "others" | "all"): string | null => {
      if (!opts.daily) return null;
      for (const { workspace, config } of opts.daily.all()) {
        if ((which === "here" && workspace !== ws) || (which === "others" && workspace === ws)) continue;
        const day = dailyLinkDate(target, config);
        const hit = day ? dailyNotesOn(this.paths, config, day)[0] : undefined;
        if (hit) return hit.path;
      }
      return null;
    };
    // 같은 워크스페이스(이름 → 그날 데일리 노트) → 볼트 전체(이름 → 다른 워크스페이스의 데일리 노트)
    if (ws !== null) return byName(true) ?? byDaily("here") ?? byName(false) ?? byDaily("others");
    return byName(false) ?? byDaily("all");
  }
}

/** 링크 해석(LinkIndex.resolve). 같은 경로 목록으로 여러 번 해석하면 LinkIndex를 만들어 넘긴다 */
export function resolveLink(target: string, paths: string[] | LinkIndex, opts: ResolveOptions = {}): string | null {
  return (paths instanceof LinkIndex ? paths : new LinkIndex(paths)).resolve(target, opts);
}

export interface TaskItem {
  /** 1부터 시작하는 문서 전체 기준 줄 번호. */
  line: number;
  done: boolean;
  text: string;
}

/**
 * 프런트매터 sources(출처) 목록의 링크 대상. "[[경로|이름]]", "[[경로#제목]]", "경로", "경로.md" 모두 받는다.
 * URL(http…)은 볼트 문서가 아니므로 뺀다.
 */
export function sourceTargets(frontmatter: Record<string, unknown> | null): string[] {
  return [...new Set(sourceRefs(frontmatter).map((r) => r.target))];
}

/**
 * sources 항목마다 대상과 위치(`#제목`·`#^블록`). "[[원본#^p3|문단]]"처럼 원본의 문단을 가리키는 인용.
 */
export function sourceRefs(frontmatter: Record<string, unknown> | null): { target: string; anchor?: string }[] {
  const raw = frontmatter?.sources ?? frontmatter?.source;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: { target: string; anchor?: string }[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const ref = v
      .trim()
      .replace(/^\[\[|\]\]$/g, "")
      .split("|")[0];
    const hash = ref.indexOf("#");
    const t = (hash < 0 ? ref : ref.slice(0, hash)).trim();
    const anchor = hash < 0 ? undefined : ref.slice(hash + 1).trim() || undefined;
    if (!t || /^[a-z]+:\/\//i.test(t)) continue;
    const key = `${t}#${anchor ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(anchor ? { target: t, anchor } : { target: t });
  }
  return out;
}

export interface Analysis {
  /** 프런트매터 sources의 링크 대상 */
  sources: string[];
  title: string;
  /** 한 줄 요약: 프런트매터 summary/description, 없으면 본문 첫 문단. */
  summary: string;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  links: string[];
  tasks: TaskItem[];
}

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
// Obsidian 태그: 글자·숫자·_·-·/ 로 이루어지고 숫자만으로 된 것은 제외
const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

function normalizeTag(t: string): string {
  return t.replace(/^#/, "").replace(/\/+$/, "").trim().toLowerCase();
}

/** 프런트매터 tags(배열·쉼표 문자열)와 본문 #태그. */
function collectTags(fm: Record<string, unknown> | null, bodyLines: string[], fenced: boolean[]): string[] {
  const out = new Set<string>();
  const raw = fm?.tags ?? fm?.tag;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  for (const t of list) if (typeof t === "string" || typeof t === "number") out.add(normalizeTag(String(t)));
  bodyLines.forEach((line, i) => {
    if (fenced[i] || /^ {0,3}#{1,6}\s/.test(line)) return; // 코드 블록·제목 줄의 # 는 태그가 아님
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(TAG_RE)) out.add(normalizeTag(m[1]));
  });
  out.delete("");
  return [...out].sort();
}

/** 인덱스에 넣을 문서 정보를 한 번에 뽑는다. */
export function analyze(relPath: string, content: string): Analysis {
  // 주석(%%…%%) 안의 링크·태그·할 일·요약은 세지 않는다(줄 번호는 그대로)
  content = stripComments(content);
  const fm = parseFrontmatter(content);
  const lines = content.split("\n");
  const bodyLines = lines.slice(fm.lines);
  // 각 줄이 코드 블록 안인지
  const fenced: boolean[] = [];
  let fence: string | null = null;
  for (const line of bodyLines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      fenced.push(true);
      if (fence === null) fence = f[1][0].repeat(f[1].length);
      else if (f[1].startsWith(fence)) fence = null;
      continue;
    }
    fenced.push(fence !== null);
  }
  const tasks: TaskItem[] = [];
  bodyLines.forEach((line, i) => {
    if (fenced[i]) return;
    const m = TASK_RE.exec(line.replace(/\r$/, ""));
    if (m) tasks.push({ line: fm.lines + i + 1, done: m[1] !== " ", text: m[2].trim() });
  });
  const fmTitle = fm.data && typeof fm.data.title === "string" ? fm.data.title.trim() : "";
  const h1 = headings(content).find((h) => h.level === 1)?.text;
  const fileName = relPath.split("/").pop()!.replace(/\.md$/i, "");
  const fmSummary = [fm.data?.summary, fm.data?.description].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  let summary = fmSummary?.trim() ?? "";
  if (!summary) {
    // 제목·코드·목록·인용·표가 아닌 첫 문단
    for (let i = 0; i < bodyLines.length; i++) {
      const l = bodyLines[i].trim();
      if (!l || fenced[i] || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||!\[\[|<)/.test(l)) continue;
      summary = l;
      break;
    }
  }
  summary = summary.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_`]/g, "");
  if ([...summary].length > 120) summary = [...summary].slice(0, 119).join("") + "…";
  return {
    title: fmTitle || h1 || fileName,
    summary,
    sources: sourceTargets(fm.data),
    frontmatter: fm.data,
    tags: collectTags(fm.data, bodyLines, fenced),
    links: wikilinkTargets(content),
    tasks,
  };
}

/** 줄 하나의 할 일 체크 상태를 바꾼다. 할 일 줄이 아니면 null. */
export function setTaskState(content: string, line: number, done: boolean): string | null {
  const lines = content.split("\n");
  const cur = lines[line - 1];
  if (cur === undefined || !TASK_RE.test(cur.replace(/\r$/, ""))) return null;
  lines[line - 1] = cur.replace(/\[([ xX])\]/, done ? "[x]" : "[ ]");
  return lines.join("\n");
}
