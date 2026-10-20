import { ConflictError, NotFoundError, sha256Hex, type RemoteFile, type RemoteVault } from "../src/index.js";

/** 서버와 같은 규칙(baseHash가 맞아야 씀)의 메모리 서버. */
export class FakeServer implements RemoteVault {
  readonly id = "https://notes.example";
  files = new Map<string, { content: string | Uint8Array; hash: string }>();
  offline = false;

  async put(path: string, content: string | Uint8Array) {
    this.files.set(path, { content, hash: await sha256Hex(content) });
  }
  text(path: string) {
    return this.files.get(path)?.content as string | undefined;
  }
  private check() {
    if (this.offline) throw new TypeError("fetch failed");
  }
  async manifest(): Promise<RemoteFile[]> {
    this.check();
    return [...this.files].map(([path, f]) => ({ path, hash: f.hash, size: f.content.length }));
  }
  async read(path: string) {
    this.check();
    const f = this.files.get(path);
    if (!f) throw new NotFoundError(path);
    return { content: f.content as string, hash: f.hash };
  }
  async readRaw(path: string) {
    this.check();
    const f = this.files.get(path);
    if (!f) throw new NotFoundError(path);
    return typeof f.content === "string" ? new TextEncoder().encode(f.content) : f.content;
  }
  async write(path: string, content: string, baseHash: string | null) {
    this.check();
    const cur = this.files.get(path)?.hash ?? null;
    if (cur !== baseHash) throw new ConflictError(cur);
    await this.put(path, content);
    return { hash: this.files.get(path)!.hash };
  }
  async putRaw(path: string, data: Uint8Array) {
    this.check();
    if (this.files.has(path)) throw new ConflictError(this.files.get(path)!.hash);
    await this.put(path, data);
    return { hash: this.files.get(path)!.hash };
  }
  async removeRaw(path: string, baseHash: string) {
    return this.remove(path, baseHash);
  }
  async remove(path: string, baseHash: string) {
    this.check();
    const cur = this.files.get(path)?.hash ?? null;
    if (cur !== baseHash) throw new ConflictError(cur);
    this.files.delete(path);
  }
}
