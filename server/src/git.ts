import { execFile, spawn } from "node:child_process";
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
 * 서버가 아는 이동을 커밋 메시지 끝 문단(트레일러)으로 남긴다(Vault.batch). 휴지통은 이 문단이 있는 커밋에서는
 * 내용 유사도(-M) 대신 이것만으로 이동을 가른다. 이동이 없는 일괄 쓰기도 `Keyring-Moves: 0` 을 남긴다 — 「이 커밋의
 * 이동은 서버가 다 안다」는 표시다. 경로에는 제어 문자(탭·줄바꿈)가 들어갈 수 없다(normalizeVaultPath)
 *
 *   Keyring-Moves: 2
 *   Keyring-Move: W/a.md<탭>V/a.md
 *   Keyring-Move: W/b.md<탭>V/b.md
 *
 * 이력 화면·에이전트 이력·웹훅은 제목 줄(%s)만 읽으므로 이 문단은 보이지 않는다
 */
export function moveTrailer(moves: [string, string][]): string {
  return [`Keyring-Moves: ${moves.length}`, ...moves.map(([from, to]) => `Keyring-Move: ${from}\t${to}`)].join("\n");
}

/** 메시지 끝 문단이 온전한 이동 트레일러면 옮긴 경로 짝, 아니면 null(트레일러 없는 커밋: 예전 커밋, 서버 밖 변경 흡수) */
export function parseMoveTrailer(message: string): [string, string][] | null {
  const paragraphs = message.trim().split(/\n\s*\n/);
  const lines = paragraphs[paragraphs.length - 1].split("\n");
  const count = /^Keyring-Moves: (\d+)$/.exec(lines[0] ?? "");
  if (!count || Number(count[1]) !== lines.length - 1) return null;
  const moves: [string, string][] = [];
  for (const line of lines.slice(1)) {
    // 서버가 쓴 경로에는 제어 문자가 없다(있으면 서버가 쓴 문단이 아니다)
    // eslint-disable-next-line no-control-regex
    const m = /^Keyring-Move: ([^\u0000-\u001f]+)\t([^\u0000-\u001f]+)$/.exec(line);
    if (!m) return null;
    moves.push([m[1], m[2]]);
  }
  return moves;
}

