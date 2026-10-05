import { parse as parseYaml } from "yaml";

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
  const m = FM_RE.exec(content);
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
 * 제목 이름(대소문자 무시) 또는 줄 범위로 문서 일부를 자른다.
 * 제목은 "상위 > 하위"처럼 경로로 좁힐 수 있다.
 */
export function section(content: string, opts: { heading?: string; startLine?: number; endLine?: number }): Section {
  const lines = content.split("\n");
  const total = lines.length;
  let start: number;
  let end: number;
  let headingText: string | null = null;
  if (opts.heading) {
    const want = opts.heading.split(">").map((s) => s.trim().replace(/^#+\s*/, "").toLowerCase()).filter(Boolean);
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
    if (!match) throw new RangeError(`제목을 찾을 수 없습니다: ${opts.heading}`);
    start = match.line;
    end = match.endLine;
    headingText = match.text;
  } else {
    start = Math.max(1, opts.startLine ?? 1);
    end = Math.min(total, opts.endLine ?? total);
    if (start > end) throw new RangeError("줄 범위가 잘못되었습니다");
  }
  return { heading: headingText, startLine: start, endLine: end, totalLines: total, content: lines.slice(start - 1, end).join("\n") };
}

/** `[[대상#제목|별칭]]` 위키링크 대상 이름들(코드 블록 밖, 중복 제거). */
export function wikilinkTargets(content: string): string[] {
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

/** Obsidian식 링크 해석: 정확한 경로가 없으면 같은 파일 이름 중 가장 얕은 경로. */
export function resolveLink(target: string, paths: string[]): string | null {
  const t = target.trim().replace(/^\/+/, "").toLowerCase();
  if (!t) return null;
  const candidates = /\.[a-z0-9]+$/i.test(t) ? [t] : [`${t}.md`, t];
  const lowered = paths.map((p) => [p.toLowerCase(), p] as const);
  for (const c of candidates) {
    const exact = lowered.find(([l]) => l === c);
    if (exact) return exact[1];
  }
  for (const c of candidates) {
    const hits = lowered.filter(([l]) => l === c || l.endsWith("/" + c)).map(([, p]) => p);
    if (hits.length) return hits.sort((a, b) => a.split("/").length - b.split("/").length)[0];
  }
  return null;
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
  const raw = frontmatter?.sources ?? frontmatter?.source;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out = new Set<string>();
  for (const v of list) {
    if (typeof v !== "string") continue;
    const t = v
      .trim()
      .replace(/^\[\[|\]\]$/g, "")
      .split("|")[0]
      .split("#")[0]
      .trim();
    if (t && !/^[a-z]+:\/\//i.test(t)) out.add(t);
  }
  return [...out];
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
