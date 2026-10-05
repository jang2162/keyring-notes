import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { hashContent, type TreeNode, type Vault } from "./vault.js";

export interface ManifestFile {
  path: string;
  hash: string;
  size: number;
}

/**
 * 앱 동기화용 파일 목록: 볼트의 모든 파일(서버가 만드는 위키 index·log 제외)과 내용 해시.
 * 해시는 크기·수정 시각이 같으면 다시 계산하지 않는다.
 */
export class SyncManifest {
  private cache = new Map<string, { size: number; mtimeMs: number; hash: string }>();

  constructor(
    private vault: Vault,
    private isGenerated: (rel: string) => boolean,
  ) {}

  async files(): Promise<ManifestFile[]> {
    const paths: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "dir") walk(n.children ?? []);
        else if (!this.isGenerated(n.path)) paths.push(n.path);
      }
    };
    walk(await this.vault.tree());
    const out: ManifestFile[] = [];
    const seen = new Set<string>();
    for (const rel of paths) {
      const abs = path.join(this.vault.root, rel);
      const st = await stat(abs).catch(() => null);
      if (!st?.isFile()) continue;
      seen.add(rel);
      let c = this.cache.get(rel);
      if (!c || c.size !== st.size || c.mtimeMs !== st.mtimeMs) {
        const data = await readFile(abs).catch(() => null);
        if (data === null) continue;
        c = { size: st.size, mtimeMs: st.mtimeMs, hash: hashContent(data) };
        this.cache.set(rel, c);
      }
      out.push({ path: rel, hash: c.hash, size: c.size });
    }
    for (const k of this.cache.keys()) if (!seen.has(k)) this.cache.delete(k);
    return out;
  }
}
