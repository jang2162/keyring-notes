/**
 * 오프라인 편집(F13). IndexedDB에
 *   docs    한 번 연 문서(오프라인에서 다시 열기)
 *   outbox  오프라인에서 저장한 내용(다시 연결되면 서버로)
 *   meta    문서 트리 등
 * 를 둔다. 서버에 보낼 때는 처음 오프라인 편집을 시작한 버전(baseHash)을 그대로 쓰므로,
 * 그 사이 서버에서 바뀌었으면 덮어쓰지 않고 충돌 사본으로 남긴다.
 */
import type { Doc, TreeNode } from "./api";

export interface OutboxItem {
  path: string;
  content: string;
  /** 오프라인 편집을 시작한 서버 버전. 새 문서면 null */
  baseHash: string | null;
  queuedAt: string;
}

const DB_NAME = "keyring-offline";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("docs", { keyPath: "path" });
      db.createObjectStore("outbox", { keyPath: "path" });
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= open();
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** fetch 자체가 실패(연결 없음)했는지. 서버가 준 오류 응답은 아니다. */
export function isNetworkError(e: unknown): boolean {
  // 서버(또는 로컬 볼트)가 준 오류 응답은 연결 문제가 아니다
  if (e && typeof e === "object" && "status" in e) return false;
  return e instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}

export const offline = {
  async saveDoc(doc: Doc): Promise<void> {
    if (doc.generated) return;
    await tx("docs", "readwrite", (s) => s.put({ path: doc.path, content: doc.content, hash: doc.hash }));
  },
  async getDoc(path: string): Promise<Doc | undefined> {
    return (await tx("docs", "readonly", (s) => s.get(path))) as Doc | undefined;
  },
  async saveTree(tree: TreeNode[]): Promise<void> {
    await tx("meta", "readwrite", (s) => s.put(tree, "tree"));
  },
  async getTree(): Promise<TreeNode[] | undefined> {
    return (await tx("meta", "readonly", (s) => s.get("tree"))) as TreeNode[] | undefined;
  },
  /** 오프라인 저장. 같은 문서를 여러 번 저장하면 내용만 바꾸고 처음 baseHash는 유지한다. */
  async queue(path: string, content: string, baseHash: string | null): Promise<void> {
    const prev = (await tx("outbox", "readonly", (s) => s.get(path))) as OutboxItem | undefined;
    const item: OutboxItem = { path, content, baseHash: prev ? prev.baseHash : baseHash, queuedAt: new Date().toISOString() };
    await tx("outbox", "readwrite", (s) => s.put(item));
    await tx("docs", "readwrite", (s) => s.put({ path, content, hash: item.baseHash ?? "" }));
  },
  async pending(): Promise<OutboxItem[]> {
    return (await tx("outbox", "readonly", (s) => s.getAll())) as OutboxItem[];
  },
  async pendingFor(path: string): Promise<OutboxItem | undefined> {
    return (await tx("outbox", "readonly", (s) => s.get(path))) as OutboxItem | undefined;
  },
  async done(path: string): Promise<void> {
    await tx("outbox", "readwrite", (s) => s.delete(path));
  },
  /** 로그아웃: 이 기기에 남긴 문서·대기 내용을 지운다. */
  async clear(): Promise<void> {
    for (const s of ["docs", "outbox", "meta"]) await tx(s, "readwrite", (st) => st.clear());
  },
};

/** 앱이 오프라인에서도 로그인된 것으로 볼지(마지막으로 로그인에 성공했는지). */
export const authMemo = {
  get: () => {
    try {
      return localStorage.getItem("keyring:authed") === "1";
    } catch {
      return false;
    }
  },
  set: (v: boolean) => {
    try {
      if (v) localStorage.setItem("keyring:authed", "1");
      else localStorage.removeItem("keyring:authed");
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  },
};
