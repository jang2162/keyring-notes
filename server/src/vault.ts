import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chainMoves, dailyConfigOf, parseVaultSettings, rewriteLinks, VAULT_SETTINGS_PATH, type DailyConfig, type VaultSettings } from "@keyring-notes/core";
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

export class ForbiddenError extends Error {
  constructor(message = "권한이 없습니다") {
    super(message);
  }
}

/** 클라이언트가 본 버전(baseHash)과 서버의 현재 버전이 달라 쓰기를 거부할 때. */
export class ConflictError extends Error {
  constructor(
    readonly currentHash: string | null,
    message = "다른 곳에서 먼저 수정되었습니다",
    readonly path?: string,
  ) {
    super(path ? `${message}: ${path}` : message);
  }
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * 일괄 쓰기의 연산 하나.
 * - write: 문서 전체를 쓴다. baseHash가 null이면 새 문서 생성.
 * - append: 문서 끝에 덧붙인다(없으면 만든다). baseHash를 주면 그 버전일 때만.
 * - delete / move: baseHash가 현재 버전과 같아야 한다. 문서와 첨부(바이트 해시) 모두 된다.
 *   이동은 문서 → 문서, 첨부 → 첨부만(확장자 .md를 바꿔 종류를 바꿀 수는 없다).
 */
export type Op =
  | { op: "write"; path: string; content: string; baseHash: string | null }
  | { op: "append"; path: string; content: string; baseHash?: string | null }
  | { op: "delete"; path: string; baseHash: string }
  | { op: "move"; from: string; to: string; baseHash: string }
  /** 첨부 파일(이미지·PDF 등) 새로 만들기. 이미 있으면 충돌. */
  | { op: "put"; path: string; data: Uint8Array };

/** 권한 계층이 연산 종류별로 검사할 수 있게 넘겨주는 동작 이름. */
export type Action = "create" | "append" | "modify" | "delete";
export type Guard = (action: Action, relPath: string) => void;

export interface FilePreview {
  path: string;
  /** 바꾸기 전 내용(없던 파일이면 null). 첨부 파일은 내용 대신 null */
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  binary: boolean;
}

/**
 * 이동 때 링크 자동 갱신 설정. 기본은 켬(소유자 기준: 모든 경로로 해석, 가장 짧은 이름).
 * - canSee: 링크 해석에 쓸 경로(에이전트는 볼 수 있는 경로만). 고칠 문서도 이 안에서만 찾는다
 * - fullPaths: 고친 링크를 늘 전체 경로로(에이전트: 짧은 이름이 되는지로 숨김 문서가 드러나지 않게)
 * - only: 이 경로만 고친다(검토 승인 때 제안 미리보기에 보였던 문서로 제한)
 */
export interface LinkUpdateOptions {
  enabled?: boolean;
  canSee?: (rel: string) => boolean;
  fullPaths?: boolean;
  only?: Set<string>;
}

export interface BatchResult {
  rev: string | null;
  /** 실제로 바뀐 파일과 새 해시. 삭제된 문서는 null. 찾느라 읽기만 한 문서는 넣지 않는다(숨김 경로가 새지 않게). */
  files: { path: string; hash: string | null }[];
  /** 이동 때 링크를 고친 문서(이동한 문서 자신 포함)와 고친 링크 수 */
  linksUpdated: string[];
  linkCount: number;
  /** dryRun일 때: 실제로 바뀔 파일별 전후 내용 */
  preview?: FilePreview[];
}

interface Slot {
  abs: string;
  original: Buffer | null;
  /** 마크다운 내용(첨부·없는 파일은 null). 있는지는 hash로 본다 */
  content: string | null;
  hash: string | null;
  /** 새로 쓸 바이트(첨부: put·이동해 온 것). */
  bytes?: Uint8Array;
}

/** 자동 저장을 한 커밋으로 묶는 최대 시간(묶음의 첫 저장부터) */
export const COALESCE_WINDOW_MS = 10 * 60 * 1000;

function appendText(current: string, addition: string): string {
  if (current.length === 0 || current.endsWith("\n")) return current + addition;
  return `${current}\n${addition}`;
}

/**
 * 볼트 파일 저장소. 권한은 모르며, 권한 검사는 ScopedVault가 guard로 넘긴다.
 * 모든 변경은 batch() 하나를 지나고, 직렬화되며, 한 번에 한 커밋으로 남는다.
 */
export class Vault {
  readonly git: GitHistory;
  private queue: Promise<unknown> = Promise.resolve();
  private realRoot = "";
  private listeners: ((paths: string[]) => Promise<void> | void)[] = [];
  /**
   * 커밋 직전에 부른다(첨부를 S3에 올리고 이력에서 빼는 등). 바뀐 경로(볼트 전체면 undefined)를 받아
   * 실제로 git에 넣을 경로를 돌려준다.
   */
  beforeCommit: ((paths: string[] | undefined) => Promise<string[] | undefined>) | null = null;

