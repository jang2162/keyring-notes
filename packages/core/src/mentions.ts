import { parseFrontmatter, stripComments } from "./markdown.js";

/**
 * 연결되지 않은 언급: 다른 문서 본문에 이 문서의 이름(파일 이름·title·aliases)이 나오지만 링크가 아닌 곳.
 * 코드·링크·주석·프런트매터 안은 빼고, 영문·숫자 이름은 단어 경계를 본다(한국어는 조사가 붙으므로 경계를 보지 않는다).
 */
export interface Mention {
  /** 1부터 시작하는 줄 */
  line: number;
  /** 그 줄 안의 위치(글자 단위) */
  start: number;
  end: number;
  /** 본문에 쓰인 그대로 */
  text: string;
  /** 앞뒤 문맥 한 줄 */
  context: string;
  /** context 안에서 언급이 시작하는 위치 */
  contextAt: number;
}

/** 문서의 이름들: 파일 이름, 프런트매터 title·aliases(2글자 이상, 긴 것 먼저) */
export function mentionNames(path: string, frontmatter: Record<string, unknown> | null): string[] {
  const names = new Set<string>([path.split("/").pop()!.replace(/\.md$/i, "")]);
  if (typeof frontmatter?.title === "string") names.add(frontmatter.title);
  const aliases = frontmatter?.aliases ?? frontmatter?.alias;
  for (const a of Array.isArray(aliases) ? aliases : typeof aliases === "string" ? aliases.split(",") : []) if (typeof a === "string") names.add(a);
  return [...names]
    .map((n) => n.trim())
    .filter((n) => [...n].length >= 2)
    .sort((a, b) => b.length - a.length);
}

/** 링크·코드·HTML 태그 자리(줄 안 범위). 그 안의 이름은 언급으로 세지 않는다 */
function maskedRanges(line: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of [/`+[^`]*`+/g, /!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /<[^>\n]+>/g, /https?:\/\/\S+/g]) {
    for (const m of line.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

const WORD = /[A-Za-z0-9_]/;

export function unlinkedMentions(content: string, names: string[]): Mention[] {
  if (names.length === 0) return [];
  const fm = parseFrontmatter(content).lines;
  const lines = stripComments(content).split("\n");
  const lowered = names.map((n) => n.toLowerCase());
  const out: Mention[] = [];
  let fence: string | null = null;
  for (let i = fm; i < lines.length; i++) {
    const line = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0].repeat(f[1].length);
      else if (f[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const lower = line.toLowerCase();
    const masked = maskedRanges(line);
    const taken: [number, number][] = [];
    for (const name of lowered) {
      for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + name.length)) {
        const end = at + name.length;
        if (masked.some(([a, b]) => at < b && end > a) || taken.some(([a, b]) => at < b && end > a)) continue;
        if (WORD.test(name[0]) && WORD.test(line[at - 1] ?? "")) continue;
        if (WORD.test(name[name.length - 1]) && WORD.test(line[end] ?? "")) continue;
        taken.push([at, end]);
        const from = Math.max(0, at - 40);
        const before = `${from > 0 ? "…" : ""}${line.slice(from, at).trimStart()}`;
        const context = `${before}${line.slice(at, end + 40).trimEnd()}${end + 40 < line.length ? "…" : ""}`;
        out.push({ line: i + 1, start: at, end, text: line.slice(at, end), context, contextAt: before.length });
      }
    }
  }
  return out.sort((a, b) => a.line - b.line || a.start - b.start);
}

/**
 * 언급을 링크로 바꾼다. target은 [[ ]] 안에 쓸 이름. 쓰인 글자가 target과 다르면 [[target|글자]].
 * 원문이 그 사이 바뀌어 자리가 맞지 않는 언급은 건너뛴다.
 */
export function linkMentions(content: string, mentions: Mention[], target: string): string {
  const lines = content.split("\n");
  // 같은 줄은 뒤에서부터 바꿔야 앞 위치가 어긋나지 않는다
  for (const m of [...mentions].sort((a, b) => b.line - a.line || b.start - a.start)) {
    const line = lines[m.line - 1];
    if (line === undefined || line.slice(m.start, m.end) !== m.text) continue;
    const link = m.text === target ? `[[${target}]]` : `[[${target}|${m.text}]]`;
    lines[m.line - 1] = line.slice(0, m.start) + link + line.slice(m.end);
  }
  return lines.join("\n");
}
