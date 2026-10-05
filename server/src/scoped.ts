import { atLeast, levelOf, type Level, type Principal } from "./access.js";
import type { Author, CommitInfo } from "./git.js";
import { headings, parseFrontmatter, resolveLink, section, setTaskState, wikilinkTargets, type Heading, type Section } from "./markdown.js";
import type { DocMeta, NoteIndex } from "./noteindex.js";
import { parseWidget, runWidget, type WidgetResult } from "./query.js";
import { normalizeVaultPath, PathError } from "./paths.js";
import { ConflictError, ForbiddenError, hashContent, NotFoundError, type Action, type BatchResult, type Doc, type Op, type TreeNode, type Vault } from "./vault.js";

const ACTION_LEVEL: Record<Action, Level> = {
  create: "append",
  append: "append",
  modify: "write",
  delete: "delete",
};

export interface SearchHit {
  path: string;
  title: string;
  line: number;
  snippet: string;
}

export interface Outline {
  path: string;
  hash: string;
  lines: number;
  bytes: number;
  frontmatter: Record<string, unknown> | null;
  frontmatterError?: string;
  headings: Heading[];
  /** 위키링크 대상. 보이지 않거나 없는 문서는 path가 null로, 둘을 구분하지 않는다. */
  links: { target: string; path: string | null }[];
}

/**
 * 권한 계층. REST와 MCP는 모두 이 클래스를 거쳐서만 볼트에 닿는다.
 * 숨김 경로는 "없는 문서"와 같은 응답을 돌려줘 존재 여부도 드러내지 않는다.
 */
export class ScopedVault {
  constructor(
    private vault: Vault,
    readonly principal: Principal,
    private index: NoteIndex,
  ) {}

  get author(): Author {
    return { name: this.principal.name, email: this.principal.email };
  }

  level(relPath: string): Level {
    return levelOf(this.principal, relPath);
  }

  private canRead(relPath: string): boolean {
    return atLeast(this.level(relPath), "read");
  }

  /** 읽기 권한 확인. 숨김이면 없는 문서와 같은 오류를 낸다. */
  private requireRead(input: string): string {
    const rel = normalizeVaultPath(input);
    if (!this.canRead(rel)) throw new NotFoundError(`문서가 없습니다: ${rel}`);
    return rel;
  }

  private requireLevel(rel: string, level: Level) {
    if (!atLeast(this.level(rel), level)) {
      // 숨김 경로는 존재 여부와 상관없이 같은 메시지를 낸다.
      throw new ForbiddenError(`권한이 없습니다(현재 권한: ${this.level(rel)}): ${rel}`);
    }
  }

  private filterTree(nodes: TreeNode[]): TreeNode[] {
    if (this.principal.kind === "owner") return nodes;
    const policy = this.principal.policy;
    const out: TreeNode[] = [];
    for (const n of nodes) {
      if (n.type === "dir") {
        if (!policy.mayContainVisible(n.path)) continue;
        const children = this.filterTree(n.children ?? []);
        if (this.canRead(n.path) || children.length > 0) out.push({ ...n, children });
      } else if (this.canRead(n.path)) {
        out.push(n);
      }
    }
    return out;
  }

  async tree(folder?: string): Promise<TreeNode[]> {
    let nodes = this.filterTree(await this.vault.tree());
    if (folder && normalizeFolder(folder)) {
      const f = normalizeFolder(folder);
      const find = (ns: TreeNode[]): TreeNode[] | null => {
        for (const n of ns) {
          if (n.type !== "dir") continue;
          if (n.path === f) return n.children ?? [];
          if (f.startsWith(n.path + "/")) return find(n.children ?? []);
        }
        return null;
      };
      const found = find(nodes);
      if (!found) throw new NotFoundError(`폴더가 없습니다: ${f}`);
      nodes = found;
    }
    return nodes;
  }

  /** 읽을 수 있는 문서 목록(평면). */
  async documents(folder?: string): Promise<{ path: string; access: Level }[]> {
    const f = normalizeFolder(folder);
    return (await this.visibleMarkdown())
      .filter((p) => !f || p.startsWith(f + "/"))
      .map((p) => ({ path: p, access: this.level(p) }));
  }

  private async visibleMarkdown(): Promise<string[]> {
    return (await this.vault.markdownPaths()).filter((p) => this.canRead(p));
  }

  async read(input: string): Promise<Doc> {
    return this.vault.read(this.requireRead(input));
  }

  async readRaw(input: string) {
    return this.vault.readRaw(this.requireRead(input));
  }

