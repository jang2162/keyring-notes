import { execFile } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

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
            reject(new Error(`git ${args[0]} 실패: ${stderr || err.message}`));
            return;
          }
          resolve({ stdout, code });
        },
      );
    });
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
    // 이력 저장소 자체와 다른 앱의 설정·휴지통 폴더는 추적하지 않는다.
    await mkdir(path.join(this.gitDir, "info"), { recursive: true });
    await writeFile(
      path.join(this.gitDir, "info", "exclude"),
      ["/.history/", "/.trash/", ".DS_Store", ""].join("\n"),
    );
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

  /** 특정 리비전의 파일 내용. 그 리비전에 파일이 없으면 null. */
  async show(rev: string, relPath: string): Promise<string | null> {
    if (!/^[0-9a-f]{7,64}$/i.test(rev)) throw new Error("잘못된 리비전입니다");
    const res = await this.run(["show", `${rev}:${relPath}`], { allowFail: true });
    return res.code === 0 ? res.stdout : null;
  }
}
