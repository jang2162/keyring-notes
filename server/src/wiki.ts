import { readdir, stat, writeFile, mkdir, access, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { SYSTEM_AUTHOR } from "./git.js";
import { generatedKind, renderWikiIndex, renderWikiLog, schemaTopic, type LinkRow } from "@keyring-notes/core";
import type { NoteIndex } from "./noteindex.js";
import type { Vault } from "./vault.js";

/**
 * LLM Wiki 토픽(구조는 core의 wiki.ts 참고). index·log는 읽는 사람의 권한에 따라 내용이 달라지므로(숨김 문서 제외),
 * 디스크에는 소유자용을 쓰고 에이전트에게는 요청할 때 다시 만들어 준다. Git·검색 인덱스에는 넣지 않는다.
 */
export class Wiki {
  readonly topics = new Set<string>();

  constructor(
    private vault: Vault,
    private index: NoteIndex,
  ) {}

  /**
   * vault.init() 전에 부른다: 위키 토픽을 찾고 자동 생성 문서를 Git 제외 목록에 올려,
   * 시작할 때의 "서버 밖에서 생긴 변경" 커밋에 index·log가 섞이지 않게 한다. Git 명령은 쓰지 않는다.
   */
  async prepare(): Promise<void> {
    this.topics.clear();
    const entries = await readdir(this.vault.root, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      try {
        await access(path.join(this.vault.root, e.name, "SCHEMA.md"));
        this.topics.add(e.name);
      } catch {
        /* 일반 토픽 */
      }
    }
    this.index.skip = (rel) => this.isGenerated(rel);
    this.vault.readOnly = (rel) => this.isGenerated(rel);
    this.vault.git.extraExcludes = this.generatedPaths();
  }

  /** vault.init() 뒤에 부른다: 예전에 추적되던 자동 생성 문서가 있으면 이력에서 빼고, 모두 다시 만든다. */
  async init(): Promise<void> {
    await this.updateExcludes();
    for (const t of this.topics) await this.regenerate(t);
  }

  /**
   * 백업 복원처럼 볼트 전체가 바뀐 뒤: 토픽을 다시 찾고, 사라진 토픽에 남은 자동 생성 문서를 지우고,
   * 검색 인덱스를 맞춘 뒤 index·log를 다시 만든다.
   */
  async resync(): Promise<void> {
    const before = new Set(this.topics);
    await this.prepare();
    for (const t of before) {
      if (this.topics.has(t)) continue;
      for (const f of ["index.md", "log.md"]) await rm(path.join(this.vault.root, t, "wiki", f), { force: true });
      for (const d of [path.join(this.vault.root, t, "wiki"), path.join(this.vault.root, t)]) await rmdir(d).catch(() => undefined);
    }
    await this.updateExcludes();
    await this.index.sync(this.vault);
    for (const t of this.topics) await this.regenerate(t);
  }

  private generatedPaths(): string[] {
    return [...this.topics].flatMap((t) => [`${t}/wiki/index.md`, `${t}/wiki/log.md`]);
  }

  isGenerated(rel: string): boolean {
    const g = generatedKind(rel);
    return g !== null && this.topics.has(g.topic);
  }

  topicOf(rel: string): string | null {
    const t = rel.split("/")[0];
    return this.topics.has(t) ? t : null;
  }

  private async updateExcludes() {
    await this.vault.git.setExtraExcludes(this.generatedPaths());
    await this.vault.git.commitStaged("자동 생성 문서를 이력에서 제외", SYSTEM_AUTHOR);
  }

  /** Vault.onChange에서 부른다(인덱스 갱신 뒤). */
  async onChange(paths: string[]): Promise<void> {
    let topicsChanged = false;
    for (const p of paths) {
      const topic = schemaTopic(p);
      if (!topic) continue;
      const exists = await stat(path.join(this.vault.root, p)).then(() => true, () => false);
      if (exists && !this.topics.has(topic)) {
        this.topics.add(topic);
        topicsChanged = true;
      } else if (!exists && this.topics.delete(topic)) {
        topicsChanged = true;
      }
    }
    if (topicsChanged) {
      await this.updateExcludes();
      // 새로 위키가 된 토픽의 index·log가 검색 인덱스에 들어 있었다면 뺀다.
      await this.index.refresh(this.vault.root, [...this.topics].flatMap((t) => [`${t}/wiki/index.md`, `${t}/wiki/log.md`]));
    }
    const touched = new Set(paths.map((p) => this.topicOf(p)).filter((t): t is string => t !== null));
    for (const t of touched) await this.regenerate(t);
  }

  /** 디스크에 소유자용 index·log를 쓴다(다른 에디터에서 열었을 때 보이는 내용). */
  async regenerate(topic: string): Promise<void> {
    const dir = path.join(this.vault.root, topic, "wiki");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.md"), this.renderIndex(topic, () => true));
    await writeFile(path.join(dir, "log.md"), await this.renderLog(topic, () => true));
  }

  render(rel: string, canRead: (p: string) => boolean): Promise<string> | string {
    const g = generatedKind(rel)!;
    return g.kind === "index" ? this.renderIndex(g.topic, canRead) : this.renderLog(g.topic, canRead);
  }

  renderIndex(topic: string, canRead: (p: string) => boolean): string {
    const docs = this.index.docs().filter((d) => d.path.startsWith(topic + "/") && canRead(d.path) && !this.isGenerated(d.path));
    const links = this.index.db
      .prepare("SELECT src, target, kind FROM links WHERE src LIKE ? ESCAPE '\\'")
      .all(`${topic.replace(/[\\%_]/g, (c) => "\\" + c)}/wiki/%`) as unknown as LinkRow[];
    return renderWikiIndex(topic, docs, this.index.allPaths(), links);
  }

  async renderLog(topic: string, canRead: (p: string) => boolean): Promise<string> {
    return renderWikiLog(topic, await this.vault.git.logWithFiles(topic), canRead);
  }
}

export { isSchemaPath, schemaTemplate } from "@keyring-notes/core";
