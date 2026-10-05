import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitHistory, SYSTEM_AUTHOR, type Author, type CommitInfo } from "./git.js";
import { isHiddenSegment, isMarkdown, normalizeVaultPath, PathError, resolveInVault } from "./paths.js";

export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
}

export interface Doc {
  path: string;
  content: string;
  hash: string;
}

export class NotFoundError extends Error {}

/** 클라이언트가 본 버전(baseHash)과 서버의 현재 버전이 달라 쓰기를 거부할 때. */
export class ConflictError extends Error {
  constructor(
    readonly currentHash: string | null,
    message = "다른 곳에서 먼저 수정되었습니다",
  ) {
    super(message);
  }
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 볼트 파일에 대한 모든 읽기·쓰기의 단일 입구.
 * 쓰기는 직렬화되고, 각 변경은 작성자와 함께 Git 커밋으로 남는다.
 */
export class Vault {
  readonly git: GitHistory;
  private queue: Promise<unknown> = Promise.resolve();
  private realRoot = "";

  constructor(readonly root: string) {
    this.git = new GitHistory(root);
  }

  /** 볼트 폴더와 이력 저장소를 준비하고, 서버 밖에서 생긴 변경을 한 커밋으로 흡수한다. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.realRoot = await realpath(this.root);
    await this.git.init();
    await this.exclusive(() => this.git.commit("서버 밖에서 생긴 변경 반영", SYSTEM_AUTHOR));
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** 경로 검증 + 심볼릭 링크로 볼트 밖을 가리키는 경우 차단. */
  private async resolve(input: string): Promise<{ rel: string; abs: string }> {
    const rel = normalizeVaultPath(input);
    const abs = resolveInVault(this.root, rel);
    // 존재하는 가장 가까운 상위까지 실제 경로를 따라가 볼트 안인지 확인한다.
    let probe = abs;
    for (;;) {
      try {
        const real = await realpath(probe);
        const r = path.relative(this.realRoot, real);
        if (r.startsWith("..") || path.isAbsolute(r)) throw new PathError("볼트 밖을 가리키는 링크입니다");
        break;
      } catch (e) {
        if (e instanceof PathError) throw e;
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return { rel, abs };
  }

  async tree(): Promise<TreeNode[]> {
    const walk = async (dirAbs: string, dirRel: string): Promise<TreeNode[]> => {
      const entries = await readdir(dirAbs, { withFileTypes: true });
      const nodes: TreeNode[] = [];
      for (const e of entries) {
        if (isHiddenSegment(e.name)) continue;
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          nodes.push({ name: e.name, path: rel, type: "dir", children: await walk(path.join(dirAbs, e.name), rel) });
        } else if (e.isFile()) {
          nodes.push({ name: e.name, path: rel, type: "file" });
        }
      }
      return nodes.sort((a, b) =>
        a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, "ko"),
      );
    };
    return walk(this.root, "");
  }

  private async currentHash(abs: string): Promise<string | null> {
    try {
      return hashContent(await readFile(abs));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async read(input: string): Promise<Doc> {
    const { rel, abs } = await this.resolve(input);
    if (!isMarkdown(rel)) throw new PathError("마크다운 문서만 열 수 있습니다");
    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "EISDIR") {
        throw new NotFoundError(`문서가 없습니다: ${rel}`);
      }
      throw e;
    }
    return { path: rel, content: buf.toString("utf8"), hash: hashContent(buf) };
  }

