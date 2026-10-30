import { useEffect, useState } from "react";
import { isRecordOf, readStored } from "./stored";

/**
 * 조회 기록: 노트 경로 → 이 기기에서 마지막으로 연 시각(ms). 트리의 「조회순」 정렬이 읽는다.
 * 이 기기(localStorage `keyring:viewed`)에만 둔다 — 볼트에 쓰면 노트를 열기만 해도 파일이 바뀌어 동기화·커밋이 생긴다.
 * 「최근 문서」(`keyring:recent`, 30개)와 따로 두고 개수를 자르지 않는다: 하위 노트가 많으면 30개로는 대부분이 기록 밖으로 밀린다.
 * 이 파일 밖에서 그 키를 읽고 쓰지 않는다.
 */
export const VIEWED_KEY = "keyring:viewed";

type Viewed = Record<string, number>;

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isViewed = isRecordOf(isTime);

// 트리가 노드마다 viewedAt 을 부르므로 같은 저장값이면 다시 파싱하지 않는다
let cachedRaw: string | null = null;
let cached: Viewed = {};

function load(): Viewed {
  let raw: string | null;
  try {
    raw = localStorage.getItem(VIEWED_KEY);
  } catch {
    return {};
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = readStored(raw, {}, isViewed);
  }
  return cached;
}

const listeners = new Set<() => void>();

/** 기록을 바꾼다. 이 창이 들고 있는 값이 아니라 저장소의 지금 값에서 고친다 — 다른 창·탭이 바꾼 것을 덮지 않게 */
function update(fn: (v: Viewed) => Viewed | null): void {
  const next = fn({ ...load() });
  if (!next) return;
  try {
    localStorage.setItem(VIEWED_KEY, JSON.stringify(next));
  } catch {
    /* 저장소를 못 쓰는 환경: 기록하지 않는다 */
  }
  for (const l of listeners) l();
}

export function viewedAt(notePath: string): number | undefined {
  return load()[notePath];
}

export function markViewed(notePath: string, at: number = Date.now()): void {
  update((v) => ((v[notePath] = at), v));
}

/**
 * 노트 from 을 to 로 옮기거나 이름을 바꾼 뒤. subtree 면 from 의 하위 노트(`업무/A.md` 면 `업무/A/…`)도 따라 옮긴다.
 * 노트 파일 하나만 옮긴 것(이동 뒤 파일마다 부르는 자리)은 subtree 를 끈다. 옮긴 자리에 기록이 이미 있으면 더 최근 것을 남긴다
 */
export function renameViewed(from: string, to: string, subtree = true): void {
  if (from === to) return;
  const stem = (p: string) => p.replace(/\.md$/i, "");
  const prefix = stem(from) + "/";
  update((v) => {
    let changed = false;
    for (const [p, at] of Object.entries(v)) {
      const dest = p === from ? to : subtree && p.startsWith(prefix) ? stem(to) + "/" + p.slice(prefix.length) : null;
      if (dest === null) continue;
      delete v[p];
      v[dest] = Math.max(at, v[dest] ?? at);
      changed = true;
    }
    return changed ? v : null;
  });
}

/** 지운 노트의 기록을 치운다 */
export function forgetViewed(gone: (notePath: string) => boolean): void {
  update((v) => {
    const dead = Object.keys(v).filter(gone);
    for (const p of dead) delete v[p];
    return dead.length ? v : null;
  });
}

/** 기록이 바뀔 때마다 오르는 값(다른 창·탭의 기록도). 조회순으로 그린 트리가 다시 정렬하게 한다 */
export function useViewedVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    listeners.add(bump);
    const onStorage = (e: StorageEvent) => {
      if (e.key === VIEWED_KEY || e.key === null) bump();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return version;
}
