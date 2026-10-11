import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMarkdown } from "./paths.js";
import { fileSha256, type S3Client } from "./s3.js";
import { EncryptionError, isSealed, type CryptoProvider, type S3Crypto } from "./s3crypto.js";
import { serverText } from "./lang.js";
import type { Vault } from "./vault.js";

const hashContentHex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Git으로 추적하는 첨부 목록(경로 → 내용 해시). 점 파일이라 트리·API에는 보이지 않는다. */
export const BLOB_INDEX = ".keyring-blobs.json";

export interface BlobEntry {
  sha256: string;
  size: number;
  /** 아직 S3에 올리지 못함(로컬 파일만 있음). 다음 커밋·주기 재시도 때 올린다 */
  pending?: true;
}

type Index = Record<string, BlobEntry>;

/**
 * 큰 첨부(이미지·PDF 등)를 S3에 내용 해시 키로 두고, Git에는 위 목록 파일만 남긴다(Git LFS와 같은 방식).
 * 볼트 폴더에는 파일이 그대로 있어 화면·API·다른 편집기는 달라지는 것이 없고, Git 이력과 백업이 가벼워진다.
 * S3 객체는 내용 해시가 이름이라 덮어쓰지 않고, 예전 목록이 가리키는 과거 버전도 남는다(지우지 않는다).
 */
export class BlobStore {
  private index: Index = {};
  private timer: NodeJS.Timeout | null = null;
  lastError: string | null = null;
  /** 올리기 전 암호화(KEYRING_S3_ENCRYPTION_KEY). 켜면 이름도 내용 해시 대신 HMAC으로 */
  crypto: CryptoProvider | null = null;

  constructor(
    private vault: Vault,
    private s3: S3Client,
    readonly minBytes: number,
  ) {}

  private key(sha: string) {
    return this.s3.key(`blobs/${sha.slice(0, 2)}/${sha}`);
  }

  /** 암호화한 첨부의 키(이름은 HMAC이라 내용 해시가 드러나지 않는다) */
  private sealedKey(c: S3Crypto, sha: string) {
    const name = c.blobName(sha);
    return this.s3.key(`blobs-enc/${name.slice(0, 2)}/${name}`);
  }

  private abs(rel: string) {
    return path.join(this.vault.root, rel);
  }

  private async readIndex(): Promise<Index> {
    try {
      const raw = JSON.parse(await readFile(this.abs(BLOB_INDEX), "utf8")) as { files?: Index };
      return raw.files && typeof raw.files === "object" ? raw.files : {};
    } catch {
      return {};
    }
  }

  private async writeIndex() {
    const files = Object.fromEntries(
      Object.keys(this.index)
        .sort()
        .map((k) => [k, this.index[k]]),
    );
    const tmp = this.abs(`${BLOB_INDEX}.tmp`);
    await writeFile(tmp, JSON.stringify({ version: 1, files }, null, 1) + "\n");
    await rename(tmp, this.abs(BLOB_INDEX));
  }

  /** vault.init() 전에 부른다: 목록을 읽고 Git 제외와 커밋 전 처리를 건다. */
  async attach(): Promise<void> {
    this.index = await this.readIndex();
    this.vault.git.presetExcludes("blobs", Object.keys(this.index));
    this.vault.beforeCommit = (paths) => this.prepareCommit(paths);
  }

  private qualifies(rel: string, size: number) {
    return !isMarkdown(rel) && size >= this.minBytes;
  }

