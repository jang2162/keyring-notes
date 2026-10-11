/**
 * 열린 문서 저장소: 경로 → 문서 항목. 어느 칸에서 열었든 같은 문서는 원본이 여기 하나다 —
 * 초안·저장 상태·충돌이 문서 단위로 한 번만 있어야 두 칸이 서로 덮어쓰거나 자동 저장이 둘 돌지 않는다.
 * 모든 연산은 입력을 바꾸지 않는 순수 함수다.
 */

export interface OpenDoc {
  path: string;
  /** 서버에 저장된 내용과 그 해시. 저장할 때 baseHash로 보낸다(노트 없는 노드는 ""). */
  saved: string;
  hash: string;
  draft: string;
  /** 에디터를 새 내용으로 다시 만들 때 올린다. */
  seq: number;
  /** 서버가 만드는 문서(위키 index·log): 읽기 전용 */
  generated: boolean;
  /** 연결이 없어 이 기기의 사본을 보여 주는 중 */
  cachedOffline?: boolean;
  /** 노트 없는 노드(A/만 있음): 내용을 쓰면 그때 A.md를 만든다 */
  virtual?: boolean;
}

export interface Conflict {
  currentHash: string | null;
}

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "queued" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

export interface DocEntry {
  doc: OpenDoc;
  save: SaveState;
  conflict: Conflict | null;
}

export type DocStore = Record<string, DocEntry>;

/** 새로 읽은 문서: save idle, conflict null, seq 는 있던 것 + 1 */
export function upsertDoc(s: DocStore, doc: Omit<OpenDoc, "seq">): DocStore {
  const seq = (s[doc.path]?.doc.seq ?? 0) + 1;
  return { ...s, [doc.path]: { doc: { ...doc, seq }, save: { kind: "idle" }, conflict: null } };
}

const patchEntry = (s: DocStore, path: string, patch: (e: DocEntry) => DocEntry): DocStore => {
  const e = s[path];
  return e ? { ...s, [path]: patch(e) } : s;
};

/** 없으면 s 그대로 */
export const patchDoc = (s: DocStore, path: string, patch: (d: OpenDoc) => OpenDoc): DocStore => patchEntry(s, path, (e) => ({ ...e, doc: patch(e.doc) }));

export const setSave = (s: DocStore, path: string, save: SaveState): DocStore => patchEntry(s, path, (e) => ({ ...e, save }));

export const setConflict = (s: DocStore, path: string, conflict: Conflict | null): DocStore => patchEntry(s, path, (e) => ({ ...e, conflict }));

export function renameDoc(s: DocStore, from: string, to: string, patch?: (d: OpenDoc) => OpenDoc): DocStore {
  const e = s[from];
  if (!e) return s;
  const rest = { ...s };
  delete rest[from];
  const moved = { ...e.doc, path: to };
  return { ...rest, [to]: { ...e, doc: patch ? patch(moved) : moved } };
}

export const isDirty = (e: DocEntry): boolean => e.doc.draft !== e.doc.saved && !e.doc.generated;

/** 어느 칸에도 없는 문서를 치운다. 단 초안이 다른(저장 안 한) 문서는 남긴다 */
export function dropUnused(s: DocStore, inUse: (path: string) => boolean): DocStore {
  const gone = Object.keys(s).filter((p) => !inUse(p) && !isDirty(s[p]));
  if (!gone.length) return s;
  const out = { ...s };
  for (const p of gone) delete out[p];
  return out;
}

export function dirtyPaths(s: DocStore): string[] {
  return Object.keys(s)
    .filter((p) => isDirty(s[p]))
    .sort();
}
