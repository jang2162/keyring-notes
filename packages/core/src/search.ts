import type { SearchHit, SearchMatch } from "./types.js";

/** 한 문서에서 돌려줄 일치 줄의 상한. 화면은 앞의 몇 줄만 보이고 나머지는 「N줄 더」로 편다 */
export const SEARCH_LINES_MAX = 50;

const isTagWord = (w: string) => w.startsWith("#") && w.length > 1;

/**
 * 검색어를 글 단어와 태그 조건으로 나눈다. `#태그` 단어는 태그 조건이고, tags(화면의 태그 칩)도 태그 조건에 더한다.
 * 태그는 색인처럼 앞의 `#` 를 떼고 소문자로 맞춘다. 글 단어는 그대로 둔다(서버 FTS 가 받는다).
 */
export function parseSearchQuery(query: string, tags: string[] = []): { text: string[]; tags: string[] } {
  const words = query.split(/\s+/).filter(Boolean);
  const chips = tags.map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
  return {
    text: words.filter((w) => !isTagWord(w)),
    tags: [...new Set([...words.filter(isTagWord).map((w) => w.slice(1).toLowerCase()), ...chips])],
  };
}

/** 문서 태그가 조건을 모두 가졌는가(AND). 조건 `a` 는 하위 태그 `a/b` 도 맞는다 */
export function hasAllTags(docTags: string[], terms: string[]): boolean {
  return terms.every((t) => docTags.some((x) => x === t || x.startsWith(t + "/")));
}

/** 글 단어(소문자) 중 하나라도 든 줄. 앞에서부터 max 개와 전체 개수 */
export function matchLines(body: string, lowered: string[], max: number): { matches: SearchMatch[]; count: number } {
  const matches: SearchMatch[] = [];
  let count = 0;
  if (lowered.length === 0) return { matches, count };
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (!lowered.some((t) => l.includes(t))) continue;
    count++;
    if (matches.length < max) matches.push({ line: i + 1, snippet: lines[i].trim().slice(0, 200) });
  }
  return { matches, count };
}

/**
 * 결과 한 줄. line·snippet 은 첫 일치 줄(없으면 1줄·빈 글 — 제목·경로·태그로만 맞은 문서).
 * lines 가 1 이상이면 일치 줄을 앞에서부터 그만큼(SEARCH_LINES_MAX 까지) matches 에, 전체 개수를 matchCount 에 붙인다.
 * 0 이면 붙이지 않는다(에이전트 MCP 응답은 예전 모양 그대로).
 */
export function searchHit(path: string, title: string, body: string, lowered: string[], lines = 0): SearchHit {
  const want = Math.min(Math.max(Math.floor(lines), 0), SEARCH_LINES_MAX);
  const { matches, count } = matchLines(body, lowered, Math.max(want, 1));
  const first = matches[0];
  const hit: SearchHit = { path, title, line: first?.line ?? 1, snippet: first?.snippet ?? "" };
  if (want > 0) {
    hit.matches = matches;
    hit.matchCount = count;
  }
  return hit;
}
