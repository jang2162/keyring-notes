import type { FileEntry, FileStore } from "@keyring-notes/core";

/**
 * 브라우저 IndexedDB 위의 로컬 볼트(서버 없는 PWA·시험용). 데스크톱·모바일 앱은 실제 폴더(TauriStore)를 쓴다.
 * 파일 하나가 레코드 하나라 아주 큰 볼트에는 맞지 않는다.
 */
export class IdbStore implements FileStore {
  private db: Promise<IDBDatabase>;

  constructor(name = "keyring-local-vault") {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("files", { keyPath: "path" });
        req.result.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const d = await this.db;
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async list(): Promise<FileEntry[]> {
    const rows = (await this.tx("files", "readonly", (s) => s.getAll())) as { path: string; data: Uint8Array; mtime: number }[];
    return rows.map((r) => ({ path: r.path, size: r.data.length, mtime: r.mtime }));
  }

  async read(path: string): Promise<Uint8Array | null> {
    const r = (await this.tx("files", "readonly", (s) => s.get(path))) as { data: Uint8Array } | undefined;
    return r ? new Uint8Array(r.data) : null;
  }

  async write(path: string, data: Uint8Array): Promise<FileEntry> {
    const mtime = Date.now();
    await this.tx("files", "readwrite", (s) => s.put({ path, data: new Uint8Array(data), mtime }));
    return { path, size: data.length, mtime };
  }

  async remove(path: string): Promise<void> {
    await this.tx("files", "readwrite", (s) => s.delete(path));
  }

  async readMeta(name: string): Promise<string | null> {
    return ((await this.tx("meta", "readonly", (s) => s.get(name))) as string | undefined) ?? null;
  }

  async writeMeta(name: string, text: string): Promise<void> {
    await this.tx("meta", "readwrite", (s) => s.put(text, name));
  }

  async appendMeta(name: string, text: string): Promise<void> {
    // 읽기와 쓰기를 한 트랜잭션에서 해 동시에 덧붙여도 잃지 않게 한다
    const d = await this.db;
    await new Promise<void>((resolve, reject) => {
      const t = d.transaction("meta", "readwrite");
      const s = t.objectStore("meta");
      const get = s.get(name);
      get.onsuccess = () => s.put(((get.result as string | undefined) ?? "") + text, name);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
}