  async outline(input: string): Promise<Outline> {
    const doc = await this.read(input);
    const fm = parseFrontmatter(doc.content);
    const visible = await this.visibleMarkdown();
    return {
      path: doc.path,
      hash: doc.hash,
      lines: doc.content.split("\n").length,
      bytes: Buffer.byteLength(doc.content),
      frontmatter: fm.data,
      ...(fm.error ? { frontmatterError: fm.error } : {}),
      headings: headings(doc.content),
      links: wikilinkTargets(doc.content).map((target) => ({ target, path: resolveLink(target, visible) })),
    };
  }

  async section(input: string, opts: { heading?: string; startLine?: number; endLine?: number }): Promise<Section & { path: string; hash: string }> {
    const doc = await this.read(input);
    try {
      return { path: doc.path, hash: doc.hash, ...section(doc.content, opts) };
    } catch (e) {
      if (e instanceof RangeError) throw new PathError(e.message);
      throw e;
    }
  }

  async frontmatterList(folder?: string, fields?: string[]) {
    const docs = await this.documents(folder);
    const out: { path: string; frontmatter: Record<string, unknown> | null; error?: string }[] = [];
    for (const d of docs) {
      const { content } = await this.vault.read(d.path);
      const fm = parseFrontmatter(content);
      let data = fm.data;
      if (data && fields && fields.length > 0) data = Object.fromEntries(fields.filter((k) => k in data!).map((k) => [k, data![k]]));
      out.push({ path: d.path, frontmatter: data, ...(fm.error ? { error: fm.error } : {}) });
    }
    return out;
  }

