import { isMarkdown } from "./paths.js";
import { inNode, moveNodePath, nodeNotePath, stripMd } from "./nodes.js";

/**
 * 휴지통의 한 줄: 한 번의 삭제(서버는 커밋 하나, 앱은 기록 하나)에서 지금 볼트에 없는 것.
 * 이동·이름 바꾸기로 사라진 옛 경로는 들지 않는다(새 자리에 있다). 같은 경로에 지금 파일이 있으면 그 파일은 뺀다.
 */
export interface TrashItem {
  /** 서버는 커밋, 앱은 기록 id */
  id: string;
  date: string;
  author: string;
  /** 묶음의 머리: 노드 삭제면 그 노드 경로(.md 없이), 노트 하나면 그 노트의 노드 경로. 서로 상관없는 여러 노트면 null */
  node: string | null;
  /** 되살릴 마크다운(머리 노트가 먼저, 나머지는 경로 순) */
  notes: string[];
  /** 되살릴 수 있는 첨부 */
  attachments: string[];
  /** 지웠지만 내용이 이력에 없어 되살릴 수 없는 첨부 수 */
  lost: number;
}

export interface TrashPage {
  items: TrashItem[];
  /** 「더 보기」에 넘길 값(더 없으면 null) */
  next: number | null;
}

/** 한 번에 읽는 묶음 수 기본값 */
export const TRASH_PAGE = 50;

/**
 * 한 번의 삭제에서 지운 파일(전부 — 지금 있는 것도)로 머리를 정한다.
 * - 노트 하나뿐이면 그 노트
 * - `N.md` 와 그 하위(`N/…`)만이면 노드 N
 * - 노트 없는 폴더 노드: 모두 한 폴더 아래이고 그 폴더가 지금 없으면(dirGone) 그 폴더
 * - 그 밖(서로 상관없는 여러 파일)은 null
 */
export function trashHead(deleted: string[], dirGone: (dir: string) => boolean): string | null {
  const md = deleted.filter(isMarkdown);
  if (md.length === 1 && deleted.length === 1) return stripMd(md[0]);
  for (const p of md) {
    const n = stripMd(p);
    if (deleted.every((q) => inNode(q, n))) return n;
  }
  const dirs = deleted.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""));
  let common = dirs[0] ?? "";
  for (const d of dirs)
    while (common && d !== common && !d.startsWith(common + "/")) common = common.includes("/") ? common.slice(0, common.lastIndexOf("/")) : "";
  return common && dirGone(common) ? common : null;
}

/** 되살릴 마크다운 순서: 머리 노트가 먼저, 나머지는 경로 순 */
export function trashOrder(notes: string[], node: string | null): string[] {
  const head = node ? nodeNotePath(node) : null;
  return [...notes].sort((a, b) => (a === head ? -1 : b === head ? 1 : a.localeCompare(b)));
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * 되살릴 자리. 지금 있는 파일(taken)과 겹치지 않으면(대소문자 무시 — macOS·Windows 는 같은 파일이다) 원래 경로 그대로.
 * 겹치면 덮어쓰지 않고 이름 뒤에 " 2", " 3"…을 붙인다(새 노트 이름 규칙과 같다: 노드 이름은 노트 `A.md` 와 폴더 `A/`가 모두 비어야 한다).
 * 머리 노드가 있으면 노드째(하위까지 같은 새 이름 아래로), 없으면 겹치는 파일만 하나씩.
 */
export function restoreTargets(paths: string[], node: string | null, taken: Iterable<string>): Map<string, string> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const take = (p: string) => {
    files.add(p.toLowerCase());
    for (let d = parentOf(p); d; d = parentOf(d)) dirs.add(d.toLowerCase());
  };
  for (const p of taken) take(p);
  const free = (p: string) => !files.has(p.toLowerCase());
  const out = new Map(paths.map((p) => [p, p]));
  if (paths.every(free)) return out;
  if (node && paths.every((p) => inNode(p, node))) {
    for (let i = 2; ; i++) {
      const root = `${node} ${i}`;
      if (!free(nodeNotePath(root)) || dirs.has(root.toLowerCase())) continue;
      const mapped = paths.map((p) => moveNodePath(p, node, root));
      if (!mapped.every(free)) continue;
      paths.forEach((p, k) => out.set(p, mapped[k]));
      return out;
    }
  }
  for (const p of paths) {
    if (free(p)) {
      take(p);
      continue;
    }
    const name = p.slice(parentOf(p).length ? parentOf(p).length + 1 : 0);
    const dot = isMarkdown(p) ? name.length - 3 : name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length;
    const stem = name.slice(0, dot);
    const ext = name.slice(dot);
    for (let i = 2; ; i++) {
      const q = join(parentOf(p), `${stem} ${i}${ext}`);
      if (free(q) && (!isMarkdown(q) || !dirs.has(stripMd(q).toLowerCase()))) {
        out.set(p, q);
        take(q);
        break;
      }
    }
  }
  return out;
}

/** 범위(워크스페이스) 안의 경로인지. folder 가 비면 전부 */
export function inTrashScope(path: string, folder: string): boolean {
  return !folder || path === nodeNotePath(folder) || path.startsWith(folder + "/");
}