  /** 볼트의 모든 파일(점 폴더 제외) */
  private async allFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (nodes: Awaited<ReturnType<Vault["tree"]>>) => {
      for (const n of nodes) {
        if (n.type === "dir") walk(n.children ?? []);
        else out.push(n.path);
      }
    };
    walk(await this.vault.tree());
    return out;
  }

  private async upload(rel: string, sha: string): Promise<boolean> {
    try {
      if (this.crypto) {
        const c = await this.crypto();
        const k = this.sealedKey(c, sha);
        if (await this.s3.head(k)) return true;
        const stage = await mkdtemp(path.join(os.tmpdir(), "keyring-blob-"));
        try {
          const sealed = path.join(stage, "blob");
          await c.sealFile(this.abs(rel), sealed);
          await this.s3.put(k, { file: sealed }, { metadata: { "keyring-encrypted": "1" } });
        } finally {
          await rm(stage, { recursive: true, force: true });
        }
        return true;
      }
      const k = this.key(sha);
      if (!(await this.s3.head(k))) await this.s3.put(k, { file: this.abs(rel) }, { sha256: sha });
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.error(serverText("server.log.blob_upload_failed"), this.lastError);
      return false;
    }
  }

  /**
   * 커밋 직전: 바뀐 첨부를 S3에 올리고 목록을 고친 뒤, git에 넣을 경로를 돌려준다
   * (S3로 간 첨부는 빼고 목록 파일을 더한다). paths가 없으면 볼트 전체를 훑는다.
   */
  async prepareCommit(paths: string[] | undefined): Promise<string[] | undefined> {
    const candidates = paths ?? [...new Set([...(await this.allFiles()), ...Object.keys(this.index)])];
    const before = JSON.stringify(this.index);
    const managed = new Set(Object.keys(this.index));
    for (const rel of candidates) {
      if (rel === BLOB_INDEX) continue;
      const st = await stat(this.abs(rel)).catch(() => null);
      if (!st?.isFile() || !this.qualifies(rel, st.size)) {
        delete this.index[rel];
        continue;
      }
      const cur = this.index[rel];
      if (cur && cur.size === st.size && !cur.pending && !paths) continue; // 전체 훑기에서는 크기가 같으면 해시를 건너뛴다
      const sha = await fileSha256(this.abs(rel));
      if (cur && cur.sha256 === sha && !cur.pending) continue;
      this.index[rel] = (await this.upload(rel, sha)) ? { sha256: sha, size: st.size } : { sha256: sha, size: st.size, pending: true };
    }
    const changed = JSON.stringify(this.index) !== before;
    if (changed) {
      await this.writeIndex();
      await this.vault.git.setExcludes("blobs", Object.keys(this.index));
    }
    if (!paths) return undefined;
    for (const k of Object.keys(this.index)) managed.add(k);
    const out = paths.filter((p) => !managed.has(p));
    if (changed) out.push(BLOB_INDEX);
    return out;
  }

  /** 아직 못 올린 첨부를 다시 올린다. 목록이 바뀌면 커밋한다. */
  async retryPending(): Promise<number> {
    const pending = Object.entries(this.index).filter(([, e]) => e.pending);
    if (pending.length === 0) return 0;
    await this.vault.absorbOutsideChanges();
    return Object.values(this.index).filter((e) => e.pending).length;
  }

  start(everyMs = 5 * 60_000) {
    this.stop();
    this.timer = setInterval(() => void this.retryPending().catch(() => undefined), everyMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 백업 복원 뒤: 복원된 목록대로 첨부를 S3에서 받아 맞추고, 복원 전에만 있던 첨부는 지운다.
   * 받지 못한 것은 경로 목록으로 돌려준다.
   */
  async afterRestore(): Promise<{ downloaded: string[]; removed: string[]; missing: string[] }> {
    const previous = this.index;
    this.index = await this.readIndex();
    const downloaded: string[] = [];
    const removed: string[] = [];
    const missing: string[] = [];
    for (const [rel, e] of Object.entries(this.index)) {
      const st = await stat(this.abs(rel)).catch(() => null);
      if (st?.isFile() && st.size === e.size && (await fileSha256(this.abs(rel))) === e.sha256) continue;
      const data = e.pending ? null : await this.fetch(e.sha256).catch(() => null);
      if (!data) {
        missing.push(rel);
        continue;
      }
      await mkdir(path.dirname(this.abs(rel)), { recursive: true });
      await writeFile(this.abs(rel), data);
      downloaded.push(rel);
    }
    for (const rel of Object.keys(previous)) {
      if (this.index[rel]) continue;
      await rm(this.abs(rel), { force: true });
      removed.push(rel);
    }
    await this.vault.git.setExcludes("blobs", Object.keys(this.index));
    return { downloaded, removed, missing };
  }

  /**
   * S3에서 첨부를 받는다: 암호화를 켰으면 암호화한 이름을 먼저, 없으면 예전(암호화 전) 이름으로.
   * 받은 것이 암호화 형식이면 풀고, 내용 해시가 목록과 다르면 받지 않은 것으로 친다.
   */
  private async fetch(sha: string): Promise<Uint8Array | null> {
    const c = this.crypto ? await this.crypto() : null;
    let data = c ? await this.s3.get(this.sealedKey(c, sha)) : null;
    data ??= await this.s3.get(this.key(sha));
    if (!data) return null;
    if (isSealed(data)) {
      if (!c) throw new EncryptionError("attachment_encrypted");
      data = c.openBytes(data);
    }
    return hashContentHex(data) === sha ? data : null;
  }

  status() {
    const entries = Object.values(this.index);
    return {
      count: entries.length,
      bytes: entries.reduce((n, e) => n + e.size, 0),
      pending: entries.filter((e) => e.pending).length,
      minBytes: this.minBytes,
      encrypted: this.crypto !== null,
      lastError: this.lastError,
    };
  }
}
