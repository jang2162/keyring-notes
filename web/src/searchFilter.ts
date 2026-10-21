import { flattenNodes, parseSearchQuery, type SearchMatch, type VaultNode } from "@keyring-notes/core";
import type { SearchHit } from "./api";

/** 결과마다 처음 보이는 일치 줄 수. 나머지는 「N줄 더」로 편다 */
export const SEARCH_LINES_SHOWN = 3;

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
