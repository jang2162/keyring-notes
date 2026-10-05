import { resolveLink } from "./markdown.js";
import type { DocMeta, LinkRow } from "./types.js";

/**
 * LLM Wiki 토픽: 최상위 폴더에 SCHEMA.md가 있으면 위키 토픽이다.
 *
 *   <토픽>/SCHEMA.md     위키 구조와 작업 규칙. 사람만 고친다.
 *   <토픽>/raw/           원본 자료(수집한 문서와 assets/ 원본 파일). 에이전트는 추가만.
 *   <토픽>/wiki/          에이전트가 관리하는 위키 페이지.
 *   <토픽>/wiki/index.md  자동으로 만드는 목차(페이지·원본 목록).
 *   <토픽>/wiki/log.md    변경 이력으로 만드는 작업 기록.
 *
 * 서버와 앱이 같은 함수로 index·log를 만든다. 데이터(문서 목록·링크·이력)를 어디서 가져오는지만 다르다.
 */
const GENERATED_RE = /^([^/]+)\/wiki\/(index|log)\.md$/;
const SCHEMA_RE = /^([^/]+)\/SCHEMA\.md$/;

export function isSchemaPath(rel: string): boolean {
  return SCHEMA_RE.test(rel);
}

/** SCHEMA.md 경로면 그 토픽 이름. */
export function schemaTopic(rel: string): string | null {
  return SCHEMA_RE.exec(rel)?.[1] ?? null;
}

/** 자동 생성 문서 모양의 경로면 {토픽, 종류}. 실제로 생성 문서인지는 토픽이 위키인지에 달렸다. */
export function generatedKind(rel: string): { topic: string; kind: "index" | "log" } | null {
  const m = GENERATED_RE.exec(rel);
  return m ? { topic: m[1], kind: m[2] as "index" | "log" } : null;
}

export function generatedPaths(topic: string): string[] {
  return [`${topic}/wiki/index.md`, `${topic}/wiki/log.md`];
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

export interface WikiLogEntry {
  date: string;
  author: string;
  message: string;
  files: { status: string; path: string; from?: string }[];
}

/**
 * 토픽 목차. docs는 읽을 수 있는 문서(자동 생성 문서 제외), allPaths는 링크 해석에 쓸 경로 전체,
 * links는 이 토픽 wiki/ 아래 문서에서 나간 링크(본문·출처).
 */
export function renderWikiIndex(topic: string, docs: DocMeta[], allPaths: string[], links: LinkRow[], opts: { by?: "server" | "app" } = {}): string {
  const maker = opts.by === "app" ? "앱이" : "서버가";
  docs = docs.filter((d) => d.path.startsWith(topic + "/"));
  const pages = docs.filter((d) => d.path.startsWith(`${topic}/wiki/`));
  const raws = docs.filter((d) => d.path.startsWith(`${topic}/raw/`) && !d.path.startsWith(`${topic}/raw/assets/`));
  const link = (d: DocMeta) => `[[${d.path.replace(/\.md$/i, "")}|${d.title.replace(/[|\]]/g, " ")}]]`;

  // 원본이 어느 위키 페이지에서든 링크(본문 또는 sources)되면 반영된 것으로 본다.
  const cited = new Map<string, number>();
  const linkRows = links.filter((r) => r.src.startsWith(`${topic}/wiki/`));
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
    `> ${maker} 자동으로 만드는 문서다. 직접 고치지 말 것. 규칙은 [[${topic}/SCHEMA|SCHEMA]], 작업 기록은 [[${topic}/wiki/log|log]].`,
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

/** 토픽 작업 기록. commits는 오래된 것부터, 이 토픽 파일이 들어 있는 변경들. 읽을 수 없는 파일은 뺀다. */
export function renderWikiLog(topic: string, commits: WikiLogEntry[], canRead: (p: string) => boolean, opts: { by?: "server" | "app" } = {}): string {
  const entries: WikiLogEntry[] = [];
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
    opts.by === "app"
      ? "> 앱이 이 기기의 변경 기록으로 자동 생성하는 문서다(오래된 것부터). 항목 제목 형식: `## [날짜 시각] 작성자 | 메시지`."
      : "> 서버가 Git 이력으로 자동 생성하는 문서다(오래된 것부터). 항목 제목 형식: `## [날짜 시각] 작성자 | 메시지`.",
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
