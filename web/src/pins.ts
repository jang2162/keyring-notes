import { useEffect, useState } from "react";
import { readStored, isStringArray } from "./stored";

/**
 * 고정(즐겨찾기)한 노드 목록. 이 기기(localStorage `keyring:pins`)에만 둔다 — 이 파일 밖에서 그 키를 읽고 쓰지 않는다.
 * 공통 설정 파일(keyring-settings.md)에 두지 않는 까닭: 볼트 전체 읽기 권한에 거부 예외를 둔 에이전트도 그 파일을 읽을 수 있어,
 * 숨김 노드를 고정하면 그 경로 이름이 에이전트에게 샌다(ux.md 13번).
 *
 * 값은 노드 경로(`.md` 없이, 볼트 기준)를 고정한 순서대로 둔 목록 하나다. 경로의 첫 마디가 워크스페이스라
 * 워크스페이스마다 따로 보이고, 노드를 다른 워크스페이스로 옮기면 고정도 따라간다.
 * 지운 노드는 목록에서 걷지 않고 화면에서만 숨긴다 — 되돌리기·휴지통으로 같은 자리에 되살리면 다시 보인다.
 */
const KEY = "keyring:pins";

/** 노드 경로 → 그 노드를 고정 목록에 넣은 것(이미 있으면 그 자리 그대로) */
export function addPin(pins: string[], node: string): string[] {
  return pins.includes(node) ? pins : [...pins, node];
}

export function removePin(pins: string[], node: string): string[] {
  return pins.includes(node) ? pins.filter((p) => p !== node) : pins;
}

/**
 * 노드 from 을 to 로 옮기거나 이름을 바꾼 뒤: from 을(subtree 면 그 하위도) 가리키던 고정을 새 경로로 바꾼다.
 * 노트 파일 하나만 옮긴 것(데일리 형식 옮기기 등)은 subtree 를 끈다 — 그 노드의 하위 폴더는 그 자리에 남는다.
 * 옮긴 자리에 이미 고정이 있으면(같은 경로) 앞의 것 하나만 남긴다
 */
export function movePins(pins: string[], from: string, to: string, subtree = true): string[] {
  if (from === to) return pins;
  let changed = false;
  const next = pins.map((p) => {
    if (p === from) return ((changed = true), to);
    if (subtree && p.startsWith(from + "/")) return ((changed = true), to + p.slice(from.length));
    return p;
  });
  return changed ? [...new Set(next)] : pins;
}

/** 워크스페이스 삭제 때 걷은 고정(되돌리기가 원래 자리에 다시 넣는다) */
export type SavedPins = { node: string; index: number }[];

const inWorkspace = (node: string, ws: string) => node === ws || node.startsWith(ws + "/");

/** 그 워크스페이스의 고정을 걷는다 */
export function dropWorkspacePins(pins: string[], ws: string): { pins: string[]; saved: SavedPins } {
  const saved: SavedPins = [];
  pins.forEach((node, index) => inWorkspace(node, ws) && saved.push({ node, index }));
  return { pins: saved.length ? pins.filter((p) => !inWorkspace(p, ws)) : pins, saved };
}

/** 걷은 고정을 원래 자리에 다시 넣는다(그 사이 같은 것을 다시 고정했으면 그대로 둔다) */
export function restoreWorkspacePins(pins: string[], saved: SavedPins): string[] {
  const out = [...pins];
  for (const { node, index } of saved) if (!out.includes(node)) out.splice(Math.min(index, out.length), 0, node);
  return out;
}

/** 화면에 보일 고정: 지금 있는 노드 중 지금 범위(워크스페이스)에 드는 것 */
export function shownPins(pins: string[], exists: (node: string) => boolean, inScope: (node: string) => boolean): string[] {
  return pins.filter((p) => inScope(p) && exists(p));
}

function load(): string[] {
  try {
    return readStored(localStorage.getItem(KEY), [], isStringArray);
  } catch {
    return [];
  }
}

const listeners = new Set<(pins: string[]) => void>();

/** 고정 목록을 바꾼다. 이 창이 들고 있는 값이 아니라 저장소의 지금 값에서 고친다 — 다른 창·탭이 바꾼 것을 덮지 않게 */
export function updatePins(fn: (pins: string[]) => string[]): void {
  const before = load();
  const next = fn(before);
  if (next === before) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장소를 못 쓰는 환경: 이 창에서만 */
  }
  for (const l of listeners) l(next);
}

export function getPins(): string[] {
  return load();
}

/** 고정 목록(다른 창·탭에서 바꾸면 따라간다) */
export function usePins(): string[] {
  const [pins, setPins] = useState(load);
  useEffect(() => {
    listeners.add(setPins);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setPins(load());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(setPins);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return pins;
}
