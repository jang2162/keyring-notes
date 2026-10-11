/**
 * 가운데 칸 배치(좌우 최대 두 칸, 칸마다 탭). 범위(워크스페이스)마다 이 기기에 `keyring:panes` 로 기억한다.
 * 모든 연산은 입력을 바꾸지 않는 순수 함수다 — 화면 상태 갱신과 저장값 옮김을 같은 규칙으로 쓰고 vitest 로 고정한다.
 */
import { isRecordOf, isString, isStringArray } from "./stored";

export type ViewMode = "split" | "edit" | "preview";

export interface Pane {
  tabs: string[];
  active: string | null;
  mode: ViewMode;
}

/** panes 는 0~2개, 왼쪽이 [0]. focused 는 panes 범위 안(비면 0) */
export interface Layout {
  panes: Pane[];
  focused: number;
}

const MAX_PANES = 2;
/** 칸 하나의 최소 폭(px). 가운데가 두 칸을 담지 못하면 나누지 않는다 */
export const MIN_PANE_WIDTH = 280;

export const emptyLayout = (): Layout => ({ panes: [], focused: 0 });

const isViewMode = (v: unknown): v is ViewMode => v === "split" || v === "edit" || v === "preview";

const isPane = (v: unknown): v is Pane => {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return isStringArray(p.tabs) && (p.active === null || isString(p.active)) && isViewMode(p.mode);
};

export const isLayout = (v: unknown): v is Layout => {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  if (!Array.isArray(l.panes) || l.panes.length > MAX_PANES || !l.panes.every(isPane)) return false;
  if (typeof l.focused !== "number" || !Number.isInteger(l.focused)) return false;
  return l.panes.length === 0 ? l.focused === 0 : l.focused >= 0 && l.focused < l.panes.length;
};

export function fromTabs(tabs: string[], last: string | null, mode: ViewMode): Layout {
  if (tabs.length === 0) return emptyLayout();
  const active = last !== null && tabs.includes(last) ? last : tabs[tabs.length - 1];
  return { panes: [{ tabs: [...tabs], active, mode }], focused: 0 };
}

/** 옛 keyring:tabs / keyring:last-doc 원문 → 범위별 Layout. 둘 중 하나라도 모양이 틀리면 {} */
export function migrateLayouts(tabsRaw: string | null, lastRaw: string | null, mode: ViewMode): Record<string, Layout> {
  const tabs = parse(tabsRaw);
  const last = lastRaw === null ? {} : parse(lastRaw);
  if (!isRecordOf(isStringArray)(tabs) || !isRecordOf(isString)(last)) return {};
  const out: Record<string, Layout> = {};
  for (const [scope, paths] of Object.entries(tabs)) {
    const l = fromTabs(paths, last[scope] ?? null, mode);
    if (l.panes.length) out[scope] = l;
  }
  return out;
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const clampFocus = (panes: Pane[], focused: number): number => (panes.length === 0 ? 0 : Math.min(Math.max(focused, 0), panes.length - 1));

export function openIn(l: Layout, pane: number, path: string, opts: { newTab?: boolean; mode?: ViewMode } = {}): Layout {
  if (pane < 0 || pane >= MAX_PANES || pane > l.panes.length) return l;
  if (pane === l.panes.length) {
    const mode = opts.mode ?? l.panes[0]?.mode ?? "edit";
    return { panes: [...l.panes, { tabs: [path], active: path, mode }], focused: pane };
  }
  const p = l.panes[pane];
  let tabs: string[];
  if (p.tabs.includes(path)) tabs = p.tabs;
  else if (opts.newTab || p.active === null || !p.tabs.includes(p.active)) tabs = [...p.tabs, path];
  else tabs = p.tabs.map((t) => (t === p.active ? path : t));
  const panes = l.panes.map((q, i) => (i === pane ? { ...q, tabs, active: path } : q));
  return { panes, focused: pane };
}

export function closeIn(l: Layout, pane: number, path: string): Layout {
  const p = l.panes[pane];
  if (!p) return l;
  const i = p.tabs.indexOf(path);
  if (i < 0) return l;
  const rest = p.tabs.filter((t) => t !== path);
  if (rest.length === 0) {
    const panes = l.panes.filter((_, j) => j !== pane);
    const focused = l.focused > pane ? l.focused - 1 : l.focused;
    return { panes, focused: clampFocus(panes, focused) };
  }
  const active = p.active === path ? rest[Math.min(i, rest.length - 1)] : p.active;
  const panes = l.panes.map((q, j) => (j === pane ? { ...q, tabs: rest, active } : q));
  return { panes, focused: clampFocus(panes, l.focused) };
}

export function moveTab(l: Layout, from: number, to: number, path: string): Layout {
  if (from === to || !l.panes[from]?.tabs.includes(path)) return l;
  const closed = closeIn(l, from, path);
  const target = closed.panes.length < l.panes.length && to > from ? to - 1 : to;
  // 옮길 칸이 없으면(한 칸에서 둘째로) 새 칸을 만든다. 원래 칸의 보기 모드를 따른다
  return openIn(closed, Math.min(target, closed.panes.length), path, { newTab: true, mode: l.panes[from].mode });
}

export function mergePanes(l: Layout): Layout {
  if (l.panes.length < 2) return l;
  const [first, ...others] = l.panes;
  const tabs = [...first.tabs];
  for (const p of others) for (const t of p.tabs) if (!tabs.includes(t)) tabs.push(t);
  const active = l.panes[l.focused]?.active ?? first.active;
  return { panes: [{ ...first, tabs, active }], focused: 0 };
}

export function renamePath(l: Layout, from: string, to: string): Layout {
  if (!l.panes.some((p) => p.tabs.includes(from))) return l;
  const panes = l.panes.map((p) => {
    if (!p.tabs.includes(from)) return p;
    const tabs: string[] = [];
    for (const t of p.tabs) {
      const n = t === from ? to : t;
      if (!tabs.includes(n)) tabs.push(n);
    }
    return { ...p, tabs, active: p.active === from ? to : p.active };
  });
  return { ...l, panes };
}

export function removePaths(l: Layout, gone: (p: string) => boolean): Layout {
  let out = l;
  // 칸이 사라지면 인덱스가 당겨지므로 오른쪽 칸부터 닫는다
  for (let pane = l.panes.length - 1; pane >= 0; pane--) {
    for (const t of l.panes[pane].tabs) if (gone(t)) out = closeIn(out, pane, t);
  }
  return out;
}

export function setActive(l: Layout, pane: number, path: string): Layout {
  const p = l.panes[pane];
  if (!p || !p.tabs.includes(path) || p.active === path) return l;
  return { ...l, panes: l.panes.map((q, i) => (i === pane ? { ...q, active: path } : q)) };
}

export function setMode(l: Layout, pane: number, mode: ViewMode): Layout {
  const p = l.panes[pane];
  if (!p || p.mode === mode) return l;
  return { ...l, panes: l.panes.map((q, i) => (i === pane ? { ...q, mode } : q)) };
}

export function focusPane(l: Layout, pane: number): Layout {
  if (pane < 0 || pane >= l.panes.length || pane === l.focused) return l;
  return { ...l, focused: pane };
}

export function panesWith(l: Layout, path: string): number[] {
  const out: number[] = [];
  l.panes.forEach((p, i) => p.tabs.includes(path) && out.push(i));
  return out;
}

/** 둘째 칸을 열 수 있는가: 좁은 화면이 아니고 가운데 폭이 560 이상 */
export function canSplit(centerWidth: number, narrow: boolean): boolean {
  return !narrow && centerWidth >= MIN_PANE_WIDTH * 2;
}
