import { parseFrontmatter } from "@keyring-notes/core";
import { isAppField } from "./childSortUi";
import { panesOf, type Layout } from "./panes";

/**
 * 비어 있는 새 노트 지우기(docs/ops/ux.md 「비어 있는 새 노트를 닫으면 지운다」). 이 창에서 「새 노트」로 만든 노트를
 * 사람이 손대지 않고 닫으면 지운다. 여기 있는 것은 그 판정만 — 지우기는 Workspace.tsx 의 discardIfBlank.
 */

/**
 * 손대지 않은 노트 내용인가: 본문이 비었고(공백만 있어도 빈 것) 프런트매터가 없거나 앱이 적는 속성(isAppField)만 있다.
 * 프런트매터가 깨졌으면 사람이 쓴 것일 수 있으므로 비었다고 보지 않는다
 */
export function isBlankNote(content: string): boolean {
  const fm = parseFrontmatter(content);
  if (fm.error) return false;
  if (fm.data && Object.keys(fm.data).some((k) => !isAppField(k))) return false;
  return !content.split("\n").slice(fm.lines).join("\n").trim();
}

/** 노드 노트(A.md) 아래에 하위 노트·첨부(A/ 아래 파일)가 있는가 */
export function hasNodeChildren(notePath: string, paths: Iterable<string>): boolean {
  const prefix = notePath.replace(/\.md$/i, "") + "/";
  for (const p of paths) if (p.startsWith(prefix)) return true;
  return false;
}

/** 어느 범위(워크스페이스)의 어느 칸에든 탭으로 열려 있는가 */
export function openAnywhere(path: string, layouts: Iterable<Layout>): boolean {
  for (const l of layouts) if (panesOf(l).some((p) => p.tabs.includes(path))) return true;
  return false;
}

/**
 * 열어 본 문서 기록(뒤로·앞으로)에서 지운 노트를 뺀다. 빼서 붙게 된 같은 문서는 하나로 합치고,
 * 지금 자리(i)는 그 앞까지 남은 기록의 끝으로 옮긴다
 */
export function dropFromNav(nav: { list: string[]; i: number }, path: string): { list: string[]; i: number } {
  const list: string[] = [];
  let i = -1;
  nav.list.forEach((p, k) => {
    if (p !== path && p !== list[list.length - 1]) list.push(p);
    if (k === nav.i) i = list.length - 1;
  });
  return { list, i };
}

/** 닫혀서 지울지 볼 차례인가: 이 창에서 만든 노트이고(이름을 바꾸면 집합에서 빠진다) 이제 어느 칸에도 남지 않았다 */
export const closedForGood = (path: string, created: ReadonlySet<string>, layouts: Iterable<Layout>): boolean =>
  created.has(path) && !openAnywhere(path, layouts);
