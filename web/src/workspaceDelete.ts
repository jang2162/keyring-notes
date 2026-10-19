import type { SettingPath, VaultSettings } from "@keyring-notes/core";

/**
 * 워크스페이스 삭제가 노드 삭제 말고 따로 걷는 것: 지금 워크스페이스(이 기기), 공통 설정의 워크스페이스별 설정·순서,
 * 이 기기의 칸 배치. 남겨 두면 같은 이름으로 다시 만든 워크스페이스가 지운 것의 설정·배치를 물려받는다.
 */

/** 지운 뒤 볼 워크스페이스: 지금 것을 지웠으면 남은 목록의 첫 번째(마지막 하나였으면 "" — 워크스페이스가 없는 첫 화면) */
export function workspaceAfterDelete(names: string[], current: string, removed: string): string {
  if (current !== removed) return current;
  return names.find((n) => n !== removed) ?? "";
}

/** 지우면서 걷은 공통 설정 값(되돌리기가 다시 넣는다) */
export interface WorkspaceRefs {
  settings?: VaultSettings["workspaces"][string];
  /** 순서에서의 자리(순서에 없었으면 -1) */
  orderIndex: number;
}

export function workspaceRefs(s: VaultSettings, name: string): WorkspaceRefs {
  const settings = s.workspaces[name];
  return { ...(settings ? { settings } : {}), orderIndex: s.workspaceOrder.indexOf(name) };
}

/** 공통 설정에서 그 워크스페이스를 가리키는 값을 지우는 바꿈 */
export function dropWorkspaceRefs(s: VaultSettings, name: string): [SettingPath, unknown][] {
  const out: [SettingPath, unknown][] = [];
  if (s.workspaces[name]) out.push([["workspaces", name], null]);
  if (s.workspaceOrder.includes(name)) out.push([["vault", "workspaceOrder"], s.workspaceOrder.filter((w) => w !== name)]);
  return out;
}

/** 되돌릴 때: 지운 뒤의 설정 s 에 걷은 값을 다시 넣는 바꿈(순서는 그 사이 바뀌었어도 원래 자리에 끼운다) */
export function restoreWorkspaceRefs(s: VaultSettings, name: string, saved: WorkspaceRefs): [SettingPath, unknown][] {
  const out: [SettingPath, unknown][] = [];
  if (saved.settings) out.push([["workspaces", name], saved.settings]);
  if (saved.orderIndex >= 0 && !s.workspaceOrder.includes(name)) {
    const order = [...s.workspaceOrder];
    order.splice(Math.min(saved.orderIndex, order.length), 0, name);
    out.push([["vault", "workspaceOrder"], order]);
  }
  return out;
}

/** 이 기기의 워크스페이스별 저장값(칸 배치 등)에서 그 워크스페이스의 것을 뺀다 */
export function dropWorkspaceLayout<T>(layouts: Record<string, T>, name: string): Record<string, T> {
  if (!(name in layouts)) return layouts;
  const out = { ...layouts };
  delete out[name];
  return out;
}
