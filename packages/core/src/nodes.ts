import { isVaultSettingsPath } from "./settings.js";
import type { TreeNode } from "./types.js";

/**
 * 노드 = 노트이자 디렉토리(SiYuan·Notion처럼). 파일 구조는 형제 방식이다.
 *
 *   업무.md          ← 업무 노드의 노트
 *   업무/            ← 업무 노드의 하위
 *     프로젝트A.md   ← 하위 노드(잎 노드는 폴더 없음)
 *
 * - 짝짓기는 같은 부모 안에서 이름이 정확히 같을 때만(`A.md` ↔ `A/`, 대소문자가 다르면 다른 노드).
 * - 노트 없는 폴더(`A/`만 있음)는 내용이 빈 노드로 보이고, 내용을 쓰면 그때 `A.md`를 만든다.
 * - 노드 폴더 안의 마크다운이 아닌 파일은 노드가 아니라 그 노드의 첨부로 접어 보인다.
 * - 볼트 루트의 노드는 워크스페이스다(공통 설정 파일은 빼고).
 */
export interface VaultNode {
  /** 노드 이름(확장자 없이) */
  name: string;
  /** 노드 경로(확장자 없이, 예: 업무/프로젝트A) */
  path: string;
  /** 노드 노트 경로(`<path>.md`). 노트 없는 폴더면 null */
  note: string | null;
  /** 하위 폴더(`<path>/`)가 있는지 */
  dir: boolean;
  children: VaultNode[];
  /** 노드 폴더 바로 안의 마크다운이 아닌 파일 */
  attachments: string[];
  /** 노트의 icon 속성(트리 응답에 붙은 것) */
  icon?: string;
}

export const stripMd = (p: string) => p.replace(/\.md$/i, "");

/** 경로(문서 `A/B.md` 또는 폴더 `A/B`)의 노드 경로 */
export function nodePathOf(path: string): string {
  return stripMd(path.replace(/\/+$/, ""));
}

/** 노드 노트 경로 */
export const nodeNotePath = (node: string) => `${node}.md`;

/** 이 경로가 노드(노트 + 하위 전체)에 드는지 */
export function inNode(path: string, node: string): boolean {
  return path === nodeNotePath(node) || path.startsWith(node + "/");
}

/** 노드에 드는 파일(노트 `A.md`와 `A/` 아래 전체) */
export function nodeFiles(node: string, paths: Iterable<string>): string[] {
  const out: string[] = [];
  for (const p of paths) if (inNode(p, node)) out.push(p);
  return out.sort();
}

/** 노드를 옮길 때 파일마다 새 경로(이름 바꾸기도 같다) */
export function moveNodePath(path: string, from: string, to: string): string {
  if (path === nodeNotePath(from)) return nodeNotePath(to);
  if (path.startsWith(from + "/")) return to + path.slice(from.length);
  return path;
}

/** 상위 노드 경로(맨 위면 "") */
export const parentNode = (node: string) => (node.includes("/") ? node.slice(0, node.lastIndexOf("/")) : "");

/** 워크스페이스 이름(볼트 루트 노드). 공통 설정 파일과 루트의 첨부는 어느 워크스페이스에도 들지 않는다 */
export function workspaceOf(path: string): string | null {
  if (!path || isVaultSettingsPath(path)) return null;
  const i = path.indexOf("/");
  if (i >= 0) return path.slice(0, i);
  return /\.md$/i.test(path) ? stripMd(path) : null;
}

/** 같은 워크스페이스인지(둘 다 워크스페이스 밖이면 같은 것으로 본다) */
export const sameWorkspace = (a: string, b: string) => workspaceOf(a) === workspaceOf(b);

/** 워크스페이스 안의 노드 경로 → 워크스페이스 기준 상대 경로 */
export function inWorkspace(path: string, ws: string): boolean {
  return path === nodeNotePath(ws) || path.startsWith(ws + "/");
}

export interface NodeTreeOptions {
  /** 트리에서 아예 빼는 파일·폴더(공통 설정 파일·워크스페이스 첨부 폴더·자동 생성 문서 등) */
  hidden?: (path: string, type: "dir" | "file") => boolean;
}

/**
 * 파일 트리(폴더·파일) → 노드 트리. 형제 `A.md`·`A/`를 한 노드로 짝짓고, 노드 폴더 안의 첨부는 그 노드에 붙인다.
 * 정렬은 이름순(부르는 쪽이 데일리 폴더 등을 다시 정렬한다).
 */
export function buildNodeTree(tree: TreeNode[], opts: NodeTreeOptions = {}): VaultNode[] {
  const hidden = opts.hidden ?? (() => false);
  const walk = (nodes: TreeNode[], parent: VaultNode | null): VaultNode[] => {
    const byName = new Map<string, VaultNode>();
    const get = (name: string, path: string) => {
      let n = byName.get(name);
      if (!n) {
        n = { name, path, note: null, dir: false, children: [], attachments: [] };
        byName.set(name, n);
      }
      return n;
    };
    for (const t of nodes) {
      if (hidden(t.path, t.type)) continue;
      if (t.type === "dir") {
        const n = get(t.name, t.path);
        n.dir = true;
        n.children = walk(t.children ?? [], n);
      } else if (/\.md$/i.test(t.name)) {
        const n = get(stripMd(t.name), stripMd(t.path));
        n.note = t.path;
        if (t.icon) n.icon = t.icon;
      } else if (parent) {
        parent.attachments.push(t.path);
      }
      // 볼트 루트의 첨부는 어느 노드에도 들지 않는다(트리에 보이지 않는다)
    }
    // 노트 없는 폴더 안의 하위가 모두 숨김이면(빈 폴더) 그 노드도 뺀다
    const out = [...byName.values()].filter((n) => n.note !== null || n.children.length > 0 || n.attachments.length > 0);
    return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  };
  return walk(tree, null);
}

/** 노드 트리를 펼친 목록(깊이 우선) */
export function flattenNodes(nodes: VaultNode[]): VaultNode[] {
  const out: VaultNode[] = [];
  const walk = (ns: VaultNode[]) => {
    for (const n of ns) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** 노드 하나 찾기 */
export function findNode(nodes: VaultNode[], path: string): VaultNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (path.startsWith(n.path + "/")) return findNode(n.children, path);
  }
  return null;
}

/** 워크스페이스 목록(볼트 루트의 노드, 공통 설정 파일 제외) */
export function workspacesOf(tree: TreeNode[]): string[] {
  const out = new Set<string>();
  for (const t of tree) {
    if (t.type === "dir") out.add(t.name);
    else if (/\.md$/i.test(t.name) && !isVaultSettingsPath(t.path)) out.add(stripMd(t.name));
  }
  return [...out].sort((a, b) => a.localeCompare(b, "ko"));
}

/** 하위 노드까지 센 수(삭제 확인용): 노드 노트·하위 노드 수와 첨부 수 */
export function countNode(node: VaultNode): { nodes: number; attachments: number } {
  let nodes = 0;
  let attachments = node.attachments.length;
  for (const c of flattenNodes(node.children)) {
    nodes++;
    attachments += c.attachments.length;
  }
  return { nodes, attachments };
}