  /**
   * 자동 저장 묶기: 같은 작성자가 같은 문서 하나만 고친 직전 커밋. 이 커밋이 HEAD이고 묶음을 시작한 지
   * COALESCE_WINDOW_MS 안이면 다음 자동 저장을 이 커밋에 합친다. 다른 커밋·백업·서버 밖 변경 흡수가
   * 끼면 지운다(이미 백업·동기화로 나간 커밋은 고쳐 쓰지 않는다).
   */
  private amendable: { rev: string; path: string; email: string; since: number } | null = null;

  private async commitChanges(message: string, author: Author, paths?: string[]): Promise<string | null> {
    this.amendable = null;
    const finalPaths = this.beforeCommit ? await this.beforeCommit(paths) : paths;
    // 경로를 지정했는데 넣을 것이 하나도 없으면(모두 S3로 간 첨부) 스테이징된 것만 커밋한다
    if (paths && finalPaths && finalPaths.length === 0) return this.git.commitStaged(message, author);
    return this.git.commit(message, author, finalPaths);
  }

  /** 서버가 만드는 파일(위키 index·log)처럼 API로 쓸 수 없는 경로인지. */
  readOnly: (rel: string) => boolean = () => false;

  constructor(readonly root: string) {
    this.git = new GitHistory(root);
  }

  private shared: { mtimeMs: number; size: number; value: VaultSettings } | null = null;

  /**
   * 모든 기기 공통 설정(볼트의 keyring-settings.md). 서버가 링크 해석·데일리 판정에 쓴다.
   * 파일이 바뀌었을 때(크기·수정 시각)만 다시 읽는다. 권한 계층을 거치지 않고 읽으므로 내용을 응답에 싣지 않는다
   * (읽는 사람에게 보이는 문서 안에서 링크를 해석하는 데만 쓴다).
   */
  sharedSettings(): VaultSettings {
    let st: { mtimeMs: number; size: number } | null = null;
    try {
      const s = statSync(path.join(this.root, VAULT_SETTINGS_PATH));
      st = s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null;
    } catch {
      st = null;
    }
    if (!st) return (this.shared = { mtimeMs: -1, size: -1, value: parseVaultSettings(null) }).value;
    if (this.shared && this.shared.mtimeMs === st.mtimeMs && this.shared.size === st.size) return this.shared.value;
    let text: string | null = null;
    try {
      text = readFileSync(path.join(this.root, VAULT_SETTINGS_PATH), "utf8");
    } catch {
      text = null;
    }
    this.shared = { ...st, value: parseVaultSettings(text) };
    return this.shared.value;
  }

  daily(): DailyConfig {
    return dailyConfigOf(this.sharedSettings());
  }

  /** 볼트 폴더와 이력 저장소를 준비하고, 서버 밖에서 생긴 변경을 한 커밋으로 흡수한다. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.realRoot = await realpath(this.root);
    await this.git.init();
    await this.exclusive(() => this.commitChanges("서버 밖에서 생긴 변경 반영", SYSTEM_AUTHOR));
  }

  /** 쓰기를 잠시 막고 fn을 실행한다(백업 복원처럼 볼트 전체를 바꾸는 작업). */
  maintenance<T>(fn: () => Promise<T>): Promise<T> {
    return this.exclusive(fn);
  }

  /** 서버 밖(다른 에디터 등)에서 생긴 변경을 커밋한다. 백업 직전에 부른다. */
  absorbOutsideChanges(): Promise<string | null> {
    // 백업 직전에도 부른다: 백업에 들어간 커밋은 이후 자동 저장이 고쳐 쓰지 않게 묶음을 끊는다
    this.amendable = null;
    return this.exclusive(() => this.commitChanges("서버 밖에서 생긴 변경 반영", SYSTEM_AUTHOR));
  }

