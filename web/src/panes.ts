/**
 * 가운데 칸 배치. 칸(잎)을 좌우(`row`)·위아래(`column`) 가지로 나눈 트리이고, 범위(워크스페이스)마다 이 기기에
 * `keyring:pane-tree` 로 기억한다. 칸은 위치가 아니라 안정된 id 로 가리킨다 — 나누고 닫을 때마다 위치가 바뀐다.
 * 모든 연산은 입력을 바꾸지 않는 순수 함수다 — 화면 상태 갱신과 저장값 옮김을 같은 규칙으로 쓰고 vitest 로 고정한다.
 */
import { isRecordOf, isString, isStringArray } from "./stored";

export type ViewMode = "split" | "edit" | "preview";
/** row: 자식을 왼쪽에서 오른쪽으로, column: 위에서 아래로 */
export type Dir = "row" | "column";
export type Side = "left" | "right" | "top" | "bottom";
export type DropZone = Side | "center";

export interface Pane {
  id: string;
  tabs: string[];
  active: string | null;
  mode: ViewMode;
}

/** 자식은 늘 둘 이상이다(하나 남으면 가지를 걷는다). sizes 는 자식마다의 비율, 합이 1 */
export interface Split {
  dir: Dir;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = Pane | Split;

/** focused 는 트리에 있는 칸의 id(비면 "") */
export interface Layout {
  root: LayoutNode | null;
  focused: string;
}

/** 칸 하나의 최소 폭(px). 나눈 절반이 이보다 좁아지면 나누지 않는다 */
export const MIN_PANE_WIDTH = 280;
/**
 * 칸 하나의 최소 높이(px): 본문 첫 줄이 칸 위에서 156(탭 바 38 + 문서 머리 40 + 아이콘·제목 칸 78) + 본문 세 줄(28×3) = 240.
 * 다시 재는 법: 넓은 화면(1400×900, 기본 글꼴)에서 한 칸에 노트를 열고 `.split-pane > .tabbar`·`.doc-head` 의 높이와
 * 첫 `.cm-line` 의 칸 기준 top, `.cm-line`(본문 줄) 높이를 getBoundingClientRect 로 본다
 */
export const MIN_PANE_HEIGHT = 240;

export const emptyLayout = (): Layout => ({ root: null, focused: "" });

export const isSplit = (n: LayoutNode): n is Split => "children" in n;

const isViewMode = (v: unknown): v is ViewMode => v === "split" || v === "edit" || v === "preview";

const isPaneFields = (p: Record<string, unknown>) => isStringArray(p.tabs) && (p.active === null || isString(p.active)) && isViewMode(p.mode);

function isNode(v: unknown, ids: Set<string>): v is LayoutNode {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  if ("children" in n) {
    if (n.dir !== "row" && n.dir !== "column") return false;
    if (!Array.isArray(n.children) || n.children.length < 2 || !Array.isArray(n.sizes) || n.sizes.length !== n.children.length) return false;
    if (!n.sizes.every((s) => typeof s === "number" && Number.isFinite(s) && s > 0)) return false;
    if (Math.abs((n.sizes as number[]).reduce((a, b) => a + b, 0) - 1) > 1e-3) return false;
    return n.children.every((c) => isNode(c, ids));
  }
  if (typeof n.id !== "string" || !n.id || ids.has(n.id) || !isPaneFields(n)) return false;
  ids.add(n.id);
  return true;
}

export function isLayout(v: unknown): v is Layout {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  if (typeof l.focused !== "string") return false;
  if (l.root === null) return l.focused === "";
  const ids = new Set<string>();
  return isNode(l.root, ids) && ids.has(l.focused);
}

/** 칸들(읽는 순서: 트리의 깊이 우선 — 위에서 아래, 왼쪽에서 오른쪽) */
export function panesOf(l: Layout): Pane[] {
  const out: Pane[] = [];
  const walk = (n: LayoutNode) => (isSplit(n) ? n.children.forEach(walk) : out.push(n));
  if (l.root) walk(l.root);
  return out;
}

export const paneOf = (l: Layout, id: string): Pane | undefined => panesOf(l).find((p) => p.id === id);

/** 새 칸 id: 배치 안의 가장 큰 번호 다음(배치 안에서만 유일하면 된다) */
export function nextPaneId(l: Layout): string {
  let max = 0;
  for (const p of panesOf(l)) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p${max + 1}`;
}

export function fromTabs(tabs: string[], last: string | null, mode: ViewMode): Layout {
  if (tabs.length === 0) return emptyLayout();
  const active = last !== null && tabs.includes(last) ? last : tabs[tabs.length - 1];
  return { root: { id: "p1", tabs: [...tabs], active, mode }, focused: "p1" };
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** 옛 keyring:tabs / keyring:last-doc 원문 → 범위별 Layout. 둘 중 하나라도 모양이 틀리면 {} */
export function migrateLayouts(tabsRaw: string | null, lastRaw: string | null, mode: ViewMode): Record<string, Layout> {
  const tabs = parse(tabsRaw);
  const last = lastRaw === null ? {} : parse(lastRaw);
  if (!isRecordOf(isStringArray)(tabs) || !isRecordOf(isString)(last)) return {};
  const out: Record<string, Layout> = {};
  for (const [scope, paths] of Object.entries(tabs)) {
    const l = fromTabs(paths, last[scope] ?? null, mode);
    if (l.root) out[scope] = l;
  }
  return out;
}

interface LegacyPane {
  tabs: string[];
  active: string | null;
  mode: ViewMode;
}
interface LegacyLayout {
  panes: LegacyPane[];
  focused: number;
}

const isLegacyLayout = (v: unknown): v is LegacyLayout => {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  if (!Array.isArray(l.panes) || l.panes.length > 2 || !l.panes.every((p) => typeof p === "object" && p !== null && isPaneFields(p))) return false;
  if (typeof l.focused !== "number" || !Number.isInteger(l.focused)) return false;
  return l.panes.length === 0 ? l.focused === 0 : l.focused >= 0 && l.focused < l.panes.length;
};

/**
 * 옛 keyring:panes(좌우 0~2칸) 원문 → 범위별 Layout. 두 칸이면 row 가지 하나, 비율은 옛 분할 비율(prefs.splitRatio).
 * 저장값이 없으면 null(더 옛 저장값을 옮길 차례), 모양이 틀리면 {}
 */
export function migrateLegacyPanes(raw: string | null, ratio: number): Record<string, Layout> | null {
  if (raw === null) return null;
  const v = parse(raw);
  if (!isRecordOf(isLegacyLayout)(v)) return {};
  const r = ratio > 0 && ratio < 1 ? ratio : 0.5;
  const out: Record<string, Layout> = {};
  for (const [scope, l] of Object.entries(v)) {
    const panes = l.panes.map((p, i): Pane => ({ id: `p${i + 1}`, tabs: [...p.tabs], active: p.active, mode: p.mode }));
    if (!panes.length) continue;
    const focused = panes[l.focused].id;
    out[scope] = panes.length === 1 ? { root: panes[0], focused } : { root: { dir: "row", children: panes, sizes: [r, 1 - r] }, focused };
  }
  return out;
}

/** 칸 하나를 바꾼다(fn 이 같은 것을 돌려주면 배치도 그대로) */
function updatePane(l: Layout, id: string, fn: (p: Pane) => Pane): Layout {
  const walk = (n: LayoutNode): LayoutNode => {
    if (!isSplit(n)) return n.id === id ? fn(n) : n;
    const children = n.children.map(walk);
    return children.every((c, i) => c === n.children[i]) ? n : { ...n, children };
  };
  if (!l.root) return l;
  const root = walk(l.root);
  return root === l.root ? l : { ...l, root };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/**
 * 칸 하나를 뺀다. 가지가 자식 하나만 남으면 걷어 남은 자식을 부모에 붙이고, 그 자식이 부모와 같은 방향 가지면 부모에 펼쳐 넣는다.
 * 빠진 칸의 비율은 남은 형제들이 비율대로 나눠 갖는다
 */
function without(n: LayoutNode, id: string): LayoutNode | null {
  if (!isSplit(n)) return n.id === id ? null : n;
  const kept: { node: LayoutNode; size: number }[] = [];
  n.children.forEach((c, i) => {
    const next = without(c, id);
    if (next) kept.push({ node: next, size: n.sizes[i] });
  });
  if (kept.length === n.children.length && kept.every((k, i) => k.node === n.children[i])) return n;
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].node;
  const total = sum(kept.map((k) => k.size));
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  for (const k of kept) {
    const s = k.size / total;
    if (isSplit(k.node) && k.node.dir === n.dir) {
      k.node.children.forEach((c, i) => {
        children.push(c);
        sizes.push(s * (k.node as Split).sizes[i]);
      });
    } else {
      children.push(k.node);
      sizes.push(s);
    }
  }
  return { dir: n.dir, children, sizes };
}

/** 칸을 뺀다. 포커스가 그 칸이었으면 읽는 순서로 바로 앞 칸(맨 앞이었으면 다음 칸) */
export function removePane(l: Layout, id: string): Layout {
  if (!l.root) return l;
  const before = panesOf(l).map((p) => p.id);
  const i = before.indexOf(id);
  if (i < 0) return l;
  const root = without(l.root, id);
  if (!root) return emptyLayout();
  const rest = before.filter((x) => x !== id);
  return { root, focused: l.focused === id ? rest[Math.max(i - 1, 0)] : l.focused };
}

/**
 * 탭 열기. 빈 배치면 첫 칸을 만든다(보기 모드는 opts.mode). 그 칸에 이미 있으면 활성만 바꾸고,
 * newTab 이거나 활성 탭이 없으면 뒤에 붙이고, 아니면 활성 탭 자리를 바꿔친다. 결과의 포커스는 그 칸
 */
export function openIn(l: Layout, id: string, path: string, opts: { newTab?: boolean; mode?: ViewMode } = {}): Layout {
  if (!l.root) {
    const pid = nextPaneId(l);
    return { root: { id: pid, tabs: [path], active: path, mode: opts.mode ?? "edit" }, focused: pid };
  }
  if (!paneOf(l, id)) return l;
  const next = updatePane(l, id, (p) => {
    let tabs: string[];
    if (p.tabs.includes(path)) tabs = p.tabs;
    else if (opts.newTab || p.active === null || !p.tabs.includes(p.active)) tabs = [...p.tabs, path];
    else tabs = p.tabs.map((t) => (t === p.active ? path : t));
    return tabs === p.tabs && p.active === path ? p : { ...p, tabs, active: path };
  });
  return next.focused === id ? next : { ...next, focused: id };
}

export function closeIn(l: Layout, id: string, path: string): Layout {
  const p = paneOf(l, id);
  if (!p) return l;
  const i = p.tabs.indexOf(path);
  if (i < 0) return l;
  const rest = p.tabs.filter((t) => t !== path);
  if (rest.length === 0) return removePane(l, id);
  const active = p.active === path ? rest[Math.min(i, rest.length - 1)] : p.active;
  return updatePane(l, id, (q) => ({ ...q, tabs: rest, active }));
}

const axisOf = (side: Side): Dir => (side === "left" || side === "right" ? "row" : "column");

/**
 * 칸 target 의 side 쪽에 path 하나를 연 새 칸을 만든다(포커스는 새 칸, 보기 모드는 mode 또는 target 의 것).
 * target 이 같은 방향 가지 안에 있으면 그 가지에 자식을 더하고 target 의 비율을 반으로 나눠 준다(Zed 와 같다).
 * 아니면 target 자리를 [target, 새 칸] 가지로 바꾼다
 */
export function splitPane(l: Layout, target: string, side: Side, path: string, mode?: ViewMode): Layout {
  const t = paneOf(l, target);
  if (!t || !l.root) return l;
  const id = nextPaneId(l);
  const fresh: Pane = { id, tabs: [path], active: path, mode: mode ?? t.mode };
  const dir = axisOf(side);
  const before = side === "left" || side === "top";
  const walk = (n: LayoutNode): LayoutNode => {
    if (!isSplit(n)) return n.id === target ? { dir, children: before ? [fresh, n] : [n, fresh], sizes: [0.5, 0.5] } : n;
    const i = n.children.findIndex((c) => !isSplit(c) && c.id === target);
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i] / 2;
      const at = before ? i : i + 1;
      const children = [...n.children];
      children.splice(at, 0, fresh);
      const sizes = [...n.sizes];
      sizes.splice(i, 1, half, half);
      return { ...n, children, sizes };
    }
    const children = n.children.map(walk);
    return children.every((c, j) => c === n.children[j]) ? n : { ...n, children };
  };
  return { root: walk(l.root), focused: id };
}

/** 탭을 다른 칸으로 옮긴다(그 칸의 새 탭). 원래 칸이 비면 빠진다 */
export function moveTab(l: Layout, from: string, to: string, path: string): Layout {
  if (from === to || !paneOf(l, from)?.tabs.includes(path) || !paneOf(l, to)) return l;
  return openIn(closeIn(l, from, path), to, path, { newTab: true });
}

/**
 * 끌던 탭을 칸 target 에 놓았을 때. 가운데면 그 칸의 탭으로 옮기고, 가장자리면 그쪽에 새 칸을 만든다.
 * 같은 칸의 가장자리에 놓으면 그 탭을 떼어 나누되, 탭이 하나뿐이면 그대로(뗄 것이 없다)
 */
export function dropTab(l: Layout, from: string, path: string, target: string, zone: DropZone): Layout {
  const src = paneOf(l, from);
  if (!src?.tabs.includes(path) || !paneOf(l, target)) return l;
  if (zone === "center") return moveTab(l, from, target, path);
  if (from === target && src.tabs.length < 2) return l;
  return splitPane(closeIn(l, from, path), target, zone, path, src.mode);
}

/** 모든 칸을 하나로: 읽는 순서로 탭을 중복 없이 이어 붙이고 포커스 칸의 활성을 지킨다 */
export function mergePanes(l: Layout): Layout {
  const panes = panesOf(l);
  if (panes.length < 2) return l;
  const tabs: string[] = [];
  for (const p of panes) for (const t of p.tabs) if (!tabs.includes(t)) tabs.push(t);
  const first = panes[0];
  const active = paneOf(l, l.focused)?.active ?? first.active;
  return { root: { ...first, tabs, active }, focused: first.id };
}

export function renamePath(l: Layout, from: string, to: string): Layout {
  let out = l;
  for (const p of panesOf(l)) {
    if (!p.tabs.includes(from)) continue;
    const tabs: string[] = [];
    for (const t of p.tabs) {
      const n = t === from ? to : t;
      if (!tabs.includes(n)) tabs.push(n);
    }
    out = updatePane(out, p.id, (q) => ({ ...q, tabs, active: q.active === from ? to : q.active }));
  }
  return out;
}

export function removePaths(l: Layout, gone: (p: string) => boolean): Layout {
  let out = l;
  for (const p of panesOf(l)) for (const t of p.tabs) if (gone(t)) out = closeIn(out, p.id, t);
  return out;
}

export function setActive(l: Layout, id: string, path: string): Layout {
  return updatePane(l, id, (p) => (!p.tabs.includes(path) || p.active === path ? p : { ...p, active: path }));
}

/** 탭은 그대로 두고 그 칸에서 보던 문서만 내린다(홈을 보인다) */
export function clearActive(l: Layout, id: string): Layout {
  return updatePane(l, id, (p) => (p.active === null ? p : { ...p, active: null }));
}

export function setMode(l: Layout, id: string, mode: ViewMode): Layout {
  return updatePane(l, id, (p) => (p.mode === mode ? p : { ...p, mode }));
}

export function focusPane(l: Layout, id: string): Layout {
  return id === l.focused || !paneOf(l, id) ? l : { ...l, focused: id };
}

/** id 가 아닌 칸 중 그 문서를 보고 있는(활성 탭인) 칸. 없으면 null */
export function otherPaneShowing(l: Layout, id: string, path: string): string | null {
  return panesOf(l).find((p) => p.id !== id && p.active === path)?.id ?? null;
}

export function panesWith(l: Layout, path: string): string[] {
  return panesOf(l)
    .filter((p) => p.tabs.includes(path))
    .map((p) => p.id);
}

/** 「다른 칸」: 읽는 순서로 다음 칸(끝이면 처음). 칸이 하나면 null */
export function otherPaneOf(l: Layout, id: string): string | null {
  const panes = panesOf(l);
  const i = panes.findIndex((p) => p.id === id);
  return panes.length < 2 || i < 0 ? null : panes[(i + 1) % panes.length].id;
}

/** 루트에서 at(자식 번호들)을 따라 내려간 노드. 길이 틀리면 거기서 멈춘 노드 */
export function nodeAt(root: LayoutNode, at: number[]): LayoutNode {
  let n = root;
  for (const i of at) {
    if (!isSplit(n) || !n.children[i]) break;
    n = n.children[i];
  }
  return n;
}

/** 가지 하나의 비율을 바꾼다. at 은 루트에서 그 가지까지 자식 번호(루트 가지면 []) */
export function setSizes(l: Layout, at: number[], sizes: number[]): Layout {
  const walk = (n: LayoutNode, depth: number): LayoutNode => {
    if (!isSplit(n)) return n;
    if (depth === at.length) return sizes.length === n.children.length ? { ...n, sizes } : n;
    const i = at[depth];
    const c = n.children[i];
    if (!c) return n;
    const next = walk(c, depth + 1);
    return next === c ? n : { ...n, children: n.children.map((x, j) => (j === i ? next : x)) };
  };
  if (!l.root) return l;
  const root = walk(l.root, 0);
  return root === l.root ? l : { ...l, root };
}

/**
 * 경계 끌기: i 번째와 i+1 번째 자식의 비율을 delta 만큼 옮긴다. 둘의 합은 지키고 각자 최소(minA·minB, 비율)를 넘지 않는다.
 * 둘 다 최소를 지킬 자리가 없으면 그대로
 */
export function dragSizes(sizes: number[], i: number, delta: number, minA: number, minB: number): number[] {
  const total = sizes[i] + sizes[i + 1];
  if (minA + minB > total) return sizes;
  const a = Math.min(Math.max(sizes[i] + delta, minA), total - minB);
  if (a === sizes[i]) return sizes;
  const out = [...sizes];
  out[i] = a;
  out[i + 1] = total - a;
  return out;
}

/** 칸 하나가 이 방향(row 면 폭, column 이면 높이)으로 가져야 하는 최소 px */
export function minExtent(n: LayoutNode, dir: Dir): number {
  if (!isSplit(n)) return dir === "row" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  const each = n.children.map((c) => minExtent(c, dir));
  return n.dir === dir ? sum(each) : Math.max(...each);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 칸마다 단위 사각형(가운데 전체가 0~1) 안의 자리. 비율로만 계산한다 */
export function rectsOf(l: Layout): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  const walk = (n: LayoutNode, r: Rect) => {
    if (!isSplit(n)) {
      out[n.id] = r;
      return;
    }
    let at = 0;
    n.children.forEach((c, i) => {
      const s = n.sizes[i];
      walk(c, n.dir === "row" ? { x: r.x + r.w * at, y: r.y, w: r.w * s, h: r.h } : { x: r.x, y: r.y + r.h * at, w: r.w, h: r.h * s });
      at += s;
    });
  };
  if (l.root) walk(l.root, { x: 0, y: 0, w: 1, h: 1 });
  return out;
}

export interface SplitHandle {
  /** 루트에서 그 가지까지 자식 번호(setSizes 의 at) */
  at: number[];
  /** 이 손잡이의 왼쪽(위쪽) 자식 번호. 손잡이는 i 와 i+1 사이 */
  i: number;
  dir: Dir;
  /** 그 가지 전체의 단위 사각형 */
  rect: Rect;
  /** 경계의 자리: row 면 x, column 이면 y(단위 사각형 안) */
  pos: number;
}

/** 이웃한 자식 사이의 경계 손잡이들(가지마다 자식 수 - 1개) */
export function handlesOf(l: Layout): SplitHandle[] {
  const out: SplitHandle[] = [];
  const walk = (n: LayoutNode, r: Rect, at: number[]) => {
    if (!isSplit(n)) return;
    let acc = 0;
    n.children.forEach((c, i) => {
      const s = n.sizes[i];
      const cr = n.dir === "row" ? { x: r.x + r.w * acc, y: r.y, w: r.w * s, h: r.h } : { x: r.x, y: r.y + r.h * acc, w: r.w, h: r.h * s };
      acc += s;
      if (i < n.children.length - 1) out.push({ at, i, dir: n.dir, rect: r, pos: n.dir === "row" ? r.x + r.w * acc : r.y + r.h * acc });
      walk(c, cr, [...at, i]);
    });
  };
  if (l.root) walk(l.root, { x: 0, y: 0, w: 1, h: 1 }, []);
  return out;
}

const EPS = 1e-6;

/** side 쪽으로 맞닿은 이웃 칸. 여럿이면 지금 칸의 가운데 줄을 품는 칸, 그런 칸이 없으면 가장 많이 겹치는 칸 */
export function neighborOf(l: Layout, id: string, side: Side): string | null {
  const rects = rectsOf(l);
  const r = rects[id];
  if (!r) return null;
  const horizontal = side === "left" || side === "right";
  const mid = horizontal ? r.y + r.h / 2 : r.x + r.w / 2;
  let best: { id: string; contains: boolean; overlap: number } | null = null;
  for (const [oid, o] of Object.entries(rects)) {
    if (oid === id) continue;
    const touches =
      side === "left"
        ? Math.abs(o.x + o.w - r.x) < EPS
        : side === "right"
          ? Math.abs(r.x + r.w - o.x) < EPS
          : side === "top"
            ? Math.abs(o.y + o.h - r.y) < EPS
            : Math.abs(r.y + r.h - o.y) < EPS;
    if (!touches) continue;
    const [a0, a1, b0, b1] = horizontal ? [r.y, r.y + r.h, o.y, o.y + o.h] : [r.x, r.x + r.w, o.x, o.x + o.w];
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap <= EPS) continue;
    // 가운데 줄이 두 칸의 경계에 정확히 걸치면 둘 다 품는다 — 그때는 읽는 순서로 먼저 오는(위·왼쪽) 칸
    const contains = mid >= b0 - EPS && mid <= b1 + EPS;
    if (!best || (contains && !best.contains) || (contains === best.contains && overlap > best.overlap + EPS)) best = { id: oid, contains, overlap };
  }
  return best?.id ?? null;
}

/** 크기가 w×h 인 칸을 side 쪽으로 나눌 수 있는가: 나눈 절반이 최소보다 작지 않고 좁은 화면이 아니다 */
export function canSplitRect(w: number, h: number, side: Side, narrow: boolean): boolean {
  if (narrow) return false;
  return axisOf(side) === "row" ? w >= MIN_PANE_WIDTH * 2 : h >= MIN_PANE_HEIGHT * 2;
}

/** 끌던 탭을 놓을 자리: 칸 안의 포인터 위치(x, y)에서 가장 가까운 가장자리가 1/4 안이면 그 가장자리, 아니면 가운데 */
export function dropZone(x: number, y: number, w: number, h: number, allowed: (s: Side) => boolean): DropZone {
  if (w <= 0 || h <= 0) return "center";
  const d: [Side, number][] = [
    ["left", x / w],
    ["right", 1 - x / w],
    ["top", y / h],
    ["bottom", 1 - y / h],
  ];
  let best: [Side, number] | null = null;
  for (const e of d) if (allowed(e[0]) && e[1] < 0.25 && (!best || e[1] < best[1])) best = e;
  return best?.[0] ?? "center";
}

/** 가운데가 이보다 좁아지면 오른쪽 패널을 붙이지 않고 띄운다: 문서 머리의 도구 단추와 탭 하나가 들어가는 폭 */
export const MIN_CENTER_WIDTH = 440;

/**
 * 오른쪽 패널을 가운데 위에 띄울까. 레일·왼쪽 패널·오른쪽 패널을 다 붙이면 가운데가 MIN_CENTER_WIDTH 보다 좁아질 때다.
 * 가운데 폭(측정값)이 아니라 창 폭으로 계산한다 — 띄우면 가운데가 넓어지므로, 측정값으로 고르면 붙였다 띄웠다를 되풀이한다
 */
export function rightPanelFloats(viewport: number, docked: { rail: number; left: number; right: number }): boolean {
  return viewport - docked.rail - docked.left - docked.right < MIN_CENTER_WIDTH;
}

/**
 * 칸에 실제로 보일 보기 모드. 과거 판은 늘 미리보기다.
 * 좁은 화면은 두 쪽을 나란히 놓을 폭이 없어 나란히 보기를 편집으로 보인다(편집 칸을 숨기면 칠 곳이 없어진다)
 */
export function shownModeOf(mode: ViewMode, opts: { revision: boolean; narrow: boolean }): ViewMode {
  if (opts.revision) return "preview";
  return opts.narrow && mode === "split" ? "edit" : mode;
}
