import { atLeast, levelOf, type Level, type Principal } from "./access.js";
import { agentText, type AgentLang } from "./agentText.js";
import type { Author, CommitInfo } from "./git.js";
import {
  headings,
  linkGraph,
  lintVault,
  normalizeFolder,
  parseFrontmatter,
  parseWidget,
  resolveLink,
  runWidget,
  section,
  setTaskState,
  sourceRefs,
  anchorExists,
  mentionNames,
  propertyStats,
  type PropertyStat,
  unlinkedMentions,
  type Mention,
  wikilinkTargets,
  type GraphData,
  type Heading,
  type LinkRow,
  type LintReport,
  type Section,
  type WidgetResult,
  isVaultSettingsPath,
  isTopicName,
  translate,
  nodeFiles,
  moveNodePath,
  inTrashScope,
  restoreTargets,
  trashHead,
  trashOrder,
  TRASH_PAGE,
  type TrashItem,
  type TrashPage,
} from "@keyring-notes/core";
import { BLOB_INDEX } from "./blobs.js";
import type { DocMeta, NoteIndex } from "./noteindex.js";
import type { ReviewQueue } from "./review.js";
import type { SemanticIndex } from "./embeddings.js";
import { isMarkdown, normalizeVaultPath, PathError } from "./paths.js";
import { isSchemaPath, schemaTemplate, type Wiki } from "./wiki.js";
import {
  ConflictError,
  ForbiddenError,
  hashContent,
  NotFoundError,
  type Action,
  type BatchResult,
  type Doc,
  type LinkUpdateOptions,
  type Op,
  type TreeNode,
  type Vault,
} from "./vault.js";

