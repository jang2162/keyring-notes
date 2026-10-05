import { atLeast, levelOf, type Level, type Principal } from "./access.js";
import type { Author, CommitInfo } from "./git.js";
import { headings, parseFrontmatter, resolveLink, section, setTaskState, sourceTargets, wikilinkTargets, type Heading, type Section } from "./markdown.js";
import type { DocMeta, NoteIndex } from "./noteindex.js";
import type { ReviewQueue } from "./review.js";
import { parseWidget, runWidget, type WidgetResult } from "./query.js";
import { normalizeVaultPath, PathError } from "./paths.js";
import { isSchemaPath, schemaTemplate, type Wiki } from "./wiki.js";
import { ConflictError, ForbiddenError, hashContent, NotFoundError, type Action, type BatchResult, type Doc, type Op, type TreeNode, type Vault } from "./vault.js";

export type LintKind = "broken_link" | "broken_source" | "orphan" | "no_sources" | "missing_frontmatter" | "stale" | "unprocessed_raw";

export interface LintIssue {
  kind: LintKind;
  path: string;
  /** 사람이 읽을 설명 */
  detail: string;
  target?: string;
}

export interface LintReport {
  checkedAt: string;
  folder: string | null;
  counts: Partial<Record<LintKind, number>>;
  issues: LintIssue[];
}

