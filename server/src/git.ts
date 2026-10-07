import { execFile } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { PathError } from "./paths.js";

export interface Author {
  name: string;
  email: string;
}

export interface CommitInfo {
  rev: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export const SYSTEM_AUTHOR: Author = { name: "system", email: "system@keyring-notes.local" };

const FIELD = "\x1f";

/** 점으로 시작하는 이름이 든 경로(내부 기록 파일) */
const isInternal = (p: string) => p.split("/").some((seg) => seg.startsWith("."));
const RECORD = "\x1e";

/**
 * 볼트의 변경 이력. Git 디렉터리는 `<vault>/.history`, 작업 트리는 볼트 자체다.
 * 다른 에디터에서 볼트를 열어도 `.git` 폴더가 보이지 않도록 분리해 둔다.
 */
export class GitHistory {
  readonly gitDir: string;

  constructor(readonly workTree: string) {
    this.gitDir = path.join(workTree, ".history");
  }

  private run(args: string[], opts: { env?: NodeJS.ProcessEnv; allowFail?: boolean } = {}) {
    return new Promise<{ stdout: string; code: number }>((resolve, reject) => {
      execFile(
        "git",
        ["--git-dir", this.gitDir, "--work-tree", this.workTree, "-c", "core.quotePath=false", ...args],
        {
          cwd: this.workTree,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8",
        },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
          if (err && !opts.allowFail) {
            reject(new Error(`git ${args[0]} failed: ${stderr || err.message}`));
            return;
          }
          resolve({ stdout, code });
        },
      );
    });
  }

  private baseExcludes = ["/.history/", "/.keyring/", "/.trash/", ".DS_Store"];
  /** 추적하지 않을 경로 묶음(위키 자동 생성 문서, S3에 둔 첨부 …). */
  private excludeGroups = new Map<string, string[]>();

  /** 지금 제외 중인 경로 전체 */
  get extraExcludes(): string[] {
    return [...new Set([...this.excludeGroups.values()].flat())];
  }

  /** init 전에 미리 정해 둔다(시작 커밋에도 섞이지 않게). git 명령은 쓰지 않는다. */
  presetExcludes(group: string, paths: string[]) {
    this.excludeGroups.set(group, paths);
  }

  private async writeExcludes() {
    const lines = [...this.baseExcludes, ...this.extraExcludes.map((p) => "/" + p.replace(/([*?[\]\\])/g, "\\$1"))];
    await mkdir(path.join(this.gitDir, "info"), { recursive: true });
    await writeFile(path.join(this.gitDir, "info", "exclude"), lines.join("\n") + "\n");
  }