export type { LintIssue, LintKind, LintReport } from "@keyring-notes/core";

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
    private semanticIndex?: SemanticIndex,
  ) {}

  /** 에이전트에게 가는 글의 언어(서버 설정) */
  agentLang: AgentLang = "en";

  get author(): Author {
    return { name: this.principal.name, email: this.principal.email };
  }

  level(relPath: string): Level {
    const level = levelOf(this.principal, relPath);
    // 위키 SCHEMA.md와 모든 기기 공통 설정 파일(서버의 링크 해석·데일리 판정을 바꾼다)은 사람만 고친다.
    // 에이전트 규칙이 무엇이든 읽기까지만.
    if (this.principal.kind === "agent" && (isSchemaPath(relPath) || isVaultSettingsPath(relPath)) && atLeast(level, "append")) return "read";
    return level;
  }

  /**
   * 링크 해석 옵션: 워크스페이스별 데일리 설정(공통 설정 파일)과 링크를 쓴 문서(같은 워크스페이스 먼저).
   * 링크는 늘 읽는 사람에게 보이는 문서 안에서만 해석한다(부르는 쪽이 보이는 경로 목록을 넘긴다)
   */
  private linkOpts(from: string) {
    return { daily: this.vault.daily(), from };
  }

  private canRead(relPath: string): boolean {
    return atLeast(this.level(relPath), "read");
  }

  /** 읽기 권한 확인. 숨김이면 없는 문서와 같은 오류를 낸다. */
  private requireRead(input: string): string {
    const rel = normalizeVaultPath(input);
    if (!this.canRead(rel)) throw new NotFoundError("doc_missing", { path: rel });
    return rel;
  }

  private requireLevel(rel: string, level: Level) {
    if (!atLeast(this.level(rel), level)) {
      // 숨김 경로는 존재 여부와 상관없이 같은 메시지를 낸다.
      throw new ForbiddenError("forbidden_level", { level: this.level(rel), path: rel });
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

  /** 파일 트리(볼 수 있는 것만). 문서에는 아이콘(프런트매터 icon)을 붙인다 */
  async tree(folder?: string): Promise<TreeNode[]> {
    let nodes = this.withIcons(this.filterTree(await this.vault.tree()));
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
      if (!found) throw new NotFoundError("folder_missing", { path: f });
      nodes = found;
    }
    return nodes;
  }

  private withIcons(nodes: TreeNode[]): TreeNode[] {
    const icons = new Map<string, string>();
    for (const d of this.index.docs()) {
      const icon = d.frontmatter?.icon;
      if (typeof icon === "string" && icon.trim()) icons.set(d.path, icon.trim());
    }
    const walk = (ns: TreeNode[]): TreeNode[] =>
      ns.map((n) => (n.type === "dir" ? { ...n, children: walk(n.children ?? []) } : icons.has(n.path) ? { ...n, icon: icons.get(n.path) } : n));
    return icons.size ? walk(nodes) : nodes;
  }

  /** 읽을 수 있는 문서 목록(평면). */
  async documents(folder?: string): Promise<{ path: string; access: Level }[]> {
    const f = normalizeFolder(folder);
    return (await this.visibleMarkdown()).filter((p) => !f || p.startsWith(f + "/")).map((p) => ({ path: p, access: this.level(p) }));
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

  /**
   * 토픽 목록: 워크스페이스 바로 아래 노드(`<워크스페이스>/<이름>`, 볼 수 있는 것만). 위키 토픽이면 페이지·원본 수를 함께.
   */
  async topics(): Promise<{ name: string; workspace: string; wiki: boolean; pages: number; raw: number; access: Level | "partial" }[]> {
    const tree = await this.tree();
    const docs = this.visibleDocs();
    const names = new Set<string>();
    for (const ws of tree) {
      if (ws.type !== "dir") continue;
      for (const n of ws.children ?? []) {
        if (n.type === "dir") names.add(n.path);
        else if (/\.md$/i.test(n.name)) names.add(n.path.replace(/\.md$/i, ""));
      }
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => {
        const wiki = this.wiki?.topics.has(name) ?? false;
        return {
          name,
          workspace: name.split("/")[0],
          wiki,
          pages: wiki ? docs.filter((d) => d.path.startsWith(`${name}/wiki/`)).length : 0,
          raw: wiki ? docs.filter((d) => d.path.startsWith(`${name}/raw/`) && !d.path.startsWith(`${name}/raw/assets/`)).length : 0,
          // 토픽 자체 규칙은 숨김이지만 하위 규칙으로 일부가 보이면 "partial"
          access: this.level(name) === "hidden" ? ("partial" as const) : this.level(name),
        };
      });
  }

  /** 새 위키 토픽(SCHEMA.md 템플릿, 볼트 언어). 소유자만. 이름은 워크스페이스/토픽. 기존 노드에 만들면 그 노드가 위키 토픽이 된다. */
  async createTopic(name: string): Promise<{ topic: string; schema: string }> {
    if (this.principal.kind !== "owner") throw new ForbiddenError("topic_owner_only");
    const topic = normalizeVaultPath(name.trim());
    if (!isTopicName(topic)) throw new PathError("topic_name");
    if (this.wiki?.topics.has(topic)) throw new ConflictError(null, "topic_exists_name", { topic });
    const schema = `${topic}/SCHEMA.md`;
    await this.batch(
      [{ op: "write", path: schema, content: schemaTemplate(topic, this.vault.language()), baseHash: null }],
      this.vault.text().commit.createTopic(topic),
    );
    return { topic, schema };
  }

  /** 노드의 바로 아래 노드(볼 수 있는 것만): 이름·노드 노트·하위가 있는지·첨부 수. path가 ""면 워크스페이스 목록 */
  async children(input?: string): Promise<{ name: string; path: string; note: string | null; hasChildren: boolean; attachments: number }[]> {
    const node = input ? normalizeVaultPath(input).replace(/\.md$/i, "") : "";
    let nodes = await this.tree();
    if (node) {
      const find = (ns: TreeNode[]): TreeNode[] | null => {
        for (const n of ns) {
          if (n.type !== "dir") continue;
          if (n.path === node) return n.children ?? [];
          if (node.startsWith(n.path + "/")) return find(n.children ?? []);
        }
        return null;
      };
      const noteVisible = this.canRead(`${node}.md`) && (await this.vault.markdownPaths()).includes(`${node}.md`);
      const found = find(nodes);
      if (!found && !noteVisible) throw new NotFoundError("node_missing", { path: node });
      nodes = found ?? [];
    }
    const out = new Map<string, { name: string; path: string; note: string | null; hasChildren: boolean; attachments: number }>();
    const get = (name: string, path: string) => out.get(name) ?? out.set(name, { name, path, note: null, hasChildren: false, attachments: 0 }).get(name)!;
    for (const n of nodes) {
      if (!node && n.type === "file" && isVaultSettingsPath(n.path)) continue;
      if (n.type === "dir") {
        const e = get(n.name, n.path);
        e.hasChildren = (n.children ?? []).some((c) => c.type === "dir" || /\.md$/i.test(c.name));
        e.attachments = (n.children ?? []).filter((c) => c.type === "file" && !/\.md$/i.test(c.name)).length;
      } else if (/\.md$/i.test(n.name)) {
        get(n.name.replace(/\.md$/i, ""), n.path.replace(/\.md$/i, "")).note = n.path;
      }
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
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
      links: wikilinkTargets(doc.content).map((target) => ({ target, path: resolveLink(target, visible, this.linkOpts(doc.path)) })),
    };
  }

  async section(input: string, opts: { heading?: string; startLine?: number; endLine?: number }): Promise<Section & { path: string; hash: string }> {
    const doc = await this.read(input);
    return { path: doc.path, hash: doc.hash, ...section(doc.content, opts) };
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
    if (tagTerms.length === 0 && textTerms.length === 0) throw new PathError("query_required");
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const f = normalizeFolder(opts.folder);
    // 공통 설정 파일은 검색에 나오지 않는다(설정 화면에서 고친다)
    const inScope = (p: string) => this.canRead(p) && !isVaultSettingsPath(p) && (!f || p === `${f}.md` || p.startsWith(f + "/"));

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
      tagged = new Set([...byPath.entries()].filter(([, tags]) => tagTerms.every((t) => tags.some((x) => x === t || x.startsWith(t + "/")))).map(([p]) => p));
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
      .backlinks(rel, undefined, this.vault.daily())
      .filter((p) => this.canRead(p))
      .map((p) => ({ path: p, title: titles.get(p) ?? p }));
  }

  /**
   * 연결되지 않은 언급: 이 문서의 이름(파일 이름·title·aliases)이 링크 없이 나오는 다른 문서.
   * 후보는 검색 인덱스로 좁히고, 읽을 수 있는 문서만 원문을 읽어 확인한다.
   */
  async mentions(input: string): Promise<{ path: string; names: string[]; docs: { path: string; title: string; hash: string; mentions: Mention[] }[] }> {
    const doc = await this.read(input);
    const names = mentionNames(doc.path, parseFrontmatter(doc.content).data);
    const titles = new Map(this.index.docs().map((d) => [d.path, d.title]));
    const candidates = new Set<string>();
    for (const name of names) for (const hit of this.index.search(name)) candidates.add(hit.path);
    const out: { path: string; title: string; hash: string; mentions: Mention[] }[] = [];
    for (const p of [...candidates].sort()) {
      if (p === doc.path || !this.canRead(p) || this.wiki?.isGenerated(p)) continue;
      let other: Doc;
      try {
        other = await this.vault.read(p);
      } catch {
        continue; // 인덱스와 파일이 잠시 어긋난 경우
      }
      const found = unlinkedMentions(other.content, names);
      if (found.length) out.push({ path: p, title: titles.get(p) ?? p, hash: other.hash, mentions: found.slice(0, 50) });
      if (out.length >= 100) break;
    }
    return { path: doc.path, names, docs: out };
  }

  /** 볼 수 있는 문서들의 속성(프런트매터) 이름·종류·자주 쓴 값. 속성 입력 화면의 자동완성용 */
  properties(): PropertyStat[] {
    return propertyStats(this.visibleDocs().filter((d) => !this.wiki?.isGenerated(d.path) && !isVaultSettingsPath(d.path)));
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
    sources: { target: string; path: string | null; anchor?: string }[];
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
      sources: sourceRefs(fm).map((r) => ({
        target: r.target,
        path: resolveLink(r.target, files, this.linkOpts(doc.path)),
        ...(r.anchor ? { anchor: r.anchor } : {}),
      })),
      citedBy: withTitle(this.index.backlinks(doc.path, "source", this.vault.daily())),
      linkedBy: withTitle(this.index.backlinks(doc.path, "link", this.vault.daily())),
    };
  }

  /**
   * 구조적 정리(W7). 볼 수 있는 문서만 대상으로 한다.
   * - 모든 문서: 깨진 위키링크, 깨진 출처(볼 수 없는 대상도 "없거나 볼 수 없음"으로 같이 센다)
   * - 위키 페이지(<토픽>/wiki/): 고아(아무 데서도 링크·인용 안 됨), 출처 없음, 필수 프런트매터 누락, 오래됨
   * - 위키 원본(<토픽>/raw/): 어느 위키 페이지에서도 인용되지 않음
   */
  async lint(opts: { folder?: string; staleDays?: number; required?: string[] } = {}): Promise<LintReport> {
    const files = await this.visibleFiles();
    // 문단·제목을 가리키는 출처(`[[원본#^id]]`)가 실제로 있는지: 볼 수 있는 대상만 읽어 본다
    const missingAnchors: { src: string; target: string; anchor: string }[] = [];
    for (const d of this.visibleDocs()) {
      for (const r of sourceRefs(d.frontmatter)) {
        if (!r.anchor) continue;
        const to = resolveLink(r.target, files, this.linkOpts(d.path));
        if (!to || !/\.md$/i.test(to)) continue;
        const content = await this.vault.read(to).then(
          (x) => x.content,
          () => null,
        );
        if (content !== null && !anchorExists(content, r.anchor)) missingAnchors.push({ src: d.path, target: r.target, anchor: r.anchor });
      }
    }
    return lintVault({
      missingAnchors,
      docs: this.visibleDocs(),
      files,
      links: this.index.db.prepare("SELECT src, target, kind FROM links").all() as unknown as LinkRow[],
      canRead: (p) => this.canRead(p),
      wiki: this.wiki,
      folder: normalizeFolder(opts.folder),
      staleDays: opts.staleDays,
      required: opts.required,
      daily: this.vault.daily(),
    });
  }

  /**
   * 그래프 뷰(W9): 볼 수 있는 문서(자동 생성 문서 제외)와 그 사이의 링크(본문 링크·출처).
   * 숨김 문서로 가는 링크는 아예 빠진다.
   */
  async graph(folder?: string): Promise<GraphData> {
    return linkGraph({
      docs: this.visibleDocs(),
      links: this.index.db.prepare("SELECT src, target, kind FROM links").all() as unknown as LinkRow[],
      wiki: this.wiki,
      folder: normalizeFolder(folder),
      daily: this.vault.daily(),
    });
  }

  /** 의미 검색(임베딩). 설정하지 않았으면 오류. 볼 수 있는 문서만 대상으로 한다. */
  async semantic(query: string, opts: { folder?: string; limit?: number } = {}) {
    if (!this.semanticIndex) throw new PathError("semantic_off");
    const f = normalizeFolder(opts.folder);
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    return this.semanticIndex.search(
      query,
      (p) => this.canRead(p) && !this.wiki?.isGenerated(p) && !isVaultSettingsPath(p) && (!f || p.startsWith(f + "/")),
      limit,
    );
  }

  /** 읽을 수 있는 문서에 쓰인 태그와 개수. */
  /** 읽을 수 있는 문서의 태그와 개수. folder를 주면 그 노드(노트 포함) 안만 */
  async tags(folder?: string): Promise<{ tag: string; count: number }[]> {
    const f = normalizeFolder(folder);
    const counts = new Map<string, number>();
    for (const r of this.index.tagRows()) {
      if (!this.canRead(r.path) || (f && r.path !== `${f}.md` && !r.path.startsWith(f + "/"))) continue;
      counts.set(r.tag, (counts.get(r.tag) ?? 0) + 1);
    }
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
    return runWidget(
      spec,
      visible,
      this.index.tasks().filter((t) => paths.has(t.path)),
    );
  }

  /** 할 일 체크 상태를 바꾼다. baseHash가 현재 버전과 같아야 한다. */
  async setTask(input: string, line: number, done: boolean, baseHash: string) {
    const rel = this.requireRead(input);
    const doc = await this.vault.read(rel);
    if (doc.hash !== baseHash) throw new ConflictError(doc.hash, "conflict_path", { path: rel });
    const next = setTaskState(doc.content, line, done);
    if (next === null) throw new PathError("not_task", { line });
    return this.write(rel, next, baseHash);
  }

  /** 모든 변경의 입구. 경로마다 최소 권한을 먼저 확인한 뒤, 연산 종류별 권한은 계획 단계에서 검사한다. */
  /**
   * 이동 때 링크 자동 갱신 설정: 에이전트는 자기가 볼 수 있는 경로만으로 해석하고 늘 전체 경로로 쓴다
   * (짧은 이름이 되는지 여부로 숨김 문서가 드러나지 않게). 고칠 문서는 guard(modify)를 지나야 한다.
   */
  private linkOptions(updateLinks: boolean): LinkUpdateOptions {
    if (!updateLinks) return { enabled: false };
    if (this.principal.kind === "owner") return { enabled: true };
    return { enabled: true, canSee: (p) => this.canRead(p), fullPaths: true };
  }

  async batch(ops: Op[], message?: string, opts: { updateLinks?: boolean; coalesce?: boolean } = {}): Promise<BatchResult & { pending?: PendingInfo }> {
    if (!Array.isArray(ops)) throw new PathError("field_required", { field: "operations" });
    for (const op of ops) {
      if (!op || typeof op !== "object") throw new PathError("op_invalid");
      if (op.op === "move") {
        this.requireLevel(normalizeVaultPath(op.from), "delete");
        this.requireLevel(normalizeVaultPath(op.to), "append");
      } else if (op.op === "put") {
        this.requireLevel(normalizeVaultPath(op.path), "append");
      } else if (op.op === "write" || op.op === "append" || op.op === "delete") {
        this.requireLevel(normalizeVaultPath(op.path), op.op === "delete" ? "delete" : "append");
      } else {
        throw new PathError("op_unknown", { op: String((op as { op: unknown }).op) });
      }
    }
    const guard = (action: Action, rel: string) => {
      const need = ACTION_LEVEL[action];
      if (!atLeast(this.level(rel), need)) {
        const appendOnly = action === "modify" && this.level(rel) === "append";
        throw new ForbiddenError(appendOnly ? "forbidden_append_only" : "forbidden_need", { level: need, path: rel });
      }
    };
    const links = this.linkOptions(opts.updateLinks !== false);
    // 검토 대상 경로에 에이전트가 쓰면: 권한·충돌만 지금 검사하고, 적용은 사람이 승인할 때.
    if (this.principal.kind === "agent" && this.review) {
      const touched = ops.flatMap((op) => (op.op === "move" ? [op.from, op.to] : [op.path])).map((p) => normalizeVaultPath(p));
      const hasMove = ops.some((op) => op.op === "move");
      if (this.review.needsReview(touched) || (hasMove && this.review.enabled())) {
        // 이동이면 링크 갱신으로 바뀌는 문서까지 보고 검토 대상인지 정한다(그래서 이동은 늘 먼저 dry run)
        const dry = await this.vault.batch(ops, this.author, { message, guard, dryRun: true, links });
        if (this.review.needsReview([...touched, ...dry.files.map((f) => f.path)])) {
          if (!dry.preview || dry.preview.length === 0) return { rev: null, files: dry.files, linksUpdated: [], linkCount: 0 };
          const proposal = await this.review.create(this.author, ops, message, dry.preview, { enabled: links.enabled !== false, paths: dry.linksUpdated });
          return {
            rev: null,
            files: dry.files,
            linksUpdated: dry.linksUpdated,
            linkCount: dry.linkCount,
            preview: dry.preview,
            pending: { proposal: proposal.id, message: translate(this.agentLang, "server.review_pending") },
          };
        }
        // 검토 대상이 아니면 바로 적용하되, 링크 갱신은 방금 본 문서로만(그 사이 검토 대상 문서가 끼어들지 않게)
        return this.vault.batch(ops, this.author, { message, guard, links: { ...links, only: new Set(dry.linksUpdated) } });
      }
    }
    // 자동 저장 묶기는 사람(소유자)의 웹 편집에만: 에이전트 쓰기는 하나하나 이력에 남긴다
    return this.vault.batch(ops, this.author, { message, guard, links, coalesce: opts.coalesce === true && this.principal.kind === "owner" });
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
  private async single(
    op: Op,
    opts: { updateLinks?: boolean; coalesce?: boolean } = {},
  ): Promise<Doc & { rev: string | null; pending?: PendingInfo; linksUpdated: string[]; linkCount: number }> {
    if (op.op === "put") throw new PathError("put_batch_only");
    const res = await this.batch([op], undefined, opts);
    const target = normalizeVaultPath(op.op === "move" ? op.to : op.path);
    if (res.pending) {
      const p = res.preview?.find((f) => f.path === target);
      return {
        path: target,
        content: p?.after ?? "",
        hash: p?.afterHash ?? "",
        rev: null,
        pending: res.pending,
        linksUpdated: res.linksUpdated,
        linkCount: res.linkCount,
      };
    }
    if (!isMarkdown(target)) {
      // 첨부 이동: 내용 대신 해시만
      return {
        path: target,
        content: "",
        hash: res.files.find((f) => f.path === target)?.hash ?? "",
        rev: res.rev,
        linksUpdated: res.linksUpdated,
        linkCount: res.linkCount,
      };
    }
    const doc = await this.vault.read(target);
    return { ...doc, rev: res.rev, linksUpdated: res.linksUpdated, linkCount: res.linkCount };
  }

  /** coalesce: 자동 저장. 같은 문서를 잇달아 저장하면 직전 커밋에 합친다(소유자만, Vault.COALESCE_WINDOW_MS 안) */
  write(path: string, content: string, baseHash: string | null, opts: { coalesce?: boolean } = {}) {
    return this.single({ op: "write", path, content, baseHash }, opts);
  }

  append(path: string, content: string, baseHash?: string | null) {
    return this.single({ op: "append", path, content, baseHash });
  }

  /** 이동·이름 바꾸기. updateLinks(기본 켬)면 이 문서를 가리키던 링크를 같은 커밋에서 고친다(linksUpdated). */
  move(from: string, to: string, baseHash: string, opts: { updateLinks?: boolean } = {}) {
    return this.single({ op: "move", from, to, baseHash }, opts);
  }

  /** 노드에 드는 파일(노드 노트와 하위 전체) 중 볼 수 있는 것. 자동 생성 문서(위키 index·log)는 뺀다 */
  private async nodeFilesOf(node: string): Promise<string[]> {
    const all: string[] = [];
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (n.type === "dir") walk(n.children ?? []);
        else if (!this.wiki?.isGenerated(n.path)) all.push(n.path);
      }
    };
    walk(await this.tree());
    return nodeFiles(node, all);
  }

  /**
   * 노드 옮기기·이름 바꾸기: 노드 노트(`A.md`)와 하위(`A/` 아래 문서·첨부, 볼 수 있는 것)를 한 번의 일괄 쓰기(한 커밋)로
   * 옮기고 링크를 고친다. 각 파일의 baseHash는 지금 내용으로 정한다(노드 이동은 내용을 바꾸지 않는다).
   */
  async moveNode(fromInput: string, toInput: string, opts: { updateLinks?: boolean } = {}) {
    const from = normalizeVaultPath(fromInput).replace(/\.md$/i, "");
    const to = normalizeVaultPath(toInput).replace(/\.md$/i, "");
    if (from === to) throw new PathError("same_path");
    if (to.startsWith(from + "/")) throw new PathError("node_into_self");
    const files = await this.nodeFilesOf(from);
    if (files.length === 0) throw new NotFoundError("node_missing", { path: from });
    const ops: Op[] = [];
    for (const f of files) {
      const { data } = await this.vault.readRaw(f);
      ops.push({ op: "move", from: f, to: moveNodePath(f, from, to), baseHash: hashContent(data) });
    }
    const res = await this.batch(ops, this.vault.text().commit.nodeMove(from, to), opts);
    return { ...res, moved: ops.map((o) => (o.op === "move" ? [o.from, o.to] : [])) as [string, string][] };
  }

  /**
   * 노드 삭제: 노드 노트와 하위 전체(볼 수 있는 것)를 한 커밋으로 지운다.
   * expect(화면이 지우기 전에 읽은 파일과 해시)를 주면 노드가 그 사이 바뀌었을 때(파일이 늘거나 내용이 바뀜) 충돌로 거부한다.
   */
  async deleteNode(input: string, expect?: { path: string; baseHash: string }[]): Promise<{ rev: string | null; deleted: string[]; pending?: PendingInfo }> {
    const node = normalizeVaultPath(input).replace(/\.md$/i, "");
    const files = await this.nodeFilesOf(node);
    if (files.length === 0) throw new NotFoundError("node_missing", { path: node });
    const given = expect ? new Map(expect.map((e) => [normalizeVaultPath(e.path), e.baseHash])) : null;
    if (given && (given.size !== files.length || files.some((f) => !given.has(f)))) throw new ConflictError(null, "node_children_changed", { path: node });
    const ops: Op[] = [];
    for (const f of files) ops.push({ op: "delete", path: f, baseHash: given?.get(f) ?? hashContent((await this.vault.readRaw(f)).data) });
    const res = await this.batch(ops, this.vault.text().commit.nodeDelete(node));
    return res.pending ? { rev: null, deleted: files, pending: res.pending } : { rev: res.rev, deleted: files };
  }

  /** 첨부 파일 새로 만들기(이미 있으면 충돌). 마크다운은 write로. */
  async putAttachment(input: string, data: Uint8Array): Promise<{ path: string; hash: string | null; rev: string | null; pending?: PendingInfo }> {
    const rel = normalizeVaultPath(input);
    const res = await this.batch([{ op: "put", path: rel, data }]);
    return { path: rel, hash: hashContent(Buffer.from(data)), rev: res.rev, pending: res.pending };
  }

  async delete(path: string, baseHash: string): Promise<{ rev: string | null; pending?: PendingInfo }> {
    const res = await this.batch([{ op: "delete", path, baseHash }]);
    return res.pending ? { rev: null, pending: res.pending } : { rev: res.rev };
  }

  /**
   * 문서 이력. 에이전트에게는 커밋의 실제 변경 목록(이동·노드 이동·일괄 쓰기 모두)에 볼 수 없는 경로가 끼어 있으면
   * 메시지를 가린다. 커밋 메시지(볼트 언어, 사람이 쓴 일괄 쓰기 메시지 포함)의 모양에 기대지 않는다.
   */
  async history(input: string): Promise<CommitInfo[]> {
    const rel = this.requireRead(input);
    if (this.principal.kind === "owner") return this.vault.history(rel);
    const commits = await this.vault.git.logWithChanges(rel);
    return commits.map(({ files, ...c }) => (files.every((p) => this.safeCanRead(p)) ? c : { ...c, message: agentText(this.agentLang).hiddenCommit }));
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
    if (old === null) throw new NotFoundError("rev_doc_missing", { path: rel });
    const res = await this.batch([{ op: "write", path: rel, content: old, baseHash }], this.vault.text().commit.restore(rel, rev.slice(0, 7)));
    return { path: rel, content: old, hash: hashContent(old), rev: res.rev };
  }

  // ── 휴지통(소유자 화면만. 에이전트 도구는 없다) ──

  private requireOwner() {
    if (this.principal.kind !== "owner") throw new ForbiddenError("trash_owner_only");
  }

  /** 지금 있는 파일(대소문자 무시로도 대 본다)과 휴지통에 넣을 경로 판정 */
  private async trashContext(folder: string) {
    const files: string[] = [];
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (n.type === "dir") walk(n.children ?? []);
        else files.push(n.path);
      }
    };
    walk(await this.vault.tree());
    const lower = files.map((p) => p.toLowerCase());
    return {
      files,
      taken: new Set(lower),
      dirGone: (dir: string) => !lower.some((p) => p.startsWith(dir.toLowerCase() + "/")),
      keep: (p: string) => inTrashScope(p, folder) && !isVaultSettingsPath(p) && !this.wiki?.isGenerated(p),
    };
  }

  /** S3로 간 첨부 중 이 커밋이 지운 것(경로 → 내용 해시). 첨부 목록 파일의 커밋 전후를 대 본다 */
  private async s3Deleted(rev: string): Promise<Map<string, string>> {
    const parse = (text: string | null): Record<string, { sha256?: string }> => {
      try {
        return (JSON.parse(text ?? "{}") as { files?: Record<string, { sha256?: string }> }).files ?? {};
      } catch {
        return {};
      }
    };
    const before = parse(await this.vault.git.show(`${rev}^`, BLOB_INDEX));
    const after = parse(await this.vault.git.show(rev, BLOB_INDEX));
    const out = new Map<string, string>();
    for (const [p, e] of Object.entries(before)) if (!after[p] && typeof e?.sha256 === "string") out.set(p, e.sha256);
    return out;
  }

  /** only: 되살릴 때 화면이 본 노트(지금 그 자리에 파일이 생겼어도 그대로 두고 자리를 따로 정한다) */
  private async trashItem(
    c: CommitInfo & { deleted: string[]; blobIndex: boolean },
    ctx: Awaited<ReturnType<ScopedVault["trashContext"]>>,
    only?: Set<string>,
  ): Promise<{ item: TrashItem; s3: Map<string, string> } | null> {
    const md = c.deleted.filter((p) => isMarkdown(p) && ctx.keep(p));
    if (!md.length) return null;
    const inGit = c.deleted.filter((p) => !isMarkdown(p) && ctx.keep(p));
    const s3 = c.blobIndex ? new Map([...(await this.s3Deleted(c.rev))].filter(([p]) => ctx.keep(p))) : new Map<string, string>();
    const node = trashHead([...md, ...inGit, ...s3.keys()], ctx.dirGone);
    const notes = only ? md.filter((p) => only.has(p)) : md.filter((p) => !ctx.taken.has(p.toLowerCase()));
    if (!notes.length) return null;
    const free = (p: string) => !ctx.taken.has(p.toLowerCase());
    // S3 보관 첨부는 S3를 쓰고 있을 때만 받을 수 있다(지금 꺼져 있으면 되살릴 수 없음으로 센다)
    const fromS3 = [...s3.keys()].filter(free);
    const canFetch = this.vault.blobSource !== null;
    return {
      item: {
        id: c.rev,
        date: c.date,
        author: c.author,
        node,
        notes: trashOrder(notes, node),
        attachments: [...inGit.filter(free), ...(canFetch ? fromS3 : [])].sort(),
        lost: canFetch ? 0 : fromS3.length,
      },
      s3,
    };
  }

  /**
   * 휴지통: 파일을 지운 커밋 중 지금 볼트에 없는 마크다운이 남은 것(최근 것부터). folder 를 주면 그 워크스페이스 안만.
   * cursor 는 앞 쪽에서 돌려준 next(이미 훑은 삭제 커밋 수). 한 번에 훑는 커밋은 limit 의 열 배까지
   */
  async trash(opts: { folder?: string; cursor?: number; limit?: number } = {}): Promise<TrashPage> {
    this.requireOwner();
    const limit = Math.min(Math.max(opts.limit ?? TRASH_PAGE, 1), 200);
    const ctx = await this.trashContext(normalizeFolder(opts.folder));
    const items: TrashItem[] = [];
    let used = Math.max(opts.cursor ?? 0, 0);
    for (let round = 0; round < 10; round++) {
      const { commits, more } = await this.vault.git.deletions(used, limit);
      for (const [i, c] of commits.entries()) {
        used++;
        const found = await this.trashItem(c, ctx);
        if (found) items.push(found.item);
        if (items.length >= limit) return { items, next: more || i < commits.length - 1 ? used : null };
      }
      if (!more) return { items, next: null };
    }
    return { items, next: used };
  }

  /** 지우기 직전 내용(휴지통 미리보기) */
  async trashPreview(id: string, input: string): Promise<{ path: string; content: string }> {
    this.requireOwner();
    const rel = normalizeVaultPath(input);
    const c = await this.vault.git.deletion(id);
    if (!c || !c.deleted.includes(rel) || !isMarkdown(rel)) throw new NotFoundError("rev_doc_missing", { path: rel });
    const content = await this.vault.git.show(`${c.rev}^`, rel);
    if (content === null) throw new NotFoundError("rev_doc_missing", { path: rel });
    return { path: rel, content };
  }

  /**
   * 휴지통에서 되살리기: 그 커밋에서 지운 노트(paths: 화면이 본 것, 없으면 지금 없는 것 전부)와 지금 없는 첨부를
   * 지우기 직전 내용으로 한 커밋에 만든다(노드는 통째로). 그 사이 자리에 다른 파일이 생겼으면 덮어쓰지 않고 " 2"…
   * (restoreTargets). 그 자리에 이미 같은 내용이 있으면(다른 창에서 먼저 되살림) 건너뛴다. restored: [원래 경로, 만든 경로]
   */
  async restoreTrash(id: string, paths?: string[]): Promise<{ restored: [string, string][]; lost: number; rev: string | null }> {
    this.requireOwner();
    const c = await this.vault.git.deletion(id);
    if (!c) throw new NotFoundError("rev_missing", { rev: id });
    const ctx = await this.trashContext("");
    const found = await this.trashItem(c, ctx, paths ? new Set(paths.map((p) => normalizeVaultPath(p))) : undefined);
    const contents = new Map<string, string>();
    for (const p of found?.item.notes ?? []) {
      const content = await this.vault.git.show(`${c.rev}^`, p);
      if (content === null) throw new NotFoundError("rev_doc_missing", { path: p });
      const now = ctx.files.includes(p)
        ? await this.vault.read(p).then(
            (d) => d.content,
            () => null,
          )
        : null;
      if (now !== content) contents.set(p, content);
    }
    if (!found || !contents.size) throw new NotFoundError("trash_empty");
    const s3 = found.s3;
    const item = { ...found.item, notes: found.item.notes.filter((p) => contents.has(p)) };
    const targets = restoreTargets([...item.notes, ...item.attachments], item.node, ctx.files);
    const ops: Op[] = [];
    const restored: [string, string][] = [];
    let lost = item.lost;
    for (const p of item.notes) {
      ops.push({ op: "write", path: targets.get(p)!, content: contents.get(p)!, baseHash: null });
      restored.push([p, targets.get(p)!]);
    }
    for (const p of item.attachments) {
      const sha = s3.get(p);
      const data = sha ? await this.vault.blobSource!(sha) : await this.vault.git.showBytes(`${c.rev}^`, p);
      if (!data) {
        lost++;
        continue;
      }
      ops.push({ op: "put", path: targets.get(p)!, data: new Uint8Array(data) });
      restored.push([p, targets.get(p)!]);
    }
    const res = await this.batch(ops, this.vault.text().commit.restoreDeleted(item.node ?? item.notes[0].replace(/\.md$/i, "")));
    return { restored, lost, rev: res.rev };
  }

  /** 에이전트가 자기 권한 표를 확인할 때. */
  whoami() {
    return this.principal.kind === "owner"
      ? { name: this.principal.name, kind: "owner", rules: { "/": "delete" as Level } }
      : { name: this.principal.name, kind: "agent", rules: this.principal.policy.toJSON() };
  }
}
