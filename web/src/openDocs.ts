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

/**
 * 다시 읽은 문서를 넣는다. 부르는 쪽은 「저장 안 한 변경이 없다」를 읽기 전에만 볼 수 있다 — 읽는 사이 친 글이 있으면 초안을 남긴다.
 * 서버 본문이 저장본과 같으면 해시만 맞추고, 다르면 손대지 않는다: 저장본을 서버 본문으로 바꾸면 다음 저장이 서버의 변경을 말없이 덮는다.
 * 옛 해시를 두면 다음 저장이 충돌(409)로 가서 기존 3방향 병합이 맡는다.
 * force: 초안을 버리기로 한 뒤(과거 판으로 되돌리기, 내 변경을 사본으로 저장한 뒤)
 */
export function reloadDoc(s: DocStore, doc: Omit<OpenDoc, "seq">, force = false): DocStore {
  const e = s[doc.path];
  if (force || !e || !isDirty(e)) return upsertDoc(s, doc);
  return doc.saved === e.doc.saved ? patchDoc(s, doc.path, (d) => (d.hash === doc.hash ? d : { ...d, hash: doc.hash })) : s;
}

/**
 * 서버가 이 문서를 content 로 썼다(이름 바꾸기가 상대 링크를 고침, 순서 바꾸기가 rank 를 적음) — 요청은 저장 안 한 변경이 없을 때 보냈다.
 * 초안이 그 내용과 같으면 저장본·해시만 맞춘다(에디터를 다시 만들지 않는다). 응답을 기다리는 동안 친 글이 있으면 초안을 남긴다:
 * 쓴 내용이 저장본 그대로면 해시만 맞추고, 다르면 손대지 않아 다음 저장이 충돌(409) → 3방향 병합으로 간다(reloadDoc 과 같은 이유)
 */
export function serverWrote(d: OpenDoc, content: string, hash: string): OpenDoc {
  if (d.draft === content) return d.saved === content && d.hash === hash ? d : { ...d, saved: content, hash };
  if (d.draft === d.saved) return { ...d, saved: content, draft: content, hash, seq: d.seq + 1 };
  return content === d.saved ? (d.hash === hash ? d : { ...d, hash }) : d;
}

const patchEntry = (s: DocStore, path: string, patch: (e: DocEntry) => DocEntry): DocStore => {
  const e = s[path];
  return e ? { ...s, [path]: patch(e) } : s;
};

/** 없거나 문서가 그대로면 s 그대로 */
export function patchDoc(s: DocStore, path: string, patch: (d: OpenDoc) => OpenDoc): DocStore {
  const e = s[path];
  if (!e) return s;
  const doc = patch(e.doc);
  return doc === e.doc ? s : { ...s, [path]: { ...e, doc } };
}

/** 에디터를 만든 문서 판: 경로#seq. 뷰·핸들이 어느 판의 것인지는 이 키로 가린다 */
export const docKeyOf = (d: Pick<OpenDoc, "path" | "seq">): string => `${d.path}#${d.seq}`;

/**
 * fromKey 판의 뷰가 보낸 초안. 저장소의 판이 이미 다르면 버린다 — 다시 읽기·합치기로 seq 가 오른 직후, 그 뷰를 다시 만들기
 * 전에 들어온 입력은 옛 판의 것이라 받으면 방금 받은 새 판(서버 내용)을 덮고 그대로 자동 저장된다
 */
export function setDraft(s: DocStore, path: string, draft: string, fromKey: string): DocStore {
  return patchDoc(s, path, (d) => (docKeyOf(d) !== fromKey || d.draft === draft ? d : { ...d, draft }));
}

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