  /** 첨부 파일(이미지 등) 원본 바이트. */
  async readRaw(input: string): Promise<{ path: string; data: Buffer }> {
    const { rel, abs } = await this.resolve(input);
    try {
      const st = await lstat(abs);
      if (!st.isFile()) throw new NotFoundError(`파일이 없습니다: ${rel}`);
      return { path: rel, data: await readFile(abs) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError(`파일이 없습니다: ${rel}`);
      throw e;
    }
  }

  /**
   * 문서를 쓴다. baseHash는 클라이언트가 마지막으로 본 버전이며,
   * null이면 "새 문서 생성"을 뜻한다. 서버 쪽 현재 버전과 다르면 덮어쓰지 않고 거부한다.
   */
  async write(input: string, content: string, baseHash: string | null, author: Author): Promise<Doc & { rev: string | null }> {
    const { rel, abs } = await this.resolve(input);
    if (!isMarkdown(rel)) throw new PathError("마크다운 문서(.md)만 쓸 수 있습니다");
    return this.exclusive(async () => {
      const current = await this.currentHash(abs);
      if (current !== baseHash) {
        throw new ConflictError(current, current === null ? "문서가 이미 삭제되었습니다" : undefined);
      }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      const rev = await this.git.commit(`${current === null ? "생성" : "수정"}: ${rel}`, author, [rel]);
      return { path: rel, content, hash: hashContent(content), rev };
    });
  }

  async delete(input: string, baseHash: string, author: Author): Promise<{ rev: string | null }> {
    const { rel, abs } = await this.resolve(input);
    if (!isMarkdown(rel)) throw new PathError("마크다운 문서(.md)만 삭제할 수 있습니다");
    return this.exclusive(async () => {
      const current = await this.currentHash(abs);
      if (current === null) throw new NotFoundError(`문서가 없습니다: ${rel}`);
      if (current !== baseHash) throw new ConflictError(current);
      await rm(abs);
      const rev = await this.git.commit(`삭제: ${rel}`, author, [rel]);
      return { rev };
    });
  }

  async move(fromInput: string, toInput: string, baseHash: string, author: Author): Promise<Doc & { rev: string | null }> {
    const from = await this.resolve(fromInput);
    const to = await this.resolve(toInput);
    if (!isMarkdown(from.rel) || !isMarkdown(to.rel)) throw new PathError("마크다운 문서(.md)만 옮길 수 있습니다");
    return this.exclusive(async () => {
      const current = await this.currentHash(from.abs);
      if (current === null) throw new NotFoundError(`문서가 없습니다: ${from.rel}`);
      if (current !== baseHash) throw new ConflictError(current);
      if ((await this.currentHash(to.abs)) !== null) {
        throw new ConflictError(null, `이미 같은 이름의 문서가 있습니다: ${to.rel}`);
      }
      await mkdir(path.dirname(to.abs), { recursive: true });
      await rename(from.abs, to.abs);
      const rev = await this.git.commit(`이동: ${from.rel} → ${to.rel}`, author, [from.rel, to.rel]);
      const content = await readFile(to.abs, "utf8");
      return { path: to.rel, content, hash: current, rev };
    });
  }

  async history(input: string): Promise<CommitInfo[]> {
    const { rel } = await this.resolve(input);
    return this.git.log(rel);
  }

  async revision(input: string, rev: string): Promise<{ path: string; rev: string; content: string | null }> {
    const { rel } = await this.resolve(input);
    return { path: rel, rev, content: await this.git.show(rev, rel) };
  }

  /** 문서를 과거 리비전의 내용으로 되돌린다. 이력은 지우지 않고 새 커밋으로 남긴다. */
  async rollback(input: string, rev: string, baseHash: string | null, author: Author): Promise<Doc & { rev: string | null }> {
    const { rel, abs } = await this.resolve(input);
    if (!isMarkdown(rel)) throw new PathError("마크다운 문서(.md)만 되돌릴 수 있습니다");
    const old = await this.git.show(rev, rel);
    if (old === null) throw new NotFoundError(`해당 리비전에 문서가 없습니다: ${rev.slice(0, 7)}`);
    return this.exclusive(async () => {
      const current = await this.currentHash(abs);
      if (current !== baseHash) throw new ConflictError(current);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, old, "utf8");
      const newRev = await this.git.commit(`되돌리기: ${rel} @ ${rev.slice(0, 7)}`, author, [rel]);
      return { path: rel, content: old, hash: hashContent(old), rev: newRev };
    });
  }
}
