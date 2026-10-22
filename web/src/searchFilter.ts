import { flattenNodes, parseSearchQuery, type SearchMatch, type VaultNode } from "@keyring-notes/core";
import type { SearchHit } from "./api";

/** 결과마다 처음 보이는 일치 줄 수. 나머지는 「N줄 더」로 편다 */
export const SEARCH_LINES_SHOWN = 3;

/**
 * 화면이 결과마다 받는 일치 줄 수. 펼쳐도 이만큼까지이고, 그 너머는 「나머지 N줄은 노트에서 찾으세요」(matchCount 로 센다).
 * 서버 상한(SEARCH_LINES_MAX)은 REST·MCP 용이고, 화면은 응답을 작게 두려고 덜 받는다.
 */
export const SEARCH_LINES_FETCH = 10;

/** 검색 패널의 필터. 앱이 떠 있는 동안만 들고 있고 저장하지 않는다 */
export interface SearchFilter {
  /** 노드 경로(.md 없이). 빈 글이면 범위(워크스페이스) 전체 */
  folder: string;
  /** 모두 가진 문서만(AND) */
  tags: string[];
}

export const NO_FILTER: SearchFilter = { folder: "", tags: [] };

export const filterActive = (f: SearchFilter) => f.folder !== "" || f.tags.length > 0;

/** 검색을 보낼지: 글 단어나 태그 조건(`#태그` 문법·칩)이 하나라도 있으면. 폴더만으로는 찾지 않는다 */
export function hasSearchTerms(query: string, f: SearchFilter): boolean {
  const q = parseSearchQuery(query, f.tags);
  return q.text.length > 0 || q.tags.length > 0;
}

/**
 * 폴더 필터에 고를 수 있는 노드: 화면의 트리(서버가 볼 수 있는 것만 준다) 안에서 하위 폴더가 있는 노드.
 * 하위가 없는 노드는 노트 하나라 「폴더」로 고를 것이 없다.
 */
export function folderChoices(nodes: VaultNode[]): string[] {
  return flattenNodes(nodes)
    .filter((n) => n.dir)
    .map((n) => n.path);
}

/** 범위(워크스페이스)가 바뀐 뒤에도 폴더 필터가 그 범위 안인가. 범위가 빈 글(모든 워크스페이스)이면 늘 안이다 */
export function folderInScope(folder: string, scope: string): boolean {
  return !scope || folder === scope || folder.startsWith(scope + "/");
}

/**
 * 칩 × 로 필터 하나를 지운 뒤 포커스를 옮길 태그 칩: 지운 칩 다음의 태그 칩. 없으면 null(검색 칸으로).
 * removed: 지운 태그, 폴더 칩이면 null(태그 칩들이 그 다음이다)
 */
export function chipAfterRemove(tags: string[], removed: string | null): string | null {
  const i = removed === null ? -1 : tags.indexOf(removed);
  return tags[i + 1] ?? null;
}

/** 검색 하나(검색어·폴더·태그 칩)를 가리키는 글. 펼친 결과는 이 글이 같은 동안만 펼쳐 둔다 */
export const searchKey = (query: string, f: SearchFilter) => JSON.stringify([query.trim(), f.folder, f.tags]);

/** 결과 목록에서 펼친 문서(경로)와 그것을 펼친 검색 */
export interface ExpandedHits {
  key: string;
  paths: ReadonlySet<string>;
}

export const NO_EXPANDED: ExpandedHits = { key: "", paths: new Set() };

/** 지금 검색에 맞춘 펼침: 검색어·필터가 바뀌었으면(다른 key) 비운다 — 같은 검색으로 돌아와도 접힌 채다. 그대로면 같은 객체 */
export const followSearch = (e: ExpandedHits, key: string): ExpandedHits => (e.key === key ? e : { key, paths: new Set() });

export function toggleExpanded(e: ExpandedHits, key: string, path: string, on: boolean): ExpandedHits {
  const paths = new Set(followSearch(e, key).paths);
  if (on) paths.add(path);
  else paths.delete(path);
  return { key, paths };
}

/**
 * 화면에 보일 일치 줄. 접혀 있으면 앞의 SEARCH_LINES_SHOWN 줄, 펼치면 받은 줄 전부.
 * more: 「N줄 더」의 N(접혀 있을 때 아직 안 보인 줄), beyond: 펼쳐도 응답에 없는 줄(서버 상한을 넘은 것).
 */
export function shownMatches(hit: SearchHit, expanded: boolean): { lines: SearchMatch[]; more: number; beyond: number } {
  const all = hit.matches ?? [];
  const total = Math.max(hit.matchCount ?? all.length, all.length);
  const lines = expanded ? all : all.slice(0, SEARCH_LINES_SHOWN);
  return { lines, more: expanded ? 0 : total - lines.length, beyond: expanded ? total - all.length : 0 };
}

/**
 * 그 줄로 갈 때 고를 글: 글 단어를 띄어 이은 것이 그 줄에 있으면 그것, 아니면 그 줄에 든 첫 단어.
 * 어느 것도 없으면(제목·경로로만 맞음) 고르지 않는다.
 */
export function selectionFor(query: string, snippet: string): string | undefined {
  const words = parseSearchQuery(query).text;
  if (words.length === 0) return undefined;
  const line = snippet.toLowerCase();
  const whole = words.join(" ");
  if (line.includes(whole.toLowerCase())) return whole;
  return words.find((w) => line.includes(w.toLowerCase()));
}
