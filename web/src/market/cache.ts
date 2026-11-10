import { packageCacheDir, type CachedVersion, type LockEntry } from "@keyring-notes/core";

/**
 * 화면 쪽 기기 캐시: 받은 패키지 판을 이 기기에 둬 오프라인에서도 쓴다. 판 하나가 한 단위다(다 쓴 뒤 메타).
 * 잠금과의 대조(sha256)는 쓰는 쪽(state.ts)이 한다 — 캐시는 받은 바이트를 그대로 둔다.
 */
export interface PackageCache {
  list(): Promise<CachedVersion[]>;
  get(id: string, version: string, path: string): Promise<Uint8Array | null>;
  /** 한 판을 통째로(다 쓴 뒤 메타). 같은 판이 있으면 덮어쓴다 */
  put(id: string, version: string, entry: LockEntry, files: Map<string, Uint8Array>): Promise<void>;
  remove(id: string, version: string): Promise<void>;
}

const key = (id: string, version: string) => `${id}@${version}`;

/** 시험용 */
export function memoryPackageCache(): PackageCache {
  const m = new Map<string, { id: string; version: string; entry: LockEntry; files: Map<string, Uint8Array> }>();
  return {
    list: async () => [...m.values()].map((v) => ({ id: v.id, version: v.version, sha256: { ...v.entry.sha256 } })),
    get: async (id, version, path) => {
      const b = m.get(key(id, version))?.files.get(path);
      return b ? b.slice() : null;
    },
    put: async (id, version, entry, files) => {
      m.set(key(id, version), { id, version, entry, files: new Map([...files].map(([p, b]) => [p, b.slice()])) });
    },
    remove: async (id, version) => {
      m.delete(key(id, version));
    },
  };
}

interface IdbRow {
  key: string;
  id: string;
  version: string;
  entry: LockEntry;
  files: Record<string, Uint8Array>;
}

/** 브라우저(서버 모드·기기 볼트 둘 다). 볼트 IndexedDB(keyring-local-vault)와 다른 DB — 판 하나가 레코드 하나라 원자적이다 */
export function idbPackageCache(name = "keyring-market"): PackageCache {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("packages", { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction("packages", mode);
      const req = fn(t.objectStore("packages"));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    list: async () => ((await tx("readonly", (s) => s.getAll())) as IdbRow[]).map((r) => ({ id: r.id, version: r.version, sha256: r.entry.sha256 })),
    get: async (id, version, path) => {
      const r = (await tx("readonly", (s) => s.get(key(id, version)))) as IdbRow | undefined;
      const b = r?.files[path];
      return b ? new Uint8Array(b) : null;
    },
    put: async (id, version, entry, files) => {
      const row: IdbRow = { key: key(id, version), id, version, entry, files: Object.fromEntries([...files].map(([p, b]) => [p, b.slice()])) };
      await tx("readwrite", (s) => s.put(row));
    },
    remove: async (id, version) => {
      await tx("readwrite", (s) => s.delete(key(id, version)));
    },
  };
}

const META = ".keyring-cache.json";

/**
 * 앱(Tauri): `$APPDATA/packages/@scope/name/<version>/` + `.keyring-cache.json`(서버 캐시와 같은 모양). 이미 허용된 `$APPDATA/**` 에 쓴다.
 * 메타를 마지막에 쓰므로 메타가 없는 폴더(쓰다 끊김)는 list 에 나오지 않고 다음 put 이 지우고 다시 쓴다.
 */
export function tauriPackageCache(): PackageCache {
  const fsP = import("@tauri-apps/plugin-fs");
  const pathP = import("@tauri-apps/api/path");
  const root = async () => {
    const p = await pathP;
    return `${await p.appDataDir()}${p.sep()}packages`;
  };
  // 경로 조각은 packageCacheDir 이 검사한 것만(`..`·절대 경로가 들어갈 수 없다)
  const dirOf = async (id: string, version: string) => {
    const p = await pathP;
    return [await root(), ...packageCacheDir(id, version)].join(p.sep());
  };
  return {
    async list() {
      const fs = await fsP;
      const p = await pathP;
      const out: CachedVersion[] = [];
      const r = await root();
      if (!(await fs.exists(r))) return out;
      const dirs = async (d: string) => (await fs.readDir(d)).filter((e) => e.isDirectory && !e.name.startsWith(".")).map((e) => e.name);
      for (const s of await dirs(r))
        for (const n of await dirs(`${r}${p.sep()}${s}`))
          for (const v of await dirs(`${r}${p.sep()}${s}${p.sep()}${n}`)) {
            try {
              const meta = JSON.parse(await fs.readTextFile([r, s, n, v, META].join(p.sep()))) as { id: string; version: string; entry: LockEntry };
              out.push({ id: meta.id, version: meta.version, sha256: meta.entry.sha256 });
            } catch {
              /* 메타 없음 = 쓰다 끊긴 판 */
            }
          }
      return out;
    },
    async get(id, version, path) {
      const fs = await fsP;
      const p = await pathP;
      const dir = await dirOf(id, version);
      try {
        await fs.readTextFile(`${dir}${p.sep()}${META}`);
        return await fs.readFile(`${dir}${p.sep()}${path.split("/").join(p.sep())}`);
      } catch {
        return null;
      }
    },
    async put(id, version, entry, files) {
      const fs = await fsP;
      const p = await pathP;
      const dir = await dirOf(id, version);
      if (await fs.exists(dir)) await fs.remove(dir, { recursive: true });
      await fs.mkdir(dir, { recursive: true });
      for (const [path, bytes] of files) {
        const parts = path.split("/");
        if (parts.length > 1) await fs.mkdir([dir, ...parts.slice(0, -1)].join(p.sep()), { recursive: true });
        await fs.writeFile([dir, ...parts].join(p.sep()), bytes);
      }
      await fs.writeTextFile(`${dir}${p.sep()}${META}`, JSON.stringify({ id, version, entry, at: Date.now() }));
    },
    async remove(id, version) {
      const fs = await fsP;
      const dir = await dirOf(id, version);
      if (await fs.exists(dir)) await fs.remove(dir, { recursive: true });
    },
  };
}
