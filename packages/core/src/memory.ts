import type { FileEntry, FileStore } from "./local.js";

/** 메모리 저장소(시험용, 또는 저장하지 않는 임시 볼트). */
export class MemoryStore implements FileStore {
  readonly files = new Map<string, { data: Uint8Array; mtime: number }>();
  readonly meta = new Map<string, string>();
  private clock = 1_700_000_000_000;

  private tick() {
    this.clock += 1000;
    return this.clock;
  }

  async list(): Promise<FileEntry[]> {
    return [...this.files.entries()]
      .filter(([p]) => !p.split("/").some((s) => s.startsWith(".")))
      .map(([path, f]) => ({ path, size: f.data.length, mtime: f.mtime }));
  }

  async read(path: string): Promise<Uint8Array | null> {
    return this.files.get(path)?.data ?? null;
  }

  async write(path: string, data: Uint8Array): Promise<FileEntry> {
    const mtime = this.tick();
    this.files.set(path, { data: new Uint8Array(data), mtime });
    return { path, size: data.length, mtime };
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async readMeta(name: string): Promise<string | null> {
    return this.meta.get(name) ?? null;
  }

  async writeMeta(name: string, text: string): Promise<void> {
    this.meta.set(name, text);
  }

  async appendMeta(name: string, text: string): Promise<void> {
    this.meta.set(name, (this.meta.get(name) ?? "") + text);
  }

  /** 앱 밖에서 파일을 바꾼 것처럼(시험용) */
  touch(path: string, text: string) {
    this.files.set(path, { data: new TextEncoder().encode(text), mtime: this.tick() });
  }
}
