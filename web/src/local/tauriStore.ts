import { convertFileSrc } from "@tauri-apps/api/core";
import { sep } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readFile, readTextFile, remove, stat, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FileEntry, FileStore } from "@keyring-notes/core";

const META_DIR = ".keyring-app";

/**
 * 데스크톱·모바일 앱의 볼트: 기기의 실제 폴더. 다른 편집기(Obsidian 등)로 같은 폴더를 열어도 된다.
 * 앱 메타데이터(이력·동기화 기준점)는 볼트 안 `.keyring-app/`에 둔다.
 */
export class TauriStore implements FileStore {
  private readonly sep: string;

  constructor(readonly root: string) {
    this.sep = sep();
  }

  private abs(rel: string): string {
    return this.root.replace(/[\\/]+$/, "") + this.sep + rel.split("/").join(this.sep);
  }

  private metaPath(name: string): string {
    return this.abs(`${META_DIR}/${name}`);
  }

  private async ensureParent(abs: string) {
    const i = abs.lastIndexOf(this.sep);
    if (i > 0) await mkdir(abs.slice(0, i), { recursive: true });
  }

  async list(): Promise<FileEntry[]> {
    if (!(await exists(this.root))) await mkdir(this.root, { recursive: true });
    const out: FileEntry[] = [];
    const walk = async (rel: string) => {
      for (const e of await readDir(rel ? this.abs(rel) : this.root)) {
        if (e.name.startsWith(".")) continue;
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory) await walk(child);
        else if (e.isFile) {
          const st = await stat(this.abs(child));
          out.push({ path: child, size: st.size, mtime: st.mtime ? st.mtime.getTime() : 0 });
        }
      }
    };
    await walk("");
    return out;
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.abs(path));
    } catch {
      return null;
    }
  }

  async write(path: string, data: Uint8Array): Promise<FileEntry> {
    const abs = this.abs(path);
    await this.ensureParent(abs);
    await writeFile(abs, data);
    const st = await stat(abs);
    return { path, size: st.size, mtime: st.mtime ? st.mtime.getTime() : Date.now() };
  }

  async remove(path: string): Promise<void> {
    await remove(this.abs(path)).catch(() => undefined);
    // 비게 된 상위 폴더도 정리한다
    const parts = path.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const dir = this.abs(parts.slice(0, i).join("/"));
      const entries = await readDir(dir).catch(() => null);
      if (!entries || entries.length > 0) break;
      await remove(dir).catch(() => undefined);
    }
  }

  async readMeta(name: string): Promise<string | null> {
    try {
      return await readTextFile(this.metaPath(name));
    } catch {
      return null;
    }
  }

  async writeMeta(name: string, text: string): Promise<void> {
    const p = this.metaPath(name);
    await this.ensureParent(p);
    await writeTextFile(p, text);
  }

  async appendMeta(name: string, text: string): Promise<void> {
    const p = this.metaPath(name);
    await this.ensureParent(p);
    await writeTextFile(p, text, { append: true });
  }

  fileUrl(path: string): string | null {
    return convertFileSrc(this.abs(path));
  }
}