  /**
   * 전체 텍스트 검색(공백으로 나눈 모든 단어가 본문·제목·경로 어딘가에 있는 문서).
   * 인덱스는 권한을 모르므로, 결과를 여기서 권한으로 거른 뒤 자른다.
   * `#태그`로 시작하는 단어는 태그 조건으로 쓴다.
   */
  async search(query: string, opts: { folder?: string; limit?: number } = {}): Promise<SearchHit[]> {
    const words = query.split(/\s+/).filter(Boolean);
    const tagTerms = words.filter((w) => w.startsWith("#") && w.length > 1).map((w) => w.slice(1).toLowerCase());
    const textTerms = words.filter((w) => !(w.startsWith("#") && w.length > 1));
    if (tagTerms.length === 0 && textTerms.length === 0) throw new PathError("검색어가 필요합니다");
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const f = normalizeFolder(opts.folder);
    const inScope = (p: string) => this.canRead(p) && (!f || p.startsWith(f + "/"));

    let candidates: { path: string; title: string; body: string }[];
    if (textTerms.length > 0) {
      candidates = this.index.search(textTerms.join(" "));
    } else {
      const docs = this.index.docs();
      candidates = docs.map((d) => ({ path: d.path, title: d.title, body: "" }));
    }
    let tagged: Set<string> | null = null;
    if (tagTerms.length > 0) {
      const byPath = new Map<string, string[]>();
      for (const r of this.index.tagRows()) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r.tag]);
      tagged = new Set(
        [...byPath.entries()]
          .filter(([, tags]) => tagTerms.every((t) => tags.some((x) => x === t || x.startsWith(t + "/"))))
          .map(([p]) => p),
      );
    }
    const lowered = textTerms.map((t) => t.toLowerCase());
    const hits: SearchHit[] = [];
    for (const c of candidates) {
      if (!inScope(c.path) || (tagged && !tagged.has(c.path))) continue;
      const lines = c.body.split("\n");
      const idx = lowered.length ? lines.findIndex((l) => lowered.some((t) => l.toLowerCase().includes(t))) : -1;
      hits.push({ path: c.path, title: c.title, line: idx < 0 ? 1 : idx + 1, snippet: idx < 0 ? "" : lines[idx].trim().slice(0, 200) });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** 이 문서를 링크한 문서들 중 읽을 수 있는 것만. */
  async backlinks(input: string): Promise<{ path: string; title: string }[]> {
    const rel = this.requireRead(input);
    const titles = new Map(this.index.docs().map((d) => [d.path, d.title]));
    return this.index
      .backlinks(rel)
      .filter((p) => this.canRead(p))
      .map((p) => ({ path: p, title: titles.get(p) ?? p }));
  }

  /** 읽을 수 있는 문서에 쓰인 태그와 개수. */
  async tags(): Promise<{ tag: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const r of this.index.tagRows()) if (this.canRead(r.path)) counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ko"));
  }

  private visibleDocs(): DocMeta[] {
    return this.index.docs().filter((d) => this.canRead(d.path));
  }

  /** 문서 안 ```widget 블록(YAML)을 실행한다. 보이는 문서만 대상으로 한다. */
  async widget(source: string): Promise<WidgetResult> {
    const spec = parseWidget(source);
    const visible = this.visibleDocs();
    const paths = new Set(visible.map((d) => d.path));
    return runWidget(spec, visible, this.index.tasks().filter((t) => paths.has(t.path)));
  }

  /** 할 일 체크 상태를 바꾼다. baseHash가 현재 버전과 같아야 한다. */
  async setTask(input: string, line: number, done: boolean, baseHash: string) {
    const rel = this.requireRead(input);
    const doc = await this.vault.read(rel);
    if (doc.hash !== baseHash) throw new ConflictError(doc.hash, undefined, rel);
    const next = setTaskState(doc.content, line, done);
    if (next === null) throw new PathError(`${line}번째 줄은 할 일이 아닙니다`);
    return this.write(rel, next, baseHash);
  }

  /** 모든 변경의 입구. 경로마다 최소 권한을 먼저 확인한 뒤, 연산 종류별 권한은 계획 단계에서 검사한다. */
  async batch(ops: Op[], message?: string): Promise<BatchResult> {
    if (!Array.isArray(ops)) throw new PathError("operations가 필요합니다");
    for (const op of ops) {
      if (!op || typeof op !== "object") throw new PathError("연산 형식이 잘못되었습니다");
      if (op.op === "move") {
        this.requireLevel(normalizeVaultPath(op.from), "delete");
        this.requireLevel(normalizeVaultPath(op.to), "append");
      } else if (op.op === "write" || op.op === "append" || op.op === "delete") {
        this.requireLevel(normalizeVaultPath(op.path), op.op === "delete" ? "delete" : "append");
      } else {
        throw new PathError(`알 수 없는 연산입니다: ${(op as { op: unknown }).op}`);
      }
    }
    return this.vault.batch(ops, this.author, {
      message,
      guard: (action, rel) => {
        const need = ACTION_LEVEL[action];
        if (!atLeast(this.level(rel), need)) {
          const hint = action === "modify" && this.level(rel) === "append" ? " — 추가 전용: 기존 내용은 바꿀 수 없고 끝에 덧붙이기만 됩니다" : "";
          throw new ForbiddenError(`권한이 없습니다(${need} 필요): ${rel}${hint}`);
        }
      },
    });
  }

  private async single(op: Op): Promise<Doc & { rev: string | null }> {
    const res = await this.batch([op]);
    const target = op.op === "move" ? op.to : op.path;
    const doc = await this.vault.read(normalizeVaultPath(target));
    return { ...doc, rev: res.rev };
  }

  write(path: string, content: string, baseHash: string | null) {
    return this.single({ op: "write", path, content, baseHash });
  }

  append(path: string, content: string, baseHash?: string | null) {
    return this.single({ op: "append", path, content, baseHash });
  }

  move(from: string, to: string, baseHash: string) {
    return this.single({ op: "move", from, to, baseHash });
  }

  async delete(path: string, baseHash: string): Promise<{ rev: string | null }> {
    const res = await this.batch([{ op: "delete", path, baseHash }]);
    return { rev: res.rev };
  }

  async history(input: string): Promise<CommitInfo[]> {
    const commits = await this.vault.history(this.requireRead(input));
    if (this.principal.kind === "owner") return commits;
    // 이동 커밋 제목에 숨김 경로가 들어 있으면 가린다.
    return commits.map((c) => {
      const m = /^이동: (.+) → (.+)$/.exec(c.message);
      if (m && !(this.safeCanRead(m[1]) && this.safeCanRead(m[2]))) return { ...c, message: "이동: (숨김 경로)" };
      return c;
    });
  }

  private safeCanRead(p: string): boolean {
    try {
      return this.canRead(normalizeVaultPath(p));
    } catch {
      return false;
    }
  }

  async revision(input: string, rev: string) {
    return this.vault.revision(this.requireRead(input), rev);
  }

  /** 과거 리비전의 내용으로 되돌린다. 이력은 지우지 않고 새 커밋으로 남긴다. */
  async rollback(input: string, rev: string, baseHash: string | null) {
    const rel = this.requireRead(input);
    const old = await this.vault.git.show(rev, rel);
    if (old === null) throw new NotFoundError(`해당 리비전에 문서가 없습니다: ${rev.slice(0, 7)}`);
    const res = await this.batch([{ op: "write", path: rel, content: old, baseHash }], `되돌리기: ${rel} @ ${rev.slice(0, 7)}`);
    return { path: rel, content: old, hash: hashContent(old), rev: res.rev };
  }

  /** 에이전트가 자기 권한 표를 확인할 때. */
  whoami() {
    return this.principal.kind === "owner"
      ? { name: this.principal.name, kind: "owner", rules: { "/": "delete" as Level } }
      : { name: this.principal.name, kind: "agent", rules: this.principal.policy.toJSON() };
  }
}

function normalizeFolder(folder?: string): string {
  if (!folder || folder.trim() === "" || folder.trim() === "/") return "";
  return normalizeVaultPath(folder.replace(/\/+$/, ""));
}
