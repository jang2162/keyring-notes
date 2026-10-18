import { propertyStats, type PropertyStat } from "./frontmatter.js";
import { mentionNames, unlinkedMentions, type Mention } from "./mentions.js";
import { lintVault, linkGraph, type GraphData, type LintReport } from "./analysis.js";
import { rewriteLinks, type LinkRewriteContext } from "./links.js";
import { ConflictError, ForbiddenError, NotFoundError, PathError } from "./errors.js";
import { fromUtf8, sha256Hex, utf8 } from "./hash.js";
import { analyze, anchorExists, parseFrontmatter, resolveLink, setTaskState, sourceRefs } from "./markdown.js";
import { isMarkdown, normalizeFolder, normalizeVaultPath } from "./paths.js";
import type { CommitInfo, DocMeta, LinkRow, SearchHit, TaskRow, TreeNode } from "./types.js";
import { parseWidget, runWidget, type WidgetResult } from "./widget.js";
import { generatedKind, generatedPaths, isTopicName, renderWikiIndex, renderWikiLog, schemaTemplate, schemaTopic, topicCandidate } from "./wiki.js";
import { dailyLookup, isVaultSettingsPath, parseVaultSettings, vaultLanguage, VAULT_SETTINGS_PATH, type VaultSettings } from "./settings.js";
import type { DailyLookup } from "./daily.js";
import { moveNodePath, nodeFiles, workspaceOf } from "./nodes.js";
import { vaultText, type VaultText } from "./vaultText.js";

export interface FileEntry {
  /** 볼트 상대 경로("/" 구분) */
  path: string;
  size: number;
  /** 수정 시각(ms) */
  mtime: number;
}

/**
 * 기기의 파일 저장소(데스크톱·모바일은 실제 폴더, 브라우저는 IndexedDB, 시험은 메모리).
 * list()에는 점으로 시작하는 폴더·파일을 넣지 않는다. 앱 메타데이터(이력·동기화 기준점)는
 * 볼트 안 `.keyring-app/` 아래 이름으로 따로 읽고 쓴다.
 */
export interface FileStore {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<Uint8Array | null>;
  /** 상위 폴더가 없으면 만든다. 쓴 뒤의 크기·시각을 돌려준다. */
  write(path: string, data: Uint8Array): Promise<FileEntry>;
  remove(path: string): Promise<void>;
  readMeta(name: string): Promise<string | null>;
  writeMeta(name: string, text: string): Promise<void>;
  appendMeta(name: string, text: string): Promise<void>;
  /** 첨부(이미지 등)를 화면에 띄울 URL. 못 만들면 null(앱이 바이트를 읽어 blob URL을 만든다). */
  fileUrl?(path: string): string | null;
}

export interface LocalDoc {
  path: string;
  content: string;
  hash: string;
  /** 앱이 만드는 문서(위키 index·log). 고칠 수 없다. */
  generated?: true;
}

export interface JournalFile {
  /** A 추가, M 수정, D 삭제, R 이동 */
  status: "A" | "M" | "D" | "R";
  path: string;
  from?: string;
  /** 이 변경 뒤 내용의 해시(삭제면 null). 내용은 objects/<해시>에 있다. */
  hash: string | null;
}

/** 이 기기의 변경 기록 한 건(서버의 커밋에 해당). */
export interface JournalEntry {
  id: string;
  date: string;
  author: string;
  message: string;
  files: JournalFile[];
}

export type ChangeSource = "local" | "sync" | "external";

interface Entry extends FileEntry {
  md: boolean;
  /** 마크다운은 늘, 첨부는 처음 필요할 때 계산 */
  hash: string | null;
  content?: string;
  meta?: DocMeta;
  links?: LinkRow[];
  tasks?: TaskRow[];
}

const JOURNAL = "journal.jsonl";
const objectName = (hash: string) => `objects/${hash.slice(0, 2)}/${hash}`;

/** 앱 밖 변경·동기화 기록의 작성자(이름이라 볼트 언어와 상관없이 고정) */
export const EXTERNAL_AUTHOR = "external";
export const SYNC_AUTHOR = "sync";