  /** 한 묶음의 제외 경로를 바꾼다. 이미 추적 중이면 이력에서만 뺀다(스테이징만, 커밋은 호출한 쪽이). */
  async setExcludes(group: string, paths: string[]): Promise<void> {
    this.excludeGroups.set(group, paths);
    await this.writeExcludes();
    for (let i = 0; i < paths.length; i += 500) {
      await this.run(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...paths.slice(i, i + 500)], { allowFail: true });
    }
  }

  /**
   * 커밋별 바뀐 파일 목록까지 포함한 이력(오래된 것부터). 파일 목록은 그 커밋의 변경 전체다(--full-diff:
   * pathspec 밖의 파일도 들어간다 — 숨김 경로가 낀 커밋의 메시지를 가릴 때 쓴다).
   */
  async logWithFiles(pathspec: string, limit = 300): Promise<(CommitInfo & { files: { status: string; path: string; from?: string }[] })[]> {
    const fmt = RECORD + ["%H", "%an", "%ae", "%aI", "%s"].join(FIELD);
    const res = await this.run(["log", `--max-count=${limit}`, "--full-diff", "--name-status", "-M", `--format=${fmt}`, "--", pathspec], { allowFail: true });
    if (res.code !== 0) return [];
    const out = res.stdout
      .split(RECORD)
      .filter((r) => r.trim())
      .map((r) => {
        const [head, ...rest] = r.split("\n");
        const [rev, author, email, date, message] = head.split(FIELD);
        const files = rest
          .map((l) => l.split("\t"))
          .filter((parts) => parts.length >= 2 && parts[0] && !parts.slice(1).some(isInternal))
          .map((parts) => (parts[0].startsWith("R") ? { status: "R", from: parts[1], path: parts[2] } : { status: parts[0][0], path: parts[1] }));
        return { rev, author, email, date, message, files };
      });
    return out.reverse();
  }

  async init(): Promise<void> {
    let exists = true;
    try {
      await access(path.join(this.gitDir, "HEAD"));
    } catch {
      exists = false;
    }
    if (!exists) {
      await mkdir(this.gitDir, { recursive: true });
      await this.run(["init", "--quiet", "--initial-branch=main"]);
    }
    // 이력 저장소 자체, 인덱스, 다른 앱의 설정·휴지통 폴더, 서버가 만드는 파일은 추적하지 않는다.
    await this.writeExcludes();
    await this.run(["config", "core.autocrlf", "false"]);
  }

  /**
   * 주어진 경로들의 현재 작업 트리 상태를 한 커밋으로 기록한다.
   * paths를 생략하면 볼트 전체를 스테이징한다. 변경이 없으면 null.
   */
  async commit(message: string, author: Author, paths?: string[]): Promise<string | null> {
    const pathspec = paths && paths.length > 0 ? ["--", ...paths] : [];
    await this.run(["add", "--all", ...pathspec]);
    const diff = await this.run(["diff", "--cached", "--quiet"], { allowFail: true });
    if (diff.code === 0) return null;
    const env = {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };
    await this.run(["commit", "--quiet", "--no-verify", "-m", message], { env });
    const head = await this.run(["rev-parse", "HEAD"]);
    return head.stdout.trim();
  }

  /**
   * 주어진 경로의 변경을 직전 커밋(HEAD)에 합친다(자동 저장 묶기). 메시지·작성 시각은 그대로 둔다.
   * 합친 결과가 HEAD의 부모와 같아지면(되돌려 쓴 경우) 빈 커밋으로 남는다. 변경이 없으면 null.
   */
  async amend(author: Author, paths: string[]): Promise<string | null> {
    await this.run(["add", "--all", "--", ...paths]);
    const diff = await this.run(["diff", "--cached", "--quiet"], { allowFail: true });
    if (diff.code === 0) return null;
    const env = {
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };
    await this.run(["commit", "--quiet", "--no-verify", "--amend", "--no-edit", "--allow-empty"], { env });
    return (await this.run(["rev-parse", "HEAD"])).stdout.trim();
  }

  /** 이미 스테이징된 변경만 커밋한다(없으면 null). */
  async commitStaged(message: string, author: Author): Promise<string | null> {
    const diff = await this.run(["diff", "--cached", "--quiet"], { allowFail: true });
    if (diff.code === 0) return null;
    const env = {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };
    await this.run(["commit", "--quiet", "--no-verify", "-m", message], { env });
    return (await this.run(["rev-parse", "HEAD"])).stdout.trim();
  }

  /** 백업·복원용 저수준 git 명령(인자는 호출하는 쪽이 만든다). */
  raw(args: string[], allowFail = false) {
    return this.run(args, { allowFail });
  }

  async head(): Promise<string | null> {
    const r = await this.run(["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /** 실패한 일괄 쓰기 뒤에 스테이징만 되돌린다. */
  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.run(["reset", "--quiet", "--", ...paths], { allowFail: true });
  }

  async log(relPath?: string, limit = 100): Promise<CommitInfo[]> {
    const fmt = ["%H", "%an", "%ae", "%aI", "%s"].join(FIELD) + RECORD;
    const args = ["log", `--max-count=${limit}`, `--format=${fmt}`];
    if (relPath) args.push("--", relPath);
    const res = await this.run(args, { allowFail: true });
    if (res.code !== 0) return []; // 커밋이 하나도 없는 저장소
    return res.stdout
      .split(RECORD)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [rev, author, email, date, message] = r.split(FIELD);
        return { rev, author, email, date, message };
      });
  }

  /**
   * 경로의 이력(최근 것부터)과 커밋마다 실제로 바뀐 경로 전체(이동은 원래·새 경로 둘 다). 메시지와 상관없이
   * 변경 목록으로 숨김 경로가 낀 커밋을 가려내는 데 쓴다(ScopedVault.history).
   */
  async logWithChanges(relPath: string, limit = 100): Promise<(CommitInfo & { files: string[] })[]> {
    const fmt = RECORD + ["%H", "%an", "%ae", "%aI", "%s"].join(FIELD);
    const res = await this.run(["log", `--max-count=${limit}`, "--full-diff", "--no-renames", "--name-only", `--format=${fmt}`, "--", relPath], { allowFail: true });
    if (res.code !== 0) return [];
    return res.stdout
      .split(RECORD)
      .filter((r) => r.trim())
      .map((r) => {
        const [head, ...rest] = r.split("\n");
        const [rev, author, email, date, message] = head.split(FIELD);
        // 점 파일(.keyring-blobs.json 등 내부 기록)은 사용자 경로가 아니라 뺀다
        return { rev, author, email, date, message, files: rest.map((l) => l.trim()).filter((l) => l && !isInternal(l)) };
      });
  }

  /** 특정 리비전의 파일 내용. 그 리비전에 파일이 없으면 null. */
  async show(rev: string, relPath: string): Promise<string | null> {
    if (!/^[0-9a-f]{7,64}$/i.test(rev)) throw new PathError("rev_invalid");
    const res = await this.run(["show", `${rev}:${relPath}`], { allowFail: true });
    return res.code === 0 ? res.stdout : null;
  }
}
