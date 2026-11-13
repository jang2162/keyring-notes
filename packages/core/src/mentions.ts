import { angleRanges, inlineLinkRanges, wikilinkMatches } from "./linkScan.js";
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
  const byRegex = (re: RegExp) => {
    for (const m of line.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  };
  byRegex(/`+[^`]*`+/g);
  // 괄호 짝을 찾는 셋은 정규식 대신 스캐너로 — 닫히지 않는 `[`·`<` 가 많은 줄에서 정규식은 길이의 제곱으로 느리다(linkScan.ts)
  for (const m of wikilinkMatches(line)) out.push([m.start, m.end]);
  for (const r of inlineLinkRanges(line)) out.push(r);
  for (const r of angleRanges(line)) out.push(r);
  byRegex(/https?:\/\/\S+/g);
  return out;
}

/** 겹치거나 맞닿은 범위를 합쳐 시작 순으로 */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
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
    // 가린 자리와 앞선(더 긴) 이름이 차지한 자리는 합쳐 시작 순으로 두고, 이름마다 앞에서부터 한 번만 훑는다 —
    // 찾은 자리마다 범위 전부와 견주면 한 줄에 언급·링크가 수만 개일 때 그 수의 제곱이 된다
    const masked = mergeRanges(maskedRanges(line));
    let taken: [number, number][] = [];
    for (const name of lowered) {
      // 같은 이름끼리는 겹치지 않는다(다음 자리를 이름 길이만큼 뒤에서 찾는다). 그래서 이 이름이 차지한 자리는 다음 이름부터 본다
      const mine: [number, number][] = [];
      let mi = 0;
      let ti = 0;
      for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + name.length)) {
        const end = at + name.length;
        while (mi < masked.length && masked[mi][1] <= at) mi++;
        while (ti < taken.length && taken[ti][1] <= at) ti++;
        if ((mi < masked.length && masked[mi][0] < end) || (ti < taken.length && taken[ti][0] < end)) continue;
        if (WORD.test(name[0]) && WORD.test(line[at - 1] ?? "")) continue;
        if (WORD.test(name[name.length - 1]) && WORD.test(line[end] ?? "")) continue;
        mine.push([at, end]);
        const from = Math.max(0, at - 40);
        const before = `${from > 0 ? "…" : ""}${line.slice(from, at).trimStart()}`;
        const context = `${before}${line.slice(at, end + 40).trimEnd()}${end + 40 < line.length ? "…" : ""}`;
        out.push({ line: i + 1, start: at, end, text: line.slice(at, end), context, contextAt: before.length });
      }
      if (mine.length) taken = mergeRanges([...taken, ...mine]);
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