  /** 변경이 커밋된 직후(다음 쓰기보다 먼저) 바뀐 경로 목록으로 호출된다. 인덱스 갱신용. */
  onChange(fn: (paths: string[]) => Promise<void> | void): void {
    this.listeners.push(fn);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** 경로 검증 + 심볼릭 링크로 볼트 밖을 가리키는 경우 차단. */
  async resolve(input: string): Promise<{ rel: string; abs: string }> {
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

  /** 볼트의 모든 파일 경로(점 폴더 제외, 첨부 포함). */
  private async allFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "dir") walk(n.children ?? []);
        else out.push(n.path);
      }
    };
    walk(await this.tree());
    return out;
  }

  /** 볼트의 모든 마크다운 문서 경로. */
  async markdownPaths(): Promise<string[]> {
    const out: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "dir") walk(n.children ?? []);
        else if (isMarkdown(n.path)) out.push(n.path);
      }
    };
    walk(await this.tree());
    return out;
  }

  private async readBuffer(abs: string): Promise<Buffer | null> {
    try {
      return await readFile(abs);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
      throw e;
    }
  }

  async read(input: string): Promise<Doc> {
    const { rel, abs } = await this.resolve(input);
    if (!isMarkdown(rel)) throw new PathError("마크다운 문서만 열 수 있습니다");
    const buf = await this.readBuffer(abs);
    if (buf === null) throw new NotFoundError(`문서가 없습니다: ${rel}`);
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
   * 여러 연산을 하나의 커밋으로 적용한다. 하나라도 실패하면(충돌, 권한, 파일 오류, 커밋 오류)
   * 아무것도 바뀌지 않는다. 연산은 앞 연산의 결과 위에서 차례로 검사된다.
   */
  async batch(ops: Op[], author: Author, opts: { message?: string; guard?: Guard; dryRun?: boolean; links?: LinkUpdateOptions; coalesce?: boolean } = {}): Promise<BatchResult> {
    if (ops.length === 0) throw new PathError("연산이 비어 있습니다");
    if (ops.length > 500) throw new PathError("한 번에 500개까지 처리할 수 있습니다");
    const guard = opts.guard ?? (() => undefined);

    // 경로 검증은 잠금 밖에서 먼저 한다.
    const resolved = new Map<string, string>();
    const resolvedAbs = new Map<string, string>();
    /** kind: md(문서만), bin(첨부만), any(이동·삭제: 둘 다) */
    const want = async (p: string, kind: "md" | "bin" | "any" = "md") => {
      const { rel, abs } = await this.resolve(p);
      if (kind === "md" && !isMarkdown(rel)) throw new PathError(`마크다운 문서(.md)만 바꿀 수 있습니다: ${rel}`);
      if (kind === "bin" && isMarkdown(rel)) throw new PathError(`마크다운 문서는 put으로 쓸 수 없습니다: ${rel}`);
      if (this.readOnly(rel)) throw new PathError(`자동 생성 문서라 직접 고칠 수 없습니다: ${rel}`);
      resolved.set(p, rel);
      resolvedAbs.set(rel, abs);
    };
    for (const op of ops) {
      if (op.op === "move") {
        await want(op.from, "any");
        await want(op.to, "any");
        if (isMarkdown(op.from) !== isMarkdown(op.to)) throw new PathError(`문서와 첨부 사이로는 옮길 수 없습니다(확장자 .md 유지): ${op.from} → ${op.to}`);
      } else if (op.op === "put") {
        if (!(op.data instanceof Uint8Array)) throw new PathError("data가 필요합니다");
        await want(op.path, "bin");
      } else if (op.op === "delete") {
        await want(op.path, "any");
      } else {
        if (typeof op.content !== "string") throw new PathError("content가 필요합니다");
        await want(op.path);
      }
    }

    return this.exclusive(async () => {
      const slots = new Map<string, Slot>();
      const slot = async (rel: string): Promise<Slot> => {
        let s = slots.get(rel);
        if (!s) {
          const abs = resolvedAbs.get(rel)!;
          const original = await this.readBuffer(abs);
          s = {
            abs,
            original,
            content: original === null || !isMarkdown(rel) ? null : original.toString("utf8"),
            hash: original === null ? null : hashContent(original),
          };
          slots.set(rel, s);
        }
        return s;
      };
      const set = (s: Slot, content: string | null) => {
        s.content = content;
        s.bytes = undefined;
        s.hash = content === null ? null : hashContent(content);
      };

      // 1) 계획: 가상의 상태 위에서 모든 연산을 검사한다. 디스크는 아직 그대로다.
      const verbs: string[] = [];
      const moveList: [string, string][] = [];
      for (const op of ops) {
        if (op.op === "move") {
          const from = resolved.get(op.from)!;
          const to = resolved.get(op.to)!;
          const a = await slot(from);
          const b = await slot(to);
          if (a.hash === null) throw new NotFoundError(`${isMarkdown(from) ? "문서" : "파일"}가 없습니다: ${from}`);
          guard("delete", from);
          guard("create", to);
          if (a.hash !== op.baseHash) throw new ConflictError(a.hash, undefined, from);
          if (from === to) continue;
          if (b.hash !== null) throw new ConflictError(b.hash, "이미 같은 이름의 파일이 있습니다", to);
          if (isMarkdown(from)) set(b, a.content);
          else {
            // 첨부는 바이트를 그대로 옮긴다(S3 보관 첨부도 볼트에는 파일이 있다)
            b.bytes = a.bytes ?? a.original!;
            b.hash = a.hash;
          }
          set(a, null);
          moveList.push([from, to]);
          verbs.push(`이동: ${from} → ${to}`);
          continue;
        }
        const rel = resolved.get(op.path)!;
        const s = await slot(rel);
        if (op.op === "put") {
          guard("create", rel);
          if (s.hash !== null) throw new ConflictError(s.hash, "이미 같은 이름의 파일이 있습니다", rel);
          s.bytes = op.data;
          s.hash = hashContent(Buffer.from(op.data));
          verbs.push(`첨부: ${rel}`);
          continue;
        }
        if (op.op === "write") {
          const action: Action = s.content === null ? "create" : op.content.startsWith(s.content) ? "append" : "modify";
          guard(action, rel);
          if (s.hash !== op.baseHash) {
            throw new ConflictError(s.hash, s.hash === null ? "문서가 없습니다(삭제되었을 수 있음)" : undefined, rel);
          }
          verbs.push(`${s.content === null ? "생성" : "수정"}: ${rel}`);
          set(s, op.content);
        } else if (op.op === "append") {
          guard(s.content === null ? "create" : "append", rel);
          if (op.baseHash !== undefined && s.hash !== op.baseHash) throw new ConflictError(s.hash, undefined, rel);
          verbs.push(`${s.content === null ? "생성" : "덧붙임"}: ${rel}`);
          set(s, s.content === null ? op.content : appendText(s.content, op.content));
        } else {
          if (s.hash === null) throw new NotFoundError(`${isMarkdown(rel) ? "문서" : "파일"}가 없습니다: ${rel}`);
          guard("delete", rel);
          if (s.hash !== op.baseHash) throw new ConflictError(s.hash, undefined, rel);
          verbs.push(`삭제: ${rel}`);
          set(s, null);
        }
      }

      // 1-2) 이동한 문서를 가리키던 링크를 고친다(모든 연산을 적용한 가상 상태 위에서)
      const linksUpdated: string[] = [];
      let linkCount = 0;
      const moves = chainMoves(moveList);
      if (moves.size > 0 && opts.links?.enabled !== false) {
        const canSee = opts.links?.canSee ?? (() => true);
        const before = (await this.allFiles()).filter(canSee);
        const after = new Set(before);
        for (const [rel, s] of slots) {
          if (s.hash === null) after.delete(rel);
          else if (canSee(rel)) after.add(rel);
        }
        const ctx = { moves, before, after: [...after], fullPaths: opts.links?.fullPaths, daily: this.daily() };
        const origin = new Map([...moves].map(([from, to]) => [to, from]));
        for (const rel of [...after].sort()) {
          if (!isMarkdown(rel) || this.readOnly(rel)) continue;
          if (opts.links?.only && !opts.links.only.has(rel)) continue;
          const existing = slots.get(rel);
          const content = existing ? existing.content : ((await this.readBuffer(path.join(this.root, rel)))?.toString("utf8") ?? null);
          if (content === null) continue;
          const r = rewriteLinks(content, origin.get(rel) ?? rel, rel, ctx);
          if (!r) continue;
          // 이동 대상 문서는 이미 create 검사를 받았다. 나머지는 고칠 권한이 없으면 조용히 건너뛴다.
          if (!origin.has(rel)) {
            try {
              guard("modify", rel);
            } catch {
              continue;
            }
          }
          if (!existing) resolvedAbs.set(rel, (await this.resolve(rel)).abs);
          set(await slot(rel), r.content);
          linksUpdated.push(rel);
          linkCount += r.count;
        }
      }

      const changed = [...slots.entries()].filter(([, s]) => {
        const before = s.original === null ? null : hashContent(s.original);
        return before !== s.hash;
      });
      const files = changed.map(([p, s]) => ({ path: p, hash: s.hash }));
      if (opts.dryRun) {
        // 검사만 하고 디스크는 그대로 둔다(변경 검토 대기열용)
        const preview = changed.map(([rel, s]) => {
          const binary = s.bytes !== undefined || !isMarkdown(rel);
          return {
            path: rel,
            before: binary || s.original === null ? null : s.original.toString("utf8"),
            after: binary ? null : s.content,
            beforeHash: s.original === null ? null : hashContent(s.original),
            afterHash: s.hash,
            binary,
          };
        });
        return { rev: null, files, preview, linksUpdated, linkCount };
      }
      if (changed.length === 0) return { rev: null, files, linksUpdated, linkCount };

      // 2) 적용: 실패하면 원래 바이트로 되돌린다.
      const written: [string, Slot][] = [];
      try {
        for (const [rel, s] of changed) {
          written.push([rel, s]);
          if (s.bytes) {
            await mkdir(path.dirname(s.abs), { recursive: true });
            await writeFile(s.abs, s.bytes);
          } else if (s.hash === null) {
            await rm(s.abs, { force: true });
            await this.pruneEmptyDirs(path.dirname(s.abs));
          } else {
            await mkdir(path.dirname(s.abs), { recursive: true });
            await writeFile(s.abs, s.content ?? "", "utf8");
          }
        }
        // 제목은 연산만으로 정한다(이동 하나면 "이동: a → b" — ScopedVault.history가 이 모양을 본다). 링크 갱신은 본문에.
        const message = opts.message?.trim() || (verbs.length === 1 ? verbs[0] : `일괄 변경 ${verbs.length}건`);
        const lines = [...(verbs.length > 1 || opts.message ? verbs : []), ...linksUpdated.filter((p) => !moves.has(p) && ![...moves.values()].includes(p)).map((p) => `링크 갱신: ${p}`)];
        const body = lines.length > 0 ? `${message}\n\n${lines.join("\n")}` : message;
        const rev = await this.commitOrAmend(body, author, changed, verbs, opts.coalesce === true && !opts.message);
        for (const fn of this.listeners) {
          try {
            await fn(changed.map(([rel]) => rel));
          } catch (err) {
            console.error("변경 알림 처리 실패", err);
          }
        }
        return { rev, files, linksUpdated, linkCount };
      } catch (e) {
        for (const [, s] of written.reverse()) {
          try {
            if (s.original === null) await rm(s.abs, { force: true });
            else {
              await mkdir(path.dirname(s.abs), { recursive: true });
              await writeFile(s.abs, s.original);
            }
          } catch (restoreErr) {
            console.error("일괄 쓰기 복구 실패", restoreErr);
          }
        }
        await this.git.unstage(changed.map(([rel]) => rel)).catch(() => undefined);
        throw e;
      }
    });
  }

  /**
   * 커밋한다. coalesce(자동 저장)이고 문서 하나만 쓰기·만들기였으면, 직전 묶음 커밋에 합치거나 새 묶음을 시작한다.
   */
  private async commitOrAmend(body: string, author: Author, changed: [string, Slot][], verbs: string[], coalesce: boolean): Promise<string | null> {
    const paths = changed.map(([rel]) => rel);
    const single = coalesce && changed.length === 1 && verbs.length === 1 && /^(수정|생성): /.test(verbs[0]) && changed[0][1].bytes === undefined && changed[0][1].content !== null;
    if (!single) return this.commitChanges(body, author, paths);
    const rel = paths[0];
    const a = this.amendable;
    if (a && a.path === rel && a.email === author.email && Date.now() - a.since < COALESCE_WINDOW_MS && (await this.git.head()) === a.rev) {
      const finalPaths = this.beforeCommit ? await this.beforeCommit(paths) : paths;
      const rev = finalPaths && finalPaths.length === 0 ? null : await this.git.amend(author, finalPaths ?? paths);
      this.amendable = rev ? { ...a, rev } : a;
      return rev ?? a.rev;
    }
    const rev = await this.commitChanges(body, author, paths);
    if (rev) this.amendable = { rev, path: rel, email: author.email, since: Date.now() };
    return rev;
  }

  /** 삭제로 비게 된 상위 폴더를 볼트 루트 직전까지 정리한다. */
  private async pruneEmptyDirs(dirAbs: string): Promise<void> {
    let dir = dirAbs;
    while (path.relative(this.root, dir) && !path.relative(this.root, dir).startsWith("..")) {
      try {
        await rmdir(dir);
      } catch {
        return;
      }
      dir = path.dirname(dir);
    }
  }

  async history(input: string): Promise<CommitInfo[]> {
    const { rel } = await this.resolve(input);
    return this.git.log(rel);
  }

  async revision(input: string, rev: string): Promise<{ path: string; rev: string; content: string | null }> {
    const { rel } = await this.resolve(input);
    return { path: rel, rev, content: await this.git.show(rev, rel) };
  }
}