let idSeq = 0;
function newId(now: number): string {
  // 시각 순으로 정렬되는 id
  idSeq = (idSeq + 1) % 1296;
  return `${now.toString(36).padStart(9, "0")}${idSeq.toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

/** 줄 단위 검색 점수: 제목·경로에 있으면 크게, 본문은 나온 횟수(상한). */
function score(terms: string[], title: string, path: string, body: string): number {
  let s = 0;
  for (const t of terms) {
    if (title.includes(t)) s += 10;
    if (path.includes(t)) s += 5;
    let n = 0;
    for (let i = body.indexOf(t); i >= 0 && n < 20; i = body.indexOf(t, i + t.length)) n++;
    s += n;
  }
  return s;
}

/**
 * 로컬 우선 볼트: 기기의 마크다운 파일이 원본이고, 서버 없이 읽기·쓰기·검색·위젯·이력이 모두 된다.
 * 색인은 메모리에 두고(열 때 전체를 읽는다), 쓰기는 서버처럼 baseHash가 맞을 때만 한다.
 * 모든 변경은 한 줄로 직렬화되며 변경 기록(journal)과 내용 스냅샷(objects)을 남긴다.
 */
export class LocalVault {
  private files = new Map<string, Entry>();
  private journal: JournalEntry[] = [];
  /** 경로별 마지막 기록 해시(기록이 없으면 키 없음) */
  private lastHash = new Map<string, string | null>();
  private knownObjects = new Set<string>();
  private topicSet = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private listeners: ((paths: string[], source: ChangeSource) => void)[] = [];
  private opened = false;
  author: string;

  constructor(
    readonly store: FileStore,
    opts: { author?: string } = {},
  ) {
    this.author = opts.author ?? "나";
  }

  /** 기록을 읽고 볼트 전체를 색인한다. 앱이 꺼져 있는 동안 바뀐 파일은 "외부 변경"으로 기록한다. */
  async open(): Promise<void> {
    await this.exclusive(async () => {
      const raw = (await this.store.readMeta(JOURNAL)) ?? "";
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          this.remember(JSON.parse(line) as JournalEntry);
        } catch {
          /* 깨진 줄(쓰다 끊긴 마지막 줄 등)은 건너뛴다 */
        }
      }
      await this.scan();
      this.opened = true;
    });
  }

  /** 앱 밖(다른 편집기·파일 동기화 도구)에서 바뀐 파일을 다시 읽는다. 바뀐 경로를 돌려준다. */
  rescan(): Promise<string[]> {
    return this.exclusive(() => this.scan());
  }

  onChange(fn: (paths: string[], source: ChangeSource) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(paths: string[], source: ChangeSource) {
    if (paths.length === 0) return;
    for (const l of this.listeners) {
      try {
        l(paths, source);
      } catch {
        /* 화면 쪽 오류가 볼트를 멈추지 않게 */
      }
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private remember(e: JournalEntry) {
    this.journal.push(e);
    for (const f of e.files) {
      if (f.from) this.lastHash.set(f.from, null);
      this.lastHash.set(f.path, f.hash);
      if (f.hash) this.knownObjects.add(f.hash);
    }
  }

  private async saveObject(hash: string, content: string) {
    if (this.knownObjects.has(hash)) return;
    await this.store.writeMeta(objectName(hash), content);
    this.knownObjects.add(hash);
  }

  private async record(author: string, message: string, files: JournalFile[], contents: Map<string, string>, date = Date.now()) {
    if (files.length === 0) return;
    for (const f of files) if (f.hash) await this.saveObject(f.hash, contents.get(f.hash)!);
    const e: JournalEntry = { id: newId(date), date: new Date(date).toISOString(), author, message, files };
    await this.store.appendMeta(JOURNAL, JSON.stringify(e) + "\n");
    this.remember(e);
  }

  private computeTopics(paths: Iterable<string>) {
    this.topicSet.clear();
    for (const p of paths) {
      const t = schemaTopic(p);
      if (t) this.topicSet.add(t);
    }
  }

  private index(entry: Entry, content: string) {
    const a = analyze(entry.path, content);
    entry.content = content;
    entry.meta = {
      path: entry.path,
      title: a.title,
      summary: a.summary,
      hash: entry.hash!,
      mtime: entry.mtime,
      size: entry.size,
      frontmatter: a.frontmatter,
      tags: a.tags,
    };
    entry.links = [
      ...a.links.map((t) => ({ src: entry.path, target: t, kind: "link" as const })),
      ...a.sources.map((t) => ({ src: entry.path, target: t, kind: "source" as const })),
    ];
    entry.tasks = a.tasks.map((t) => ({ path: entry.path, ...t }));
  }

  private async scan(): Promise<string[]> {
    const list = (await this.store.list()).filter((e) => {
      try {
        return normalizeVaultPath(e.path) === e.path;
      } catch {
        return false;
      }
    });
    this.computeTopics(list.map((e) => e.path));
    const seen = new Set<string>();
    const external: JournalFile[] = [];
    const contents = new Map<string, string>();
    const changed: string[] = [];
    for (const e of list) {
      if (this.isGenerated(e.path)) continue;
      seen.add(e.path);
      const cur = this.files.get(e.path);
      if (cur && cur.size === e.size && cur.mtime === e.mtime) continue;
      const md = isMarkdown(e.path);
      if (!md) {
        this.files.set(e.path, { ...e, md, hash: null });
        if (cur) changed.push(e.path);
        continue;
      }
      const data = await this.store.read(e.path);
      if (data === null) continue;
      const content = fromUtf8(data);
      const hash = await sha256Hex(data);
      const entry: Entry = { ...e, md, hash };
      this.index(entry, content);
      this.files.set(e.path, entry);
      if (cur?.hash === hash) continue;
      changed.push(e.path);
      const last = this.lastHash.get(e.path);
      if (last !== undefined && last !== hash) {
        external.push({ status: last === null ? "A" : "M", path: e.path, hash });
        contents.set(hash, content);
      }
    }
    for (const [p, entry] of this.files) {
      if (seen.has(p)) continue;
      this.files.delete(p);
      changed.push(p);
      if (entry.md && this.lastHash.get(p)) external.push({ status: "D", path: p, hash: null });
    }
    await this.record(EXTERNAL_AUTHOR, this.text().commit.appOutside, external, contents);
    if (this.opened) this.emit(changed, "external");
    return changed;
  }

  // ── 조회 ──

  isGenerated(rel: string): boolean {
    const g = generatedKind(rel);
    return g !== null && this.topicSet.has(g.topic);
  }

  topicOf(rel: string): string | null {
    const t = topicCandidate(rel);
    return t !== null && this.topicSet.has(t) ? t : null;
  }

  private settingsCache: { hash: string | null; value: VaultSettings } | null = null;

  /** 모든 기기 공통 설정(볼트의 keyring-settings.md). 파일이 없으면 기본값 */
  settings(): VaultSettings {
    const e = this.files.get(VAULT_SETTINGS_PATH);
    const hash = e?.hash ?? null;
    if (this.settingsCache?.hash !== hash) this.settingsCache = { hash, value: parseVaultSettings(e?.content) };
    return this.settingsCache.value;
  }

  /** 볼트 언어의 글(커밋 메시지·위키 목차 등) */
  text(): VaultText {
    return vaultText(vaultLanguage(this.settings()));
  }

  /** 볼트의 워크스페이스(루트 노드) 이름 */
  workspaces(): string[] {
    const out = new Set<string>();
    for (const p of this.files.keys()) {
      const ws = workspaceOf(p);
      if (ws) out.add(ws);
    }
    return [...out].sort();
  }

  private dailyCache: { settings: VaultSettings; value: DailyLookup } | null = null;

  /** 워크스페이스별 데일리 설정 */
  daily(): DailyLookup {
    const s = this.settings();
    if (this.dailyCache?.settings !== s) this.dailyCache = { settings: s, value: dailyLookup(s, () => this.workspaces()) };
    return this.dailyCache.value;
  }

  private mdEntries(): Entry[] {
    return [...this.files.values()].filter((e) => e.md && e.meta);
  }

  docs(): DocMeta[] {
    return this.mdEntries()
      .map((e) => e.meta!)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  private mdPaths(): string[] {
    return this.docs().map((d) => d.path);
  }

  private allPaths(): string[] {
    return [...this.files.keys()].sort();
  }

  private linkRows(): LinkRow[] {
    return this.mdEntries().flatMap((e) => e.links ?? []);
  }

  private tasks(): TaskRow[] {
    return this.mdEntries()
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .flatMap((e) => e.tasks ?? []);
  }

  tree(): TreeNode[] {
    const root: TreeNode[] = [];
    const dirs = new Map<string, TreeNode[]>([["", root]]);
    const dirOf = (p: string): TreeNode[] => {
      const existing = dirs.get(p);
      if (existing) return existing;
      const i = p.lastIndexOf("/");
      const parent = dirOf(i < 0 ? "" : p.slice(0, i));
      const node: TreeNode = { name: p.slice(i + 1), path: p, type: "dir", children: [] };
      parent.push(node);
      dirs.set(p, node.children!);
      return node.children!;
    };
    const paths = [...this.files.keys(), ...[...this.topicSet].flatMap(generatedPaths)];
    for (const p of paths) {
      const i = p.lastIndexOf("/");
      const icon = this.files.get(p)?.meta?.frontmatter?.icon;
      dirOf(i < 0 ? "" : p.slice(0, i)).push({
        name: p.slice(i + 1),
        path: p,
        type: "file",
        ...(typeof icon === "string" && icon.trim() ? { icon: icon.trim() } : {}),
      });
    }
    const sort = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name, "ko")));
      for (const n of nodes) if (n.children) sort(n.children);
    };
    sort(root);
    return root;
  }

  async read(input: string): Promise<LocalDoc> {
    const rel = normalizeVaultPath(input);
    if (!isMarkdown(rel)) throw new PathError("markdown_only");
    if (this.isGenerated(rel)) {
      const content = this.renderGenerated(rel);
      return { path: rel, content, hash: await sha256Hex(content), generated: true };
    }
    const e = this.files.get(rel);
    if (!e?.meta) throw new NotFoundError("doc_missing", { path: rel });
    return { path: rel, content: e.content!, hash: e.hash! };
  }

  /** 첨부 파일 바이트(이미지 표시·동기화용). */
  async readBytes(input: string): Promise<Uint8Array> {
    const rel = normalizeVaultPath(input);
    const data = this.files.has(rel) ? await this.store.read(rel) : null;
    if (data === null) throw new NotFoundError("file_missing", { path: rel });
    return data;
  }

  private renderGenerated(rel: string): string {
    const g = generatedKind(rel)!;
    const lang = vaultLanguage(this.settings());
    if (g.kind === "index") return renderWikiIndex(g.topic, this.docs(), this.mdPaths(), this.linkRows(), { by: "app", lang });
    return renderWikiLog(
      g.topic,
      this.journal.map((e) => ({ date: e.date, author: e.author, message: e.message, files: e.files })),
      () => true,
      { by: "app", lang },
    );
  }

  /**
   * 검색: 공백으로 나눈 모든 단어가 본문·제목·경로 어딘가에 있는 문서. `#태그`는 태그 조건.
   * 서버(SQLite FTS)와 달리 단어 길이 제한이 없고, 점수는 제목·경로·본문 출현 횟수로 매긴다.
   */
  search(query: string, opts: { folder?: string; limit?: number } = {}): SearchHit[] {
    const words = query.split(/\s+/).filter(Boolean);
    const tagTerms = words.filter((w) => w.startsWith("#") && w.length > 1).map((w) => w.slice(1).toLowerCase());
    const textTerms = words.filter((w) => !(w.startsWith("#") && w.length > 1)).map((w) => w.toLowerCase());
    if (tagTerms.length === 0 && textTerms.length === 0) throw new PathError("query_required");
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const f = normalizeFolder(opts.folder);
    const scored: { e: Entry; s: number }[] = [];
    for (const e of this.mdEntries()) {
      if ((f && e.path !== `${f}.md` && !e.path.startsWith(f + "/")) || isVaultSettingsPath(e.path)) continue;
      if (tagTerms.length && !tagTerms.every((t) => e.meta!.tags.some((x) => x === t || x.startsWith(t + "/")))) continue;
      const title = e.meta!.title.toLowerCase();
      const path = e.path.toLowerCase();
      const body = e.content!.toLowerCase();
      if (!textTerms.every((t) => title.includes(t) || path.includes(t) || body.includes(t))) continue;
      scored.push({ e, s: textTerms.length ? score(textTerms, title, path, body) : 0 });
    }
    scored.sort((a, b) => b.s - a.s || (a.e.path < b.e.path ? -1 : 1));
    return scored.slice(0, limit).map(({ e }) => {
      const lines = e.content!.split("\n");
      const idx = textTerms.length ? lines.findIndex((l) => textTerms.some((t) => l.toLowerCase().includes(t))) : -1;
      return { path: e.path, title: e.meta!.title, line: idx < 0 ? 1 : idx + 1, snippet: idx < 0 ? "" : lines[idx].trim().slice(0, 200) };
    });
  }

  private incoming(rel: string, kind?: "link" | "source"): string[] {
    const paths = this.mdPaths();
    const out = new Set<string>();
    const daily = this.daily();
    for (const r of this.linkRows()) {
      if (r.src === rel || (kind && r.kind !== kind)) continue;
      if (resolveLink(r.target, paths, { daily, from: r.src }) === rel) out.add(r.src);
    }
    return [...out].sort();
  }

  private withTitles(paths: string[]): { path: string; title: string }[] {
    return paths.map((p) => ({ path: p, title: this.files.get(p)?.meta?.title ?? p }));
  }

  backlinks(input: string): { path: string; title: string }[] {
    return this.withTitles(this.incoming(normalizeVaultPath(input)));
  }

  /** 속성(프런트매터) 이름·종류·자주 쓴 값 */
  properties(): PropertyStat[] {
    return propertyStats(this.docs().filter((d) => !isVaultSettingsPath(d.path)));
  }

  /** 연결되지 않은 언급: 이 문서의 이름이 링크 없이 나오는 다른 문서와 그 자리 */
  async mentions(input: string): Promise<{ path: string; names: string[]; docs: { path: string; title: string; hash: string; mentions: Mention[] }[] }> {
    const doc = await this.read(input);
    const names = mentionNames(doc.path, parseFrontmatter(doc.content).data);
    const lowered = names.map((n) => n.toLowerCase());
    const docs: { path: string; title: string; hash: string; mentions: Mention[] }[] = [];
    for (const e of this.mdEntries().sort((a, b) => (a.path < b.path ? -1 : 1))) {
      if (e.path === doc.path || !e.content) continue;
      const lower = e.content.toLowerCase();
      if (!lowered.some((n) => lower.includes(n))) continue;
      const found = unlinkedMentions(e.content, names);
      if (found.length) docs.push({ path: e.path, title: e.meta?.title ?? e.path, hash: e.hash!, mentions: found.slice(0, 50) });
      if (docs.length >= 100) break;
    }
    return { path: doc.path, names, docs };
  }

  async sources(input: string) {
    const doc = await this.read(input);
    const fm = parseFrontmatter(doc.content).data;
    const files = this.allPaths();
    return {
      path: doc.path,
      sources: sourceRefs(fm).map((r) => ({
        target: r.target,
        path: resolveLink(r.target, files, { daily: this.daily(), from: doc.path }),
        ...(r.anchor ? { anchor: r.anchor } : {}),
      })),
      citedBy: this.withTitles(this.incoming(doc.path, "source")),
      linkedBy: this.withTitles(this.incoming(doc.path, "link")),
    };
  }

  /** 태그와 문서 수. folder를 주면 그 노드(노트 포함) 안만 */
  tags(folder?: string): { tag: string; count: number }[] {
    const f = normalizeFolder(folder);
    const counts = new Map<string, number>();
    for (const d of this.docs()) {
      if (f && d.path !== `${f}.md` && !d.path.startsWith(f + "/")) continue;
      for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ko"));
  }

  widget(source: string): WidgetResult {
    return runWidget(parseWidget(source), this.docs(), this.tasks());
  }

  /** 토픽 = 워크스페이스 바로 아래 노드(워크스페이스/이름). 위키 토픽이면 페이지·원본 수를 함께 */
  topics(): { name: string; wiki: boolean; pages: number; raw: number }[] {
    const docs = this.docs();
    const names = new Set<string>();
    for (const p of this.files.keys()) {
      const segs = p.split("/");
      if (segs.length >= 2 && !isVaultSettingsPath(p)) names.add(`${segs[0]}/${segs[1].replace(/\.md$/i, "")}`);
    }
    for (const t of this.topicSet) names.add(t);
    return [...names]
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => {
        const wiki = this.topicSet.has(name);
        return {
          name,
          wiki,
          pages: wiki ? docs.filter((d) => d.path.startsWith(`${name}/wiki/`) && !this.isGenerated(d.path)).length : 0,
          raw: wiki ? docs.filter((d) => d.path.startsWith(`${name}/raw/`) && !d.path.startsWith(`${name}/raw/assets/`)).length : 0,
        };
      });
  }

  lint(opts: { folder?: string; staleDays?: number } = {}): LintReport {
    // 문단·제목을 가리키는 출처가 실제로 있는지
    const files = this.allPaths();
    const missingAnchors: { src: string; target: string; anchor: string }[] = [];
    for (const e of this.mdEntries()) {
      for (const r of sourceRefs(e.meta!.frontmatter)) {
        if (!r.anchor) continue;
        const to = resolveLink(r.target, files, { daily: this.daily(), from: e.path });
        const content = to ? this.files.get(to)?.content : undefined;
        if (content !== undefined && !anchorExists(content, r.anchor)) missingAnchors.push({ src: e.path, target: r.target, anchor: r.anchor });
      }
    }
    return lintVault({
      missingAnchors,
      docs: this.docs(),
      files: this.allPaths(),
      links: this.linkRows(),
      canRead: () => true,
      wiki: this,
      folder: normalizeFolder(opts.folder),
      staleDays: opts.staleDays,
      daily: this.daily(),
    });
  }

  graph(folder?: string): GraphData {
    return linkGraph({ docs: this.docs(), links: this.linkRows(), wiki: this, folder: normalizeFolder(folder), daily: this.daily() });
  }

  // ── 이력 ──

  /** 이 문서가 들어 있는 기록(최근 것부터). */
  history(input: string): CommitInfo[] {
    const rel = normalizeVaultPath(input);
    return this.journal
      .filter((e) => e.files.some((f) => f.path === rel || f.from === rel))
      .reverse()
      .map((e) => ({ rev: e.id, author: e.author, email: "", date: e.date, message: e.message }));
  }

  /** 그 기록 직후의 내용(그때 지워졌으면 null). */
  async revision(input: string, rev: string): Promise<string | null> {
    const rel = normalizeVaultPath(input);
    const e = this.journal.find((j) => j.id === rev);
    if (!e) throw new NotFoundError("rev_missing", { rev });
    const f = e.files.find((x) => x.path === rel) ?? (e.files.some((x) => x.from === rel) ? { hash: null } : undefined);
    if (!f) throw new NotFoundError("rev_doc_missing", { path: rel });
    if (f.hash === null) return null;
    const content = await this.store.readMeta(objectName(f.hash));
    if (content === null) throw new NotFoundError("rev_content_gone");
    return content;
  }

  /** 기록 전체(오래된 것부터). */
  entries(): readonly JournalEntry[] {
    return this.journal;
  }

  // ── 쓰기 ──

  private requireWritable(input: string): string {
    const rel = normalizeVaultPath(input);
    if (!isMarkdown(rel)) throw new PathError("markdown_only_write");
    if (this.isGenerated(rel)) throw new ForbiddenError("generated_edit");
    return rel;
  }

  /**
   * 그 파일이 메모리의 것과 같은지 저장소에서 다시 대 보고, 다르면 전체를 다시 읽는다(check 직전에 부른다).
   * 같은 폴더를 여러 창(데스크톱 새 창·브라우저 탭)이 열면 창마다 볼트가 따로 있다 — 다른 창의 저장은 이 창이
   * rescan 하기 전에는 메모리에 없어서, 메모리 해시로만 비교하면 낡은 해시로 쓴 저장이 통과해 그 창의 내용을 조용히 덮는다.
   */
  private async refreshIfChanged(rel: string) {
    const data = await this.store.read(rel);
    const cur = this.files.get(rel);
    const onDisk = data === null ? null : cur && !cur.md ? cur.hash : await sha256Hex(data);
    if (onDisk !== (cur ? cur.hash : null)) await this.scan();
  }

  private check(rel: string, baseHash: string | null) {
    const cur = this.files.get(rel);
    const curHash = cur ? cur.hash : null;
    if (baseHash === null && cur) throw new ConflictError(curHash, "doc_exists", { path: rel });
    if (baseHash !== null && curHash !== baseHash) throw new ConflictError(curHash);
  }

  /**
   * 변경을 파일에 쓰고 색인·기록을 갱신한다. 처음 기록되는 기존 문서는 바뀌기 전 내용을
   * "기존 내용" 기록으로 먼저 남겨 이력에서 되돌릴 수 있게 한다.
   */
  private async apply(changes: { path: string; content: string | null; from?: string }[], author: string, message: string, source: ChangeSource) {
    const files: JournalFile[] = [];
    const baseline: JournalFile[] = [];
    const contents = new Map<string, string>();
    for (const c of changes) {
      for (const p of c.from ? [c.from] : [c.path]) {
        const cur = this.files.get(p);
        if (cur?.md && cur.hash && !this.lastHash.has(p)) {
          baseline.push({ status: "A", path: p, hash: cur.hash });
          contents.set(cur.hash, cur.content!);
        }
      }
    }
    if (baseline.length) {
      const oldest = Math.min(...baseline.map((b) => this.files.get(b.path)!.mtime));
      await this.record(this.author, this.text().commit.appBaseline, baseline, contents, Math.min(oldest, Date.now() - 1));
    }
    for (const c of changes) {
      const existed = this.files.has(c.path);
      if (c.from) {
        await this.store.remove(c.from);
        this.files.delete(c.from);
      }
      if (c.content === null) {
        await this.store.remove(c.path);
        this.files.delete(c.path);
        files.push({ status: "D", path: c.path, hash: null });
        continue;
      }
      const data = utf8(c.content);
      const st = await this.store.write(c.path, data);
      const entry: Entry = { path: c.path, size: st.size, mtime: st.mtime, md: true, hash: await sha256Hex(data) };
      this.index(entry, c.content);
      this.files.set(c.path, entry);
      contents.set(entry.hash!, c.content);
      files.push(c.from ? { status: "R", path: c.path, from: c.from, hash: entry.hash } : { status: existed ? "M" : "A", path: c.path, hash: entry.hash });
    }
    const before = [...this.topicSet].join("\0");
    this.computeTopics(this.files.keys());
    // 새로 위키가 된 토픽에 남아 있던 index·log 파일은 자동 생성 문서로 바뀐다
    for (const p of this.files.keys()) if (this.isGenerated(p)) this.files.delete(p);
    await this.record(author, message, files, contents);
    const changed = changes.flatMap((c) => (c.from ? [c.from, c.path] : [c.path]));
    if (before !== [...this.topicSet].join("\0")) changed.push(...[...this.topicSet].flatMap(generatedPaths));
    this.emit(changed, source);
  }

  write(input: string, content: string, baseHash: string | null, message?: string): Promise<LocalDoc> {
    return this.exclusive(async () => {
      const rel = this.requireWritable(input);
      await this.refreshIfChanged(rel);
      this.check(rel, baseHash);
      const cur = this.files.get(rel);
      if (cur && cur.content === content) return { path: rel, content, hash: cur.hash! };
      await this.apply([{ path: rel, content }], this.author, message ?? (cur ? this.text().commit.modify(rel) : this.text().commit.create(rel)), "local");
      return { path: rel, content, hash: this.files.get(rel)!.hash! };
    });
  }

  remove(input: string, baseHash: string): Promise<void> {
    return this.exclusive(async () => {
      const rel = this.requireWritable(input);
      await this.refreshIfChanged(rel);
      this.check(rel, baseHash);
      await this.apply([{ path: rel, content: null }], this.author, this.text().commit.delete(rel), "local");
    });
  }

  /**
   * 이동·이름 바꾸기(문서·첨부). updateLinks(기본 켬)면 이 파일을 가리키던 링크(다른 문서와 이 문서 자신의 상대 링크)를
   * 같은 기록 안에서 함께 고친다. linksUpdated: 링크를 고친 문서(이동한 문서 포함), linkCount: 고친 링크 수.
   */
  async move(
    fromInput: string,
    toInput: string,
    baseHash: string,
    opts: { updateLinks?: boolean } = {},
  ): Promise<LocalDoc & { linksUpdated: string[]; linkCount: number }> {
    const from = normalizeVaultPath(fromInput);
    const r = await this.moveMany([[from, normalizeVaultPath(toInput), baseHash]], opts, null);
    const to = r.moved[0][1];
    const e = this.files.get(to)!;
    return { path: to, content: e.content ?? "", hash: e.hash ?? "", linksUpdated: r.linksUpdated, linkCount: r.linkCount };
  }

  /**
   * 노드 옮기기·이름 바꾸기: 노드 노트(`A.md`)와 하위(`A/` 아래 문서·첨부 전체)를 한 기록으로 옮기고 링크를 고친다.
   * 첨부는 기록(스냅샷)에 내용을 남기지 않는다. 서버와 동기화하면 새 자리의 첨부는 올리고, 원래 자리의 첨부는
   * 서버에서도 그대로일 때만 지운다(SyncEngine).
   */
  async moveNode(
    fromInput: string,
    toInput: string,
    opts: { updateLinks?: boolean } = {},
  ): Promise<{ moved: [string, string][]; linksUpdated: string[]; linkCount: number }> {
    const from = normalizeVaultPath(fromInput).replace(/\.md$/i, "");
    const to = normalizeVaultPath(toInput).replace(/\.md$/i, "");
    if (from === to) throw new PathError("same_path");
    if (to.startsWith(from + "/")) throw new PathError("node_into_self");
    const files = nodeFiles(from, this.files.keys());
    if (files.length === 0) throw new NotFoundError("node_missing", { path: from });
    const pairs: [string, string, null][] = files.map((p) => [p, moveNodePath(p, from, to), null]);
    return this.moveMany(pairs, opts, this.text().commit.nodeMove(from, to));
  }

  /**
   * 노드 삭제: 노드 노트와 하위 전체를 한 기록으로 지운다. 되살릴 수 있게 지운 내용을 돌려준다
   * (마크다운은 글, 첨부는 바이트).
   */
  deleteNode(input: string): Promise<{ deleted: { path: string; content?: string; data?: Uint8Array }[] }> {
    return this.exclusive(async () => {
      const node = normalizeVaultPath(input).replace(/\.md$/i, "");
      const files = nodeFiles(node, this.files.keys());
      if (files.length === 0) throw new NotFoundError("node_missing", { path: node });
      for (const p of files) if (this.isGenerated(p)) throw new ForbiddenError("generated_delete");
      const deleted: { path: string; content?: string; data?: Uint8Array }[] = [];
      const md: { path: string; content: string | null }[] = [];
      const attachments: string[] = [];
      for (const p of files) {
        const e = this.files.get(p)!;
        if (e.md) {
          deleted.push({ path: p, content: e.content! });
          md.push({ path: p, content: null });
        } else {
          const data = await this.store.read(p);
          if (data) deleted.push({ path: p, data });
          await this.store.remove(p);
          this.files.delete(p);
          attachments.push(p);
        }
      }
      if (md.length) await this.apply(md, this.author, this.text().commit.nodeDelete(node), "local");
      this.emit(attachments, "local");
      return { deleted };
    });
  }

  /** 지운 파일 되살리기(노드 삭제 되돌리기): 없는 자리에만 쓴다. 마크다운은 한 기록으로 */
  restoreFiles(files: { path: string; content?: string; data?: Uint8Array }[]): Promise<void> {
    return this.exclusive(async () => {
      const md: { path: string; content: string }[] = [];
      const attachments: string[] = [];
      for (const f of files) {
        const rel = normalizeVaultPath(f.path);
        if (this.files.has(rel)) throw new ConflictError(this.files.get(rel)!.hash, "file_exists", { path: rel });
        if (f.content !== undefined) {
          if (!isMarkdown(rel)) throw new PathError("restore_data");
          md.push({ path: rel, content: f.content });
        } else if (f.data) {
          const st = await this.store.write(rel, f.data);
          this.files.set(rel, { path: rel, size: st.size, mtime: st.mtime, md: false, hash: await sha256Hex(f.data) });
          attachments.push(rel);
        }
      }
      if (md.length) await this.apply(md, this.author, md.length === 1 ? this.text().commit.create(md[0].path) : this.text().commit.batch(md.length), "local");
      this.emit(attachments, "local");
    });
  }

  /** 여러 파일을 한 기록으로 옮긴다(데일리 노트 형식 옮기기 등). 링크도 같이 고친다 */
  moveFiles(
    pairs: [string, string][],
    message: string,
    opts: { updateLinks?: boolean } = {},
  ): Promise<{ moved: [string, string][]; linksUpdated: string[]; linkCount: number }> {
    return this.moveMany(
      pairs.map(([f, t]) => [normalizeVaultPath(f), normalizeVaultPath(t), null]),
      opts,
      message,
    );
  }

  private moveMany(
    pairs: [string, string, string | null][],
    opts: { updateLinks?: boolean },
    message: string | null,
  ): Promise<{ moved: [string, string][]; linksUpdated: string[]; linkCount: number }> {
    return this.exclusive(async () => {
      const targets = new Set<string>();
      for (const [from, to, baseHash] of pairs) {
        if (from === to) throw new PathError("same_path");
        for (const p of [from, to]) {
          if (this.isGenerated(p)) throw new ForbiddenError("generated_move");
          if (isMarkdown(p) !== isMarkdown(from)) throw new PathError("move_kind");
        }
        const cur = this.files.get(from);
        if (!cur) throw new NotFoundError("file_missing", { path: from });
        if (baseHash !== null && cur.md) this.check(from, baseHash);
        if (this.files.has(to) || targets.has(to)) throw new ConflictError(this.files.get(to)?.hash ?? null, "file_exists", { path: to });
        targets.add(to);
      }
      const moves = new Map(pairs.map(([f, t]) => [f, t]));
      const contents = new Map<string, string>();
      for (const [f] of pairs) if (this.files.get(f)!.md) contents.set(f, this.files.get(f)!.content!);
      const changes: { path: string; content: string | null; from?: string }[] = [];
      const linksUpdated: string[] = [];
      let linkCount = 0;
      if (opts.updateLinks !== false) {
        const generated = [...this.topicSet].flatMap(generatedPaths);
        const before = [...this.files.keys(), ...generated];
        const ctx: LinkRewriteContext = { moves, before, after: [...before.filter((p) => !moves.has(p)), ...targets], daily: this.daily() };
        for (const e of this.mdEntries()) {
          const to = moves.get(e.path) ?? e.path;
          const r = rewriteLinks(e.content!, e.path, to, ctx);
          if (!r) continue;
          if (moves.has(e.path)) contents.set(e.path, r.content);
          else changes.push({ path: e.path, content: r.content });
          linksUpdated.push(to);
          linkCount += r.count;
        }
      }
      // 첨부는 바이트를 옮긴다(기록에는 남지 않는다)
      const attachments: string[] = [];
      for (const [from, to] of pairs) {
        if (this.files.get(from)!.md) continue;
        const data = await this.store.read(from);
        if (data === null) throw new NotFoundError("file_missing", { path: from });
        const st = await this.store.write(to, data);
        await this.store.remove(from);
        const old = this.files.get(from)!;
        this.files.delete(from);
        this.files.set(to, { path: to, size: st.size, mtime: st.mtime, md: false, hash: old.hash });
        attachments.push(from, to);
      }
      const md = pairs.filter(([f]) => contents.has(f)).map(([from, to]) => ({ path: to, content: contents.get(from)!, from }));
      const msg = message ?? (pairs.length === 1 ? this.text().commit.move(pairs[0][0], pairs[0][1]) : this.text().commit.batch(pairs.length));
      if (md.length || changes.length) await this.apply([...md, ...changes], this.author, msg, "local");
      this.emit(attachments, "local");
      return { moved: pairs.map(([f, t]) => [f, t] as [string, string]), linksUpdated, linkCount };
    });
  }

  /**
   * 첨부 파일(이미지 등) 새로 만들기. 이미 있으면 충돌. 첨부는 변경 기록(스냅샷)에 내용을 남기지 않는다
   * (기록의 스냅샷은 마크다운 원문용이다).
   */
  putFile(input: string, data: Uint8Array): Promise<{ path: string; hash: string }> {
    return this.exclusive(async () => {
      const rel = normalizeVaultPath(input);
      if (isMarkdown(rel)) throw new PathError("markdown_use_write");
      if (this.isGenerated(rel)) throw new ForbiddenError("generated_path");
      if (this.files.has(rel)) throw new ConflictError(this.files.get(rel)!.hash, "file_exists", { path: rel });
      const st = await this.store.write(rel, data);
      const hash = await sha256Hex(data);
      this.files.set(rel, { path: rel, size: st.size, mtime: st.mtime, md: false, hash });
      this.emit([rel], "local");
      return { path: rel, hash };
    });
  }

  async setTask(input: string, line: number, done: boolean, baseHash: string): Promise<LocalDoc> {
    const doc = await this.read(input);
    if (doc.hash !== baseHash) throw new ConflictError(doc.hash);
    const next = setTaskState(doc.content, line, done);
    if (next === null) throw new PathError("not_task", { line });
    return this.write(doc.path, next, baseHash, this.text().commit.task(done, doc.path));
  }

  async rollback(input: string, rev: string, baseHash: string | null): Promise<LocalDoc> {
    const rel = normalizeVaultPath(input);
    const old = await this.revision(rel, rev);
    if (old === null) throw new NotFoundError("rev_deleted");
    return this.write(rel, old, baseHash, this.text().commit.restore(rel, rev.slice(0, 7)));
  }

  /** 새 위키 토픽: 이름은 워크스페이스/토픽(워크스페이스 바로 아래 노드) */
  async createTopic(name: string): Promise<{ topic: string; schema: string }> {
    const topic = normalizeVaultPath(name.trim());
    if (!isTopicName(topic)) throw new PathError("topic_name");
    if (this.topicSet.has(topic)) throw new ConflictError(null, "topic_exists");
    const schema = `${topic}/SCHEMA.md`;
    await this.write(schema, schemaTemplate(topic, vaultLanguage(this.settings())), null, this.text().commit.createTopic(topic));
    return { topic, schema };
  }

  // ── 동기화용 ──

  /** 동기화 대상 파일(자동 생성 문서 제외)의 현재 해시. 첨부는 이때 처음 해시한다. */
  snapshot(): Promise<Map<string, { hash: string; md: boolean }>> {
    return this.exclusive(async () => {
      await this.scan();
      const out = new Map<string, { hash: string; md: boolean }>();
      for (const e of this.files.values()) {
        if (e.hash === null) {
          const data = await this.store.read(e.path);
          if (data === null) continue;
          e.hash = await sha256Hex(data);
        }
        out.set(e.path, { hash: e.hash, md: e.md });
      }
      return out;
    });
  }

  /**
   * 동기화로 받은 내용을 반영한다. expect(스냅샷 때 해시, 없던 파일이면 null)가 지금과 다르면
   * 그 사이 이 기기에서 바뀐 것이므로 건너뛴다(다음 동기화에서 다시 비교). 반영한 경로를 돌려준다.
   */
  applySync(changes: { path: string; data: Uint8Array | null; expect: string | null }[], message: string): Promise<string[]> {
    return this.exclusive(async () => {
      const applied: string[] = [];
      const md: { path: string; content: string | null }[] = [];
      for (const c of changes) {
        const rel = normalizeVaultPath(c.path);
        if (this.isGenerated(rel)) continue;
        const cur = this.files.get(rel);
        let curHash = cur ? cur.hash : null;
        if (cur && curHash === null) {
          const data = await this.store.read(rel);
          curHash = data ? await sha256Hex(data) : null;
        }
        if (curHash !== c.expect || (c.data === null && !cur)) continue;
        if (isMarkdown(rel)) {
          md.push({ path: rel, content: c.data === null ? null : fromUtf8(c.data) });
        } else if (c.data === null) {
          await this.store.remove(rel);
          this.files.delete(rel);
        } else {
          const st = await this.store.write(rel, c.data);
          this.files.set(rel, { path: rel, size: st.size, mtime: st.mtime, md: false, hash: await sha256Hex(c.data) });
        }
        applied.push(rel);
      }
      if (md.length) await this.apply(md, SYNC_AUTHOR, message, "sync");
      this.emit(
        applied.filter((p) => !isMarkdown(p)),
        "sync",
      );
      return applied;
    });
  }

  /** 내용 해시로 예전 내용을 찾는다(지금 파일 또는 이력 스냅샷). 3방향 병합의 기준 내용에 쓴다. */
  async contentByHash(hash: string): Promise<string | null> {
    for (const e of this.files.values()) if (e.hash === hash && e.content !== undefined) return e.content;
    return this.store.readMeta(objectName(hash));
  }

  /** 지금 내용을 스냅샷으로 남긴다(동기화 기준점이 된 문서: 나중에 3방향 병합의 기준으로 쓴다). */
  preserve(paths: string[]): Promise<void> {
    return this.exclusive(async () => {
      for (const p of paths) {
        const e = this.files.get(p);
        if (e?.md && e.hash && e.content !== undefined) await this.saveObject(e.hash, e.content);
      }
    });
  }

  fileUrl(path: string): string | null {
    return this.store.fileUrl?.(path) ?? null;
  }
}