export interface PendingInfo {
  proposal: string;
  message: string;
}

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
    private wiki?: Wiki,
    private review?: ReviewQueue,
  ) {}

  get author(): Author {
    return { name: this.principal.name, email: this.principal.email };
  }

  level(relPath: string): Level {
    const level = levelOf(this.principal, relPath);
    // 위키 SCHEMA.md는 사람만 고친다. 에이전트 규칙이 무엇이든 읽기까지만.
    if (this.principal.kind === "agent" && isSchemaPath(relPath) && atLeast(level, "append")) return "read";
    return level;
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

  async read(input: string): Promise<Doc & { generated?: true }> {
    const rel = this.requireRead(input);
    if (this.wiki?.isGenerated(rel)) {
      // 위키 index·log는 읽는 사람이 볼 수 있는 문서만으로 다시 만든다.
      const content = this.principal.kind === "owner" ? (await this.vault.read(rel)).content : await this.wiki.render(rel, (p) => this.canRead(p));
      return { path: rel, content, hash: hashContent(content), generated: true };
    }
    return this.vault.read(rel);
  }

  async readRaw(input: string) {
    const rel = this.requireRead(input);
    if (this.wiki?.isGenerated(rel)) {
      const doc = await this.read(rel);
      return { path: rel, data: Buffer.from(doc.content) };
    }
    return this.vault.readRaw(rel);
  }

  /** 최상위 폴더(토픽) 목록. 위키 토픽이면 페이지·원본 수를 함께. */
  async topics(): Promise<{ name: string; wiki: boolean; pages: number; raw: number; access: Level | "partial" }[]> {
    const tree = await this.tree();
    const docs = this.visibleDocs();
    return tree
      .filter((n) => n.type === "dir")
      .map((n) => {
        const wiki = this.wiki?.topics.has(n.name) ?? false;
        return {
          name: n.name,
          wiki,
          pages: wiki ? docs.filter((d) => d.path.startsWith(`${n.name}/wiki/`)).length : 0,
          raw: wiki ? docs.filter((d) => d.path.startsWith(`${n.name}/raw/`) && !d.path.startsWith(`${n.name}/raw/assets/`)).length : 0,
          // 토픽 자체 규칙은 숨김이지만 하위 폴더 규칙으로 일부가 보이면 "partial"
          access: this.level(n.name) === "hidden" ? ("partial" as const) : this.level(n.name),
        };
      });
  }

  /** 새 위키 토픽(SCHEMA.md 템플릿). 소유자만. 기존 폴더에 만들면 그 폴더가 위키 토픽이 된다. */
  async createTopic(name: string): Promise<{ topic: string; schema: string }> {
    if (this.principal.kind !== "owner") throw new ForbiddenError("위키 토픽은 소유자만 만들 수 있습니다");
    const topic = normalizeVaultPath(name.trim());
    if (topic.includes("/")) throw new PathError("토픽 이름에는 /를 쓸 수 없습니다(최상위 폴더 하나)");
    if (this.wiki?.topics.has(topic)) throw new ConflictError(null, "이미 위키 토픽입니다", topic);
    const schema = `${topic}/SCHEMA.md`;
    await this.batch([{ op: "write", path: schema, content: schemaTemplate(topic), baseHash: null }], `위키 토픽 만들기: ${topic}`);
    return { topic, schema };
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
      if (this.wiki?.isGenerated(d.path)) continue;
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

  /** 읽을 수 있는 모든 파일 경로(첨부 포함). */
  private async visibleFiles(): Promise<string[]> {
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

  /**
   * 출처 연결(W6): 이 문서의 프런트매터 sources가 가리키는 문서(볼 수 없거나 없으면 path=null),
   * 이 문서를 출처로 인용한 문서, 본문에서 링크한 문서.
   */
  async sources(input: string): Promise<{
    path: string;
    sources: { target: string; path: string | null }[];
    citedBy: { path: string; title: string }[];
    linkedBy: { path: string; title: string }[];
  }> {
    const doc = await this.read(input);
    const fm = parseFrontmatter(doc.content).data;
    const files = await this.visibleFiles();
    const titles = new Map(this.index.docs().map((d) => [d.path, d.title]));
    const withTitle = (paths: string[]) => paths.filter((p) => this.canRead(p)).map((p) => ({ path: p, title: titles.get(p) ?? p }));
    return {
      path: doc.path,
      sources: sourceTargets(fm).map((target) => ({ target, path: resolveLink(target, files) })),
      citedBy: withTitle(this.index.backlinks(doc.path, "source")),
      linkedBy: withTitle(this.index.backlinks(doc.path, "link")),
    };
  }

  /**
   * 구조적 정리(W7). 볼 수 있는 문서만 대상으로 한다.
   * - 모든 문서: 깨진 위키링크, 깨진 출처(볼 수 없는 대상도 "없거나 볼 수 없음"으로 같이 센다)
   * - 위키 페이지(<토픽>/wiki/): 고아(아무 데서도 링크·인용 안 됨), 출처 없음, 필수 프런트매터 누락, 오래됨
   * - 위키 원본(<토픽>/raw/): 어느 위키 페이지에서도 인용되지 않음
   */
  async lint(opts: { folder?: string; staleDays?: number; required?: string[] } = {}): Promise<LintReport> {
    const f = normalizeFolder(opts.folder);
    const staleDays = opts.staleDays ?? 180;
    const required = opts.required ?? ["title", "summary"];
    const files = await this.visibleFiles();
    const docs = this.visibleDocs().filter((d) => !this.wiki?.isGenerated(d.path));
    const inScope = (p: string) => !f || p === f || p.startsWith(f + "/");
    const isWikiPage = (p: string) => {
      const t = this.wiki?.topicOf(p);
      return !!t && p.startsWith(`${t}/wiki/`);
    };
    const isRaw = (p: string) => {
      const t = this.wiki?.topicOf(p);
      return !!t && p.startsWith(`${t}/raw/`) && !p.startsWith(`${t}/raw/assets/`);
    };

    // 들어오는 링크·인용(볼 수 있는 문서에서, 자기 자신 제외)
    const incoming = new Map<string, number>();
    const citedByWiki = new Set<string>();
    const issues: LintIssue[] = [];
    const rows = this.index.db.prepare("SELECT src, target, kind FROM links").all() as { src: string; target: string; kind: string }[];
    for (const r of rows) {
      if (!this.canRead(r.src) || this.wiki?.isGenerated(r.src)) continue;
      const to = resolveLink(r.target, files);
      if (to && to !== r.src) {
        incoming.set(to, (incoming.get(to) ?? 0) + 1);
        if (isWikiPage(r.src)) citedByWiki.add(to);
      }
      if (!to && inScope(r.src)) {
        issues.push(
          r.kind === "source"
            ? { kind: "broken_source", path: r.src, target: r.target, detail: `출처 "${r.target}"가 없거나 볼 수 없음` }
            : { kind: "broken_link", path: r.src, target: r.target, detail: `링크 [[${r.target}]]의 대상이 없거나 볼 수 없음` },
        );
      }
    }

    const now = Date.now();
    for (const d of docs) {
      if (!inScope(d.path)) continue;
      if (isWikiPage(d.path)) {
        if (!incoming.get(d.path)) issues.push({ kind: "orphan", path: d.path, detail: "다른 문서에서 링크하거나 인용하지 않음" });
        const src = d.frontmatter?.sources;
        if (!src || (Array.isArray(src) && src.length === 0)) issues.push({ kind: "no_sources", path: d.path, detail: "프런트매터 sources(근거 원본)가 없음" });
        const missing = required.filter((k) => {
          const v = d.frontmatter?.[k];
          return v === undefined || v === null || (typeof v === "string" && !v.trim());
        });
        if (missing.length) issues.push({ kind: "missing_frontmatter", path: d.path, detail: `프런트매터 누락: ${missing.join(", ")}` });
        const updatedRaw = d.frontmatter?.updated;
        const updated = typeof updatedRaw === "string" && !Number.isNaN(Date.parse(updatedRaw)) ? Date.parse(updatedRaw) : d.mtime;
        const age = Math.floor((now - updated) / 86400_000);
        if (age > staleDays) issues.push({ kind: "stale", path: d.path, detail: `${age}일 동안 갱신되지 않음(기준 ${staleDays}일)` });
      } else if (isRaw(d.path) && !citedByWiki.has(d.path)) {
        issues.push({ kind: "unprocessed_raw", path: d.path, detail: "어느 위키 페이지에서도 인용하지 않은 원본" });
      }
    }

    const order: LintKind[] = ["broken_link", "broken_source", "missing_frontmatter", "no_sources", "orphan", "stale", "unprocessed_raw"];
    issues.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path, "ko"));
    const counts: Partial<Record<LintKind, number>> = {};
    for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    return { checkedAt: new Date().toISOString(), folder: f || null, counts, issues };
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
  async batch(ops: Op[], message?: string): Promise<BatchResult & { pending?: PendingInfo }> {
    if (!Array.isArray(ops)) throw new PathError("operations가 필요합니다");
    for (const op of ops) {
      if (!op || typeof op !== "object") throw new PathError("연산 형식이 잘못되었습니다");
      if (op.op === "move") {
        this.requireLevel(normalizeVaultPath(op.from), "delete");
        this.requireLevel(normalizeVaultPath(op.to), "append");
      } else if (op.op === "put") {
        this.requireLevel(normalizeVaultPath(op.path), "append");
      } else if (op.op === "write" || op.op === "append" || op.op === "delete") {
        this.requireLevel(normalizeVaultPath(op.path), op.op === "delete" ? "delete" : "append");
      } else {
        throw new PathError(`알 수 없는 연산입니다: ${(op as { op: unknown }).op}`);
      }
    }
    const guard = (action: Action, rel: string) => {
      const need = ACTION_LEVEL[action];
      if (!atLeast(this.level(rel), need)) {
        const hint = action === "modify" && this.level(rel) === "append" ? " — 추가 전용: 기존 내용은 바꿀 수 없고 끝에 덧붙이기만 됩니다" : "";
        throw new ForbiddenError(`권한이 없습니다(${need} 필요): ${rel}${hint}`);
      }
    };
    // 검토 대상 경로에 에이전트가 쓰면: 권한·충돌만 지금 검사하고, 적용은 사람이 승인할 때.
    if (this.principal.kind === "agent" && this.review) {
      const touched = ops.flatMap((op) => (op.op === "move" ? [op.from, op.to] : [op.path])).map((p) => normalizeVaultPath(p));
      if (this.review.needsReview(touched)) {
        const dry = await this.vault.batch(ops, this.author, { message, guard, dryRun: true });
        if (!dry.preview || dry.preview.length === 0) return { rev: null, files: dry.files };
        const proposal = await this.review.create(this.author, ops, message, dry.preview);
        return {
          rev: null,
          files: dry.files,
          preview: dry.preview,
          pending: { proposal: proposal.id, message: "검토 대기열에 올렸습니다. 사람이 승인하면 반영됩니다(그 전까지 볼트는 그대로)." },
        };
      }
    }
    return this.vault.batch(ops, this.author, { message, guard });
  }

  /** 에이전트가 자기 제안의 처리 결과를 확인할 때. */
  async myProposals() {
    if (!this.review) return [];
    return this.review.list(this.principal.kind === "agent" ? { agent: this.principal.name } : {});
  }

  /**
   * 문서 하나를 바꾼다. 검토 대기열에 올라가면(pending) 볼트는 그대로이고,
   * content·hash는 승인 뒤의 내용·해시를 돌려준다.
   */
  private async single(op: Op): Promise<Doc & { rev: string | null; pending?: PendingInfo }> {
    if (op.op === "put") throw new PathError("put은 batch로만 쓸 수 있습니다");
    const res = await this.batch([op]);
    const target = normalizeVaultPath(op.op === "move" ? op.to : op.path);
    if (res.pending) {
      const p = res.preview?.find((f) => f.path === target);
      return { path: target, content: p?.after ?? "", hash: p?.afterHash ?? "", rev: null, pending: res.pending };
    }
    const doc = await this.vault.read(target);
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

  async delete(path: string, baseHash: string): Promise<{ rev: string | null; pending?: PendingInfo }> {
    const res = await this.batch([{ op: "delete", path, baseHash }]);
    return res.pending ? { rev: null, pending: res.pending } : { rev: res.rev };
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
