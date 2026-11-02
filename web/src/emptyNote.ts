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
  const lines = content.split("\n");
  // YAML 주석(줄 전체든 값 뒤든)은 데이터로 읽히지 않지만 사람이 쓴 글이다
  if (lines.slice(1, Math.max(1, fm.lines - 1)).some((l) => /(^|\s)#/.test(l))) return false;
  return !lines.slice(fm.lines).join("\n").trim();
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

/**
 * 이 창에서 「새 노트」로 만든 노트 중 아직 지울 수 있는 것(창마다 메모리, 새로 고치면 비워진다).
 * 들어오는 길은 둘이다 — 만듦, 제목 칸 입력을 Esc 로 취소(입력만으로 빠졌던 것이 돌아온다).
 * 나가는 길은 넷이다 — 사람이 손댐(제목 칸에 입력·이름 바꾸기·옮기기), 다른 창으로 넘김, 지워짐, 닫혀서 지울지 본 차례(한 번만 본다)
 */
export class CreatedNotes {
  private readonly paths = new Set<string>();
  /** 제목 칸에 입력한 것만으로 빠진 노트(만든 경로 그대로). Esc 로 원래 이름에 돌아가면 paths 로 돌아온다 */
  private readonly typing = new Set<string>();
  /** 「새 노트」로 만들었다 */
  created(path: string): void {
    this.paths.add(path);
  }
  /** 제목 칸에 입력했다 — 확정하지 않은 입력도 손댄 것이다. 이름 바꾸기가 실패해도 그대로다(Esc 로만 되돌린다) */
  typed(path: string): void {
    if (this.paths.delete(path)) this.typing.add(path);
  }
  /**
   * 제목 칸의 입력을 Esc 로 취소했다: 입력만으로 손댄 노트면 다시 지울 수 있다. 이름을 바꿨으면(경로가 바뀜)·옮겼으면·
   * 처음부터 만든 노트가 아니면 아무 일도 없다
   */
  untyped(path: string): void {
    if (this.typing.delete(path)) this.paths.add(path);
  }
  /** 사람이 손댔다(이름 바꾸기·옮기기) — 되돌리지 않는다 */
  touched(path: string): void {
    this.paths.delete(path);
    this.typing.delete(path);
  }
  /** 다른 창이 그 노트를 열었다(끌어서 새 창, 탭 메뉴 「새 창으로 열기」) — 이 창에서 탭을 닫아도 지우지 않는다 */
  handedOff(path: string): void {
    this.paths.delete(path);
    this.typing.delete(path);
  }
  /** 지운 노드 */
  forget(gone: (p: string) => boolean): void {
    for (const p of this.paths) if (gone(p)) this.paths.delete(p);
    for (const p of this.typing) if (gone(p)) this.typing.delete(p);
  }
  has(path: string): boolean {
    return this.paths.has(path);
  }
  /** 닫혀서 지울지 볼 차례면 집합에서 빼고 true(지우기가 실패해도 다시 보지 않는다) */
  take(path: string, layouts: Iterable<Layout>): boolean {
    if (!closedForGood(path, this.paths, layouts)) return false;
    this.paths.delete(path);
    return true;
  }
}
