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
}

/** 문서 사이 링크 한 줄. kind: 본문 위키링크(link) 또는 프런트매터 출처(source). */
export interface LinkRow {
  src: string;
  target: string;
  kind: "link" | "source";
}

export interface SearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface CommitInfo {
  rev: string;
  author: string;
  email: string;
  date: string;
  message: string;
}
