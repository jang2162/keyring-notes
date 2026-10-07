/**
 * 접힌 상태(문서마다, 이 기기에만). 파일 내용은 바꾸지 않는다.
 * 접힌 곳 하나 = 그 블록의 첫 줄(제목·목록 항목·콜아웃·코드 블록·표) 번호와 그 줄의 글.
 * 문서가 바뀌어 줄이 밀려도 같은 글의 줄(가장 가까운 것)로 다시 찾는다. 에디터·미리보기·개요가 같이 쓴다.
 */
export interface FoldAnchor {
  /** 1부터 */
  line: number;
  text: string;
}

const KEY = "keyring:folds";
const MAX_DOCS = 200;

type Store = Record<string, FoldAnchor[]>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

let store: Store = load();
const listeners = new Set<(path: string, source: unknown) => void>();

function persist() {
  try {
    const keys = Object.keys(store);
    // 오래된 문서부터 버린다(넣은 순서 = 마지막으로 고친 순서)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DOCS))) delete store[k];
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

export function getFolds(path: string): FoldAnchor[] {
  return store[path] ?? [];
}

/** source: 바꾼 쪽(그 쪽은 알림을 받아도 무시한다) */
export function setFolds(path: string, anchors: FoldAnchor[], source?: unknown) {
  const prev = JSON.stringify(store[path] ?? []);
  const sorted = [...anchors].sort((a, b) => a.line - b.line);
  if (prev === JSON.stringify(sorted)) return;
  delete store[path];
  if (sorted.length) store[path] = sorted;
  persist();
  for (const l of listeners) l(path, source);
}

export function onFoldsChange(fn: (path: string, source: unknown) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 문서 이동·이름 바꾸기 때 따라간다 */
export function moveFolds(from: string, to: string) {
  if (!store[from]) return;
  store[to] = store[from];
  delete store[from];
  persist();
}

/** 줄 번호들 → 기억할 꼴 */
export function anchorsOf(lines: string[], lineNumbers: Iterable<number>): FoldAnchor[] {
  const out: FoldAnchor[] = [];
  for (const n of lineNumbers) if (n >= 1 && n <= lines.length) out.push({ line: n, text: lines[n - 1].trim() });
  return out;
}

/** 기억한 것 → 지금 내용의 줄 번호(같은 글의 줄 중 가장 가까운 것, 없으면 버린다) */
export function resolveFolds(lines: string[], anchors: FoldAnchor[]): Set<number> {
  const out = new Set<number>();
  for (const a of anchors) {
    if (lines[a.line - 1]?.trim() === a.text) {
      out.add(a.line);
      continue;
    }
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== a.text || out.has(i + 1)) continue;
      if (best < 0 || Math.abs(i + 1 - a.line) < Math.abs(best - a.line)) best = i + 1;
    }
    if (best > 0) out.add(best);
  }
  return out;
}

/** 코드 블록은 이 줄 수(여닫는 줄 포함) 이상일 때만 접는다 */
export const CODE_FOLD_MIN_LINES = 6;
