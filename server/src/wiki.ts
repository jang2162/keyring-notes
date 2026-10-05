import { readdir, stat, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { SYSTEM_AUTHOR } from "./git.js";
import { resolveLink } from "./markdown.js";
import type { DocMeta, NoteIndex } from "./noteindex.js";
import type { Vault } from "./vault.js";

/**
 * LLM Wiki 토픽: 최상위 폴더에 SCHEMA.md가 있으면 위키 토픽이다.
 *
 *   <토픽>/SCHEMA.md     위키 구조와 작업 규칙. 사람만 고친다.
 *   <토픽>/raw/           원본 자료(수집한 문서와 assets/ 원본 파일). 에이전트는 추가만.
 *   <토픽>/wiki/          에이전트가 관리하는 위키 페이지.
 *   <토픽>/wiki/index.md  서버가 만드는 목차(페이지·원본 목록).
 *   <토픽>/wiki/log.md    서버가 Git 이력으로 만드는 작업 기록.
 *
 * index·log는 읽는 사람의 권한에 따라 내용이 달라지므로(숨김 문서 제외),
 * 디스크에는 소유자용을 쓰고 에이전트에게는 요청할 때 다시 만들어 준다. Git·검색 인덱스에는 넣지 않는다.
 */
const GENERATED_RE = /^([^/]+)\/wiki\/(index|log)\.md$/;
const SCHEMA_RE = /^([^/]+)\/SCHEMA\.md$/;

export function isSchemaPath(rel: string): boolean {
  return SCHEMA_RE.test(rel);
}

export function schemaTemplate(topic: string): string {
  return `---
title: ${topic} 위키 스키마
---
# ${topic} 위키 스키마

이 문서는 ${topic} 위키의 구조와 작업 규칙이다. **사람만 고친다.** 에이전트는 작업 전에 반드시 이 문서를 읽는다.

## 목적

<!-- 이 위키가 무엇을 정리하는지, 누가 어떤 질문에 답하려고 쓰는지 적는다. -->
(예: 금리·환율 관련 기사와 보고서를 모아 개념·사건·인물별로 정리한다.)

## 구조

| 위치 | 내용 | 에이전트 권한(권장) |
| --- | --- | --- |
| \`${topic}/raw/\` | 수집한 원본 자료. 한 번 저장하면 바꾸지 않는다. 원본 파일은 \`raw/assets/\` | 추가만(append) |
| \`${topic}/wiki/\` | 원본을 읽고 정리한 위키 페이지 | 쓰기·삭제(delete) |
| \`${topic}/wiki/index.md\` | 페이지 목록과 미반영 원본. **서버가 자동 생성** | 읽기 |
| \`${topic}/wiki/log.md\` | 작업 기록(Git 이력). **서버가 자동 생성** | 읽기 |
| \`${topic}/SCHEMA.md\` | 이 문서 | 읽기(서버가 강제) |

## 페이지 규칙

- 파일 이름은 페이지 제목과 같게 한다(예: \`wiki/기준금리.md\`). 한 페이지에 한 개념·사건·인물.
- 프런트매터:
  \`\`\`yaml
  title: 기준금리
  summary: 한 줄 요약(목차에 그대로 나온다)
  category: 개념        # 목차의 묶음 이름
  sources: ["[[${topic}/raw/2026-10-05 기사 제목]]"]   # 근거가 된 원본
  updated: 2026-10-05
  \`\`\`
- 본문의 사실 주장에는 근거 원본을 \`[[${topic}/raw/원본 문서|짧은 이름]]\` 링크로 단다. 원본에 없는 내용은 쓰지 않는다.
- 다른 페이지는 \`[[페이지]]\`로 연결한다. 서로 어긋나는 내용을 발견하면 지우지 말고 "## 상충" 절에 양쪽 출처와 함께 남긴다.

## 작업 절차

### 수집(ingest)

1. \`wiki/index.md\`의 "미반영 원본"에서 원본을 고른다.
2. \`read_outline\` → \`read_section\`으로 원본을 읽는다.
3. 관련 페이지를 찾거나(\`search\`, \`backlinks\`) 새로 만든다. 기존 페이지는 마지막으로 읽은 hash로 고친다.
4. 바뀐 페이지들을 \`batch_write\` 한 번으로 저장하고, 메시지는 \`수집: <원본 제목>\`으로 쓴다.

### 질의(query)

1. \`wiki/index.md\`에서 관련 페이지를 찾고, 필요한 절만 읽는다.
2. 답에는 근거 페이지와 원본 링크를 단다.
3. 다시 쓸 만한 답은 새 페이지로 남긴다(\`batch_write\`, 메시지 \`질의: <질문 요약>\`).

### 정리(lint)

- 근거(sources) 없는 페이지, 아무 데서도 링크되지 않는 페이지, 깨진 링크, 오래된(updated가 오래된) 페이지, 상충하는 내용을 찾아 고친다.
- 메시지는 \`정리: <무엇을>\`으로 쓴다.
`;
}

interface LogEntry {
  date: string;
  author: string;
  message: string;
  files: { status: string; path: string; from?: string }[];
}

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

  private generatedPaths(): string[] {
    return [...this.topics].flatMap((t) => [`${t}/wiki/index.md`, `${t}/wiki/log.md`]);
  }

  isGenerated(rel: string): boolean {
    const m = GENERATED_RE.exec(rel);
    return m !== null && this.topics.has(m[1]);
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
      const m = SCHEMA_RE.exec(p);
      if (!m) continue;
      const exists = await stat(path.join(this.vault.root, p)).then(() => true, () => false);
      if (exists && !this.topics.has(m[1])) {
        this.topics.add(m[1]);
        topicsChanged = true;
      } else if (!exists && this.topics.delete(m[1])) {
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
    const m = GENERATED_RE.exec(rel)!;
    return m[2] === "index" ? this.renderIndex(m[1], canRead) : this.renderLog(m[1], canRead);
  }

  renderIndex(topic: string, canRead: (p: string) => boolean): string {
    const docs = this.index.docs().filter((d) => d.path.startsWith(topic + "/") && canRead(d.path) && !this.isGenerated(d.path));
    const pages = docs.filter((d) => d.path.startsWith(`${topic}/wiki/`));
    const raws = docs.filter((d) => d.path.startsWith(`${topic}/raw/`) && !d.path.startsWith(`${topic}/raw/assets/`));
    const link = (d: DocMeta) => `[[${d.path.replace(/\.md$/i, "")}|${d.title.replace(/[|\]]/g, " ")}]]`;

    // 원본이 어느 위키 페이지에서든 링크(본문 또는 sources)되면 반영된 것으로 본다.
    const allPaths = this.index.allPaths();
    const cited = new Map<string, number>();
    const linkRows = this.index.db
      .prepare("SELECT src, target FROM links WHERE src LIKE ? ESCAPE '\\'")
      .all(`${topic.replace(/[\\%_]/g, (c) => "\\" + c)}/wiki/%`) as { src: string; target: string }[];
    const targetsBySrc = new Map<string, Set<string>>();
    for (const r of linkRows) {
      const to = resolveLink(r.target, allPaths);
      if (to) targetsBySrc.set(r.src, (targetsBySrc.get(r.src) ?? new Set()).add(to));
    }
    for (const p of pages) {
      const set = targetsBySrc.get(p.path) ?? new Set<string>();
      const sources = p.frontmatter?.sources;
      for (const s of Array.isArray(sources) ? sources : typeof sources === "string" ? [sources] : []) {
        const to = resolveLink(String(s).replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0], allPaths);
        if (to) set.add(to);
      }
      for (const to of set) cited.set(to, (cited.get(to) ?? 0) + 1);
    }

    const groups = new Map<string, DocMeta[]>();
    for (const p of pages) {
      const cat = typeof p.frontmatter?.category === "string" && p.frontmatter.category.trim()
        ? p.frontmatter.category.trim()
        : p.path.slice(`${topic}/wiki/`.length).includes("/")
          ? p.path.slice(`${topic}/wiki/`.length).split("/")[0]
          : "페이지";
      groups.set(cat, [...(groups.get(cat) ?? []), p]);
    }
    const sortByTitle = (a: DocMeta, b: DocMeta) => a.title.localeCompare(b.title, "ko");
    const pending = raws.filter((r) => !cited.has(r.path));
    const out: string[] = [
      `# ${topic} 위키 목차`,
      "",
      `> 서버가 자동으로 만드는 문서다. 직접 고치지 말 것. 규칙은 [[${topic}/SCHEMA|SCHEMA]], 작업 기록은 [[${topic}/wiki/log|log]].`,
      "",
      `위키 페이지 ${pages.length}개 · 원본 ${raws.length}개(미반영 ${pending.length}개)`,
      "",
    ];
    if (pages.length === 0) out.push("_아직 위키 페이지가 없다._", "");
    for (const [cat, list] of [...groups.entries()].sort(([a], [b]) => (a === "페이지" ? 1 : b === "페이지" ? -1 : a.localeCompare(b, "ko")))) {
      out.push(`## ${cat}`, "");
      for (const p of list.sort(sortByTitle)) {
        const srcCount = Array.isArray(p.frontmatter?.sources) ? (p.frontmatter!.sources as unknown[]).length : 0;
        const meta = [srcCount ? `출처 ${srcCount}` : "출처 없음", `수정 ${new Date(p.mtime).toISOString().slice(0, 10)}`].join(" · ");
        out.push(`- ${link(p)}${p.summary ? ` — ${p.summary}` : ""} _(${meta})_`);
      }
      out.push("");
    }
    out.push("## 미반영 원본", "");
    if (pending.length === 0) out.push("_모든 원본이 위키 페이지에 반영되었다._");
    for (const r of pending.sort((a, b) => b.path.localeCompare(a.path, "ko"))) out.push(`- ${link(r)}`);
    out.push("", "## 반영된 원본", "");
    const done = raws.filter((r) => cited.has(r.path));
    if (done.length === 0) out.push("_없음_");
    for (const r of done.sort((a, b) => b.path.localeCompare(a.path, "ko"))) out.push(`- ${link(r)} — 페이지 ${cited.get(r.path)}개에서 인용`);
    return out.join("\n") + "\n";
  }

  async renderLog(topic: string, canRead: (p: string) => boolean): Promise<string> {
    const commits = await this.vault.git.logWithFiles(topic);
    const entries: LogEntry[] = [];
    for (const c of commits) {
      const files = c.files.filter((f) => f.path.startsWith(topic + "/") || f.from?.startsWith(topic + "/"));
      const visible = files.filter((f) => canRead(f.path) && (!f.from || canRead(f.from)));
      if (visible.length === 0) continue;
      // 숨김 파일이 섞인 커밋의 메시지는 숨김 문서 이름을 담고 있을 수 있어 감춘다.
      const message = visible.length === files.length ? c.message : "(일부 숨김) 변경";
      entries.push({ date: c.date, author: c.author, message, files: visible });
    }
    const label: Record<string, string> = { A: "추가", M: "수정", D: "삭제", R: "이동" };
    const fileLink = (p: string, deleted: boolean) => {
      const name = p.slice(topic.length + 1);
      if (deleted || !/\.md$/i.test(p)) return `\`${name}\``;
      return `[[${p.replace(/\.md$/i, "")}|${name.replace(/\.md$/i, "")}]]`;
    };
    const out = [
      `# ${topic} 작업 기록`,
      "",
      "> 서버가 Git 이력으로 자동 생성하는 문서다(오래된 것부터). 항목 제목 형식: `## [날짜 시각] 작성자 | 메시지`.",
      "",
    ];
    if (entries.length === 0) out.push("_아직 기록이 없다._");
    for (const e of entries) {
      const d = new Date(e.date);
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      out.push(`## [${stamp}] ${e.author} | ${e.message}`, "");
      for (const f of e.files) {
        const what = label[f.status] ?? f.status;
        out.push(f.from ? `- ${what}: \`${f.from.slice(topic.length + 1)}\` → ${fileLink(f.path, false)}` : `- ${what}: ${fileLink(f.path, f.status === "D")}`);
      }
      out.push("");
    }
    return out.join("\n").replace(/\n+$/, "") + "\n";
  }
}