type Deletion = CommitInfo & { deleted: string[]; blobIndex: boolean; moves: [string, string][] | null };

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
    const res = await this.run(["log", `--max-count=${limit}`, "--full-diff", "--no-renames", "--name-only", `--format=${fmt}`, "--", relPath], {
      allowFail: true,
    });
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

  /**
   * 휴지통: 파일을 지운 커밋(최근 것부터 limit 개 — after 를 주면 그 커밋 다음, 더 오래된 것부터)과 커밋마다 지운 경로.
   * 후보는 이름 바꾸기 판정 없이(--no-renames) 고르고 고른 커밋만 자세히 본다(describeDeletions) — 이력 전체를 -M 으로
   * 훑지 않는다. last: 이번에 훑은 마지막 후보(다음 쪽의 after). 이력은 한 줄이다(병합 커밋을 만들지 않는다)
   * blobIndex: 이 커밋이 첨부 목록 파일(S3 보관 첨부)을 바꿨는지 — S3 로 간 첨부의 삭제는 그 파일에만 보인다.
   */
  async deletions(after: string | null, limit: number): Promise<{ commits: Deletion[]; more: boolean; last: string | null }> {
    if (after !== null && !/^[0-9a-f]{40,64}$/i.test(after)) throw new PathError("rev_invalid");
    // 낡은 cursor(백업 복원으로 지금 이력에서 빠진 커밋)는 받지 않는다 — 버려진 이력의 삭제를 보이지 않게
    if (after !== null && !(await this.isAncestor(after))) throw new PathError("rev_invalid");
    const from = after === null ? [] : [`${after}^`];
    const picked = await this.run(["log", "--no-renames", "--diff-filter=D", "--format=%H", `--max-count=${limit + 1}`, ...from], { allowFail: true });
    // 커밋이 없는 저장소, 맨 처음 커밋 다음(부모 없음)
    if (picked.code !== 0) return { commits: [], more: false, last: null };
    const revs = picked.stdout.split("\n").filter(Boolean);
    const page = revs.slice(0, limit);
    return { commits: await this.describeDeletions(page), more: revs.length > limit, last: page.at(-1) ?? null };
  }

  /** 커밋 하나의 지운 경로(휴지통 되살리기·미리보기). 없는 커밋이거나 지금 이력(HEAD 의 조상)에 없으면 null */
  async deletion(rev: string): Promise<Deletion | null> {
    if (!/^[0-9a-f]{40,64}$/i.test(rev)) throw new PathError("rev_invalid");
    if (!(await this.isAncestor(rev))) return null;
    return (await this.describeDeletions([rev]))[0] ?? null;
  }

  /** rev 가 지금 HEAD 이거나 그 조상인지 */
  private async isAncestor(rev: string): Promise<boolean> {
    return (await this.run(["merge-base", "--is-ancestor", rev, "HEAD"], { allowFail: true })).code === 0;
  }

  /**
   * 커밋마다 지운 경로. 이동 트레일러가 있는 커밋은 이름 바꾸기 판정 없이 보고 트레일러의 옛 경로를 뺀다. 없는 커밋만
   * git 의 이름 바꾸기 짝짓기(-M)로 가른다 — 내용이 같으면(빈 파일 포함) 늘, 내용이 바뀌었으면 절반 넘게 같을 때.
   * git 은 세 번까지(커밋 객체, 변경 목록, 트레일러 없는 커밋이 있을 때만 -M 변경 목록)
   */
  private async describeDeletions(revs: string[]): Promise<Deletion[]> {
    if (revs.length === 0) return [];
    const commits = await this.readCommits(revs);
    const plain = await this.changedPaths(revs, false);
    const guess = revs.filter((r) => commits.get(r) && commits.get(r)!.moves === null);
    const renamed = guess.length ? await this.changedPaths(guess, true) : new Map<string, string[][]>();
    const out: Deletion[] = [];
    for (const rev of revs) {
      const c = commits.get(rev);
      if (!c) continue;
      const movedFrom = new Set((c.moves ?? []).map(([f]) => f));
      const deleted: string[] = [];
      let blobIndex = false;
      for (const [status, p, to] of renamed.get(rev) ?? plain.get(rev) ?? []) {
        if (p === ".keyring-blobs.json" || to === ".keyring-blobs.json") blobIndex = true;
        if (status === "D" && !isInternal(p) && !movedFrom.has(p)) deleted.push(p);
      }
      out.push({ ...c, deleted, blobIndex });
    }
    return out;
  }

  /**
   * 커밋 객체를 그대로 읽어 작성자·시각·제목·이동 트레일러를 얻는다. 메시지 글자(구분 문자 포함)에 기대지 않으려고
   * log 형식(%x1e·%x1f) 대신 cat-file 로 읽는다
   */
  private async readCommits(revs: string[]): Promise<Map<string, CommitInfo & { moves: [string, string][] | null }>> {
    const out = new Map<string, CommitInfo & { moves: [string, string][] | null }>();
    const objects = await this.catBatch(revs);
    revs.forEach((rev, i) => {
      const o = objects[i];
      if (!o || o.type !== "commit") return;
      const text = o.data.toString("utf8");
      const split = text.indexOf("\n\n");
      const head = split < 0 ? text : text.slice(0, split);
      const body = split < 0 ? "" : text.slice(split + 2);
      const a = /^author (.*) <(.*)> (\d+) ([+-])(\d\d)(\d\d)$/m.exec(head);
      if (!a) return;
      // git 의 %aI 와 같은 모양(작성자 시간대)
      const offset = (a[4] === "-" ? -1 : 1) * (Number(a[5]) * 60 + Number(a[6]));
      const date = new Date((Number(a[3]) + offset * 60) * 1000).toISOString().slice(0, 19) + `${a[4]}${a[5]}:${a[6]}`;
      // %s 와 같다: 첫 문단을 한 줄로
      const message = body
        .replace(/^\n+/, "")
        .split(/\n\s*\n/)[0]
        .replace(/\n/g, " ")
        .trim();
      out.set(rev, { rev, author: a[1], email: a[2], date, message, moves: parseMoveTrailer(body) });
    });
    return out;
  }

  /**
   * 커밋마다 바뀐 경로([상태, 경로, 새 경로?]). diff-tree -z 는 경로를 따옴표로 감싸지 않고 NUL 로 가른다:
   * `<커밋>\0<상태>\0<경로>\0[<새 경로>\0]…` — 상태 자리에 커밋 해시가 오면 다음 커밋이다
   */
  private async changedPaths(revs: string[], detectRenames: boolean): Promise<Map<string, string[][]>> {
    const out = new Map<string, string[][]>();
    const raw = await this.pipe(["diff-tree", "--stdin", "-z", "-r", "--name-status", detectRenames ? "-M" : "--no-renames"], revs.join("\n") + "\n");
    const tokens = raw.toString("utf8").split("\0");
    let cur: string[][] | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t) continue;
      if (/^[0-9a-f]{40,64}$/.test(t)) {
        cur = [];
        out.set(t, cur);
        continue;
      }
      const two = /^[RC]/.test(t);
      cur?.push(two ? [t[0], tokens[i + 1], tokens[i + 2]] : [t, tokens[i + 1]]);
      i += two ? 2 : 1;
    }
    return out;
  }

  /** git 명령에 stdin 을 넣고 stdout 바이트를 받는다 */
  private pipe(args: string[], input: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["--git-dir", this.gitDir, "--work-tree", this.workTree, ...args], {
        cwd: this.workTree,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => chunks.push(c));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`git ${args[0]} failed: ${code}`))));
      child.stdin.end(input);
    });
  }

  /** 객체 이름마다 종류와 바이트(cat-file --batch 한 번). 없는 것은 null */
  private async catBatch(names: string[]): Promise<({ type: string; data: Buffer } | null)[]> {
    if (names.length === 0) return [];
    // 하나마다 "<해시> <종류> <크기>\n<내용>\n" 또는 "<이름> missing\n"
    const out = await this.pipe(["cat-file", "--batch"], names.map((n) => `${n}\n`).join(""));
    const result: ({ type: string; data: Buffer } | null)[] = [];
    let at = 0;
    for (let i = 0; i < names.length; i++) {
      const nl = out.indexOf(0x0a, at);
      const head = out.subarray(at, nl).toString("utf8");
      at = nl + 1;
      const m = / (blob|tree|commit|tag) (\d+)$/.exec(head);
      if (!m) {
        result.push(null);
        continue;
      }
      const size = Number(m[2]);
      result.push({ type: m[1], data: out.subarray(at, at + size) });
      at += size + 1;
    }
    return result;
  }

  /**
   * 여러 리비전:경로의 바이트를 git 한 번(cat-file --batch)으로 읽는다. 없는 것은 null.
   * 리비전은 커밋 해시(끝에 ^ 는 그 부모)만 받는다
   */
  async readMany(specs: { rev: string; path: string }[]): Promise<(Buffer | null)[]> {
    for (const s of specs) if (!/^[0-9a-f]{7,64}\^?$/i.test(s.rev)) throw new PathError("rev_invalid");
    return (await this.catBatch(specs.map((s) => `${s.rev}:${s.path}`))).map((o) => (o?.type === "blob" ? o.data : null));
  }

  /** 특정 리비전의 파일 내용. 그 리비전에 파일이 없으면 null. */
  async show(rev: string, relPath: string): Promise<string | null> {
    // 끝의 ^ 는 그 커밋의 부모(휴지통: 지우기 직전 내용)
    if (!/^[0-9a-f]{7,64}\^?$/i.test(rev)) throw new PathError("rev_invalid");
    const res = await this.run(["show", `${rev}:${relPath}`], { allowFail: true });
    return res.code === 0 ? res.stdout : null;
  }
}
