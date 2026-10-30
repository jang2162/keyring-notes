import type { ChildSort } from "./childSort.js";

/** 색인된 문서 하나의 정보(검색·위젯·위키 목차가 쓴다). */
export interface DocMeta {
  path: string;
  title: string;
  summary: string;
  hash: string;
  mtime: number;
  size: number;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
}

export interface TaskRow {
  path: string;
  /** 1부터 시작하는 문서 전체 기준 줄 번호. */
  line: number;
  done: boolean;
  text: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  /** 문서 아이콘(프런트매터 icon) */
  icon?: string;
  /** 노트의 하위 정렬(프런트매터 sort, 맞는 값만) */
  sort?: ChildSort;
  /** 커스텀 순서 키(프런트매터 rank, 키 모양인 것만) */
  rank?: string;
  /** 수정 시각(ms): 프런트매터 edited, 없으면 파일 시각 */
  edited?: number;
}

/** 문서 사이 링크 한 줄. kind: 본문 위키링크(link) 또는 프런트매터 출처(source). */
export interface LinkRow {
  src: string;
  target: string;
  kind: "link" | "source";
}

/** 검색 결과 안의 일치 줄 하나 */
export interface SearchMatch {
  line: number;
  snippet: string;
}

export interface SearchHit {
  path: string;
  title: string;
  /** 첫 일치 줄(없으면 1) */
  line: number;
  snippet: string;
  /** 일치 줄들(앞에서부터, 검색 옵션 lines 만큼). lines 를 달라고 했을 때만 */
  matches?: SearchMatch[];
  /** 일치 줄의 전체 개수(matches 보다 많을 수 있다) */
  matchCount?: number;
}

export interface CommitInfo {
  rev: string;
  author: string;
  email: string;
  date: string;
  message: string;
}
