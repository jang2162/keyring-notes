import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { Ingestor } from "../src/ingest.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { cleanTitle } from "../src/convert.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

/** 영문 한 줄짜리 최소 PDF(한글 글꼴이 없는 환경에서도 만들 수 있게). */
export const TINY_PDF = new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 18 Tf 20 100 Td (Interest rate held at 3.0) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

const ARTICLE = `<!doctype html><html><head><title>기준금리 동결 | 경제신문</title><meta name="author" content="홍길동"></head>
<body><nav>메뉴 메뉴 메뉴</nav><article><h1>한국은행, 기준금리 동결</h1>
<p>한국은행 금융통화위원회는 기준금리를 연 3.0%로 동결했다. ${"물가와 성장 흐름을 함께 고려했다. ".repeat(10)}</p>
<h2>시장 반응</h2><p>채권 금리가 내렸다. <a href="/related">관련 기사</a></p></article><footer>광고</footer></body></html>`;

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/article") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ARTICLE);
    } else if (req.url === "/report.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(Buffer.from(TINY_PDF));
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: "/article" });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

let dir: string;
let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let ingestor: Ingestor;
let owner: ScopedVault;

beforeEach(async () => {
  const t = await tempDir("keyring-wiki-");
  dir = t.dir;
  cleanup = t.cleanup;
  ({ vault, index, wiki, ingestor } = await openVault(dir, { allowPrivate: true }));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

const as = (rules: Parameters<typeof agentPrincipal>[1], name = "wiki-agent") => new ScopedVault(vault, agentPrincipal(name, rules), index, wiki);
const git = (...args: string[]) => execFileSync("git", ["--git-dir", path.join(dir, ".history"), "--work-tree", dir, "-c", "core.quotePath=false", ...args], { encoding: "utf8" });

describe("위키 토픽", () => {
  it("SCHEMA.md 템플릿과 자동 생성 index·log를 만들고, 자동 생성 문서는 Git·검색에서 뺀다", async () => {
    await owner.createTopic("업무/경제");
    expect((await owner.read("업무/경제/SCHEMA.md")).content).toContain("# 경제 위키 스키마");
    const idx = await owner.read("업무/경제/wiki/index.md");
    expect(idx.generated).toBe(true);
    expect(idx.content).toContain("# 업무/경제 위키 목차");
    expect((await owner.read("업무/경제/wiki/log.md")).content).toContain("위키 토픽 만들기: 업무/경제");
    const tracked = git("ls-files");
    expect(tracked).toContain("업무/경제/SCHEMA.md");
    expect(tracked).not.toContain("업무/경제/wiki/index.md");
    expect(git("status", "--porcelain")).toBe("");
    expect(idx.content).toContain("아직 위키 페이지가 없다");
    expect(await owner.search("아직 페이지가 없다")).toEqual([]); // index.md에만 있는 문구
    expect((await owner.topics()).find((t) => t.name === "업무/경제")).toMatchObject({ wiki: true, pages: 0, raw: 0 });
  });

  it("자동 생성 문서는 소유자도 직접 고칠 수 없다", async () => {
    await owner.createTopic("업무/경제");
    const idx = await owner.read("업무/경제/wiki/index.md");
    await expect(owner.write("업무/경제/wiki/index.md", "x", idx.hash)).rejects.toThrow(/자동 생성/);
    await expect(owner.append("업무/경제/wiki/log.md", "x")).rejects.toThrow(/자동 생성/);
  });

  it("SCHEMA.md는 에이전트 규칙이 delete여도 읽기만 된다", async () => {
    await owner.createTopic("업무/경제");
    const agent = as({ "업무/경제": "delete" });
    expect(agent.level("업무/경제/SCHEMA.md")).toBe("read");
    const s = await agent.read("업무/경제/SCHEMA.md");
    await expect(agent.write("업무/경제/SCHEMA.md", "규칙 바꿈", s.hash)).rejects.toThrow(/권한/);
    await expect(agent.createTopic("새토픽")).rejects.toThrow(/소유자만/);
  });

  it("위키 토픽이 아닌 폴더에는 수집할 수 없다", async () => {
    await owner.write("메모/a.md", "x", null);
    await expect(ingestor.ingest(owner, { kind: "text", topic: "메모", title: "t", text: "x" })).rejects.toThrow(/위키 토픽이 아닙니다/);
  });
});

describe("제목 정리", () => {
  it("사이트 이름 꼬리만 뗀다", () => {
    expect(cleanTitle("원·달러 환율 1,380원대로 하락 | 경제신문", "경제신문")).toBe("원·달러 환율 1,380원대로 하락");
    expect(cleanTitle("Rates held - Reuters")).toBe("Rates held");
    expect(cleanTitle("금리 - 연합")).toBe("금리 - 연합"); // 앞부분이 너무 짧으면 그대로
    expect(cleanTitle("Interest rates held steady again - Reuters")).toBe("Interest rates held steady again");
    expect(cleanTitle("가 - 나 - 다라마바사아자차카타파하")).toBe("가 - 나 - 다라마바사아자차카타파하");
  });
});

describe("수집", () => {
  beforeEach(async () => {
    await owner.createTopic("업무/경제");
  });

  it("URL(HTML): 본문만 마크다운으로, 프런트매터에 출처", async () => {
    const r = await ingestor.ingest(owner, { kind: "url", topic: "업무/경제", url: `${base}/redirect` });
    expect(r.path).toMatch(/^업무\/경제\/raw\/\d{4}-\d{2}-\d{2} .+\.md$/);
    const doc = await owner.read(r.path);
    expect(doc.content).toMatch(/source_type: url/);
    expect(doc.content).toContain(`source_url: ${base}/article`);
    expect(doc.content).toContain("author: 홍길동");
    expect(doc.content).toContain("기준금리를 연 3.0%로 동결했다");
    expect(doc.content).toContain(`[관련 기사](${base}/related)`);
    expect(doc.content).not.toContain("광고");
    expect(r.title).toBe("기준금리 동결"); // "| 경제신문" 같은 사이트 꼬리 제거
    expect(git("log", "-1", "--format=%an %s")).toContain("me 수집:");
  });

  it("URL(PDF): 원본 PDF를 assets에, 텍스트를 마크다운으로", async () => {
    const r = await ingestor.ingest(owner, { kind: "url", topic: "업무/경제", url: `${base}/report.pdf` });
    expect(r.asset).toMatch(/^업무\/경제\/raw\/assets\/.+\.pdf$/);
    expect(await readFile(path.join(dir, r.asset!))).toEqual(Buffer.from(TINY_PDF));
    const doc = await owner.read(r.path);
    expect(doc.content).toContain("Interest rate held at 3.0");
    expect(doc.content).toContain(`original: "[[${r.asset}]]"`);
  });

  it("파일 업로드: PDF·이미지·마크다운, 같은 이름은 번호를 붙인다", async () => {
    const pdf = await ingestor.ingest(owner, { kind: "file", topic: "업무/경제", filename: "보고서.pdf", data: TINY_PDF });
    expect((await owner.read(pdf.path)).content).toContain("original_name: 보고서.pdf");
    const img = await ingestor.ingest(owner, { kind: "file", topic: "업무/경제", filename: "차트.png", data: new Uint8Array([137, 80, 78, 71]) });
    expect((await owner.read(img.path)).content).toContain(`![[${img.asset}]]`);
    const md1 = await ingestor.ingest(owner, { kind: "file", topic: "업무/경제", filename: "메모.md", data: new TextEncoder().encode("# 회의 메모\n내용") });
    const md2 = await ingestor.ingest(owner, { kind: "file", topic: "업무/경제", filename: "메모.md", data: new TextEncoder().encode("# 회의 메모\n내용2") });
    expect(md1.title).toBe("회의 메모");
    expect(md2.path).toBe(md1.path.replace(/\.md$/, " (2).md"));
  });

  it("웹 클리퍼: 선택 영역만 저장할 수 있다", async () => {
    const r = await ingestor.ingest(owner, {
      kind: "html",
      topic: "업무/경제",
      html: ARTICLE,
      url: "https://news.example.com/a",
      selectionHtml: "<p>채권 금리가 <b>내렸다</b>.</p>",
    });
    const doc = await owner.read(r.path);
    expect(doc.content).toContain("source_type: clip");
    expect(doc.content).toContain("채권 금리가 **내렸다**.");
    expect(doc.content).not.toContain("물가와 성장");
  });

  it("사설·루프백 주소는 기본으로 막는다(SSRF)", async () => {
    // 같은 볼트·위키에 사설 주소를 허용하지 않는(기본값) Ingestor
    const guarded = new Ingestor(vault, wiki, { allowPrivate: false });
    for (const url of [`${base}/article`, "http://localhost:1/x", "http://[::1]/x", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
      await expect(guarded.ingest(owner, { kind: "url", topic: "업무/경제", url }), url).rejects.toThrow(/사설|http·https/);
    }
  });

  it("추가 전용 에이전트는 수집할 수 있고, 읽기 전용은 못 한다", async () => {
    const appender = as({ "업무/경제/raw": "append", "업무/경제/wiki": "delete" });
    expect((await appender.topics()).find((t) => t.name === "업무/경제")).toMatchObject({ wiki: true, access: "partial" });
    expect((await as({ "업무/경제": "read" }).topics()).find((t) => t.name === "업무/경제")?.access).toBe("read");
    const r = await ingestor.ingest(appender, { kind: "text", topic: "업무/경제", title: "대화 기록", text: "금리 이야기" });
    expect(git("log", "-1", "--format=%an")).toContain("wiki-agent");
    expect((await owner.read(r.path)).content).toContain("ingested_by: wiki-agent");
    const reader = as({ "업무/경제": "read" });
    await expect(ingestor.ingest(reader, { kind: "text", topic: "업무/경제", title: "x", text: "x" })).rejects.toThrow(/권한/);
    await expect(ingestor.ingest(appender, { kind: "file", topic: "업무/경제", filename: "x.pdf", data: TINY_PDF })).resolves.toBeDefined();
  });
});

describe("index·log 자동 생성", () => {
  beforeEach(async () => {
    await owner.createTopic("업무/경제");
  });

  it("페이지 목록·요약·묶음, 미반영 원본 → 인용되면 반영으로", async () => {
    const raw = await ingestor.ingest(owner, { kind: "text", topic: "업무/경제", title: "금리 기사", text: "기준금리 3.0% 동결" });
    let idx = (await owner.read("업무/경제/wiki/index.md")).content;
    expect(idx).toContain("원본 1개(미반영 1개)");
    expect(idx).toMatch(/## 미반영 원본\n\n- \[\[업무/경제\/raw\/.+금리 기사\|금리 기사\]\]/);

    const agent = as({ "업무/경제/raw": "append", "업무/경제/wiki": "delete" });
    await agent.batch(
      [
        {
          op: "write",
          path: "업무/경제/wiki/기준금리.md",
          content: `---\ntitle: 기준금리\nsummary: 한국은행이 정하는 정책 금리\ncategory: 개념\nsources: ["[[${raw.path.replace(/\.md$/, "")}]]"]\n---\n# 기준금리\n3.0%로 동결되었다.\n`,
          baseHash: null,
        },
        { op: "write", path: "업무/경제/wiki/환율.md", content: "# 환율\n원화 가치를 다룬다.\n[[기준금리]]와 관련.\n", baseHash: null },
      ],
      "수집: 금리 기사",
    );
    idx = (await owner.read("업무/경제/wiki/index.md")).content;
    expect(idx).toContain("위키 페이지 2개 · 원본 1개(미반영 0개)");
    expect(idx).toContain("## 개념\n\n- [[업무/경제/wiki/기준금리|기준금리]] — 한국은행이 정하는 정책 금리 _(출처 1 · 수정");
    expect(idx).toContain("## 페이지\n\n- [[업무/경제/wiki/환율|환율]] — 원화 가치를 다룬다. _(출처 없음");
    expect(idx).toContain("금리 기사]] — 페이지 1개에서 인용");

    const log = (await owner.read("업무/경제/wiki/log.md")).content;
    expect(log).toMatch(/## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] me \| 수집: 금리 기사\n\n- 추가: \[\[업무/경제\/raw\//);
    expect(log).toMatch(/## \[[^\]]+\] wiki-agent \| 수집: 금리 기사\n\n- 추가: \[\[업무/경제\/wiki\/기준금리\|wiki\/기준금리\]\]\n- 추가: \[\[업무/경제\/wiki\/환율\|wiki\/환율\]\]/);
    // 위키 index·log가 새 백링크를 만들지 않는다(검색 인덱스에서 빠짐)
    expect((await owner.backlinks("업무/경제/wiki/기준금리.md")).map((b) => b.path)).toEqual(["업무/경제/wiki/환율.md"]);
  });

  it("원본을 볼 수 없는 에이전트에게는 index·log에서 원본 이름이 빠진다", async () => {
    await ingestor.ingest(owner, { kind: "text", topic: "업무/경제", title: "비밀 보고서", text: "내부 자료" });
    await owner.batch([{ op: "write", path: "업무/경제/wiki/공개.md", content: "# 공개\n공개 페이지\n", baseHash: null }]);
    const wikiOnly = as({ "업무/경제/wiki": "read" }, "reader");
    for (const p of ["업무/경제/wiki/index.md", "업무/경제/wiki/log.md"]) {
      const d = await wikiOnly.read(p);
      expect(d.content).not.toContain("비밀 보고서");
      expect((await wikiOnly.readRaw(p)).data.toString()).not.toContain("비밀 보고서");
      // 소유자용 디스크 파일에는 있다
      expect(await readFile(path.join(dir, p), "utf8")).toContain("비밀 보고서");
    }
    expect((await wikiOnly.read("업무/경제/wiki/index.md")).content).toContain("[[업무/경제/wiki/공개|공개]]");
    expect((await wikiOnly.read("업무/경제/wiki/log.md")).content).not.toContain("수집:");
    expect(await wikiOnly.search("비밀")).toEqual([]);
  });

  it("서버 재시작 때 기존 위키 토픽을 찾아 다시 만든다", async () => {
    await owner.batch([{ op: "write", path: "업무/경제/wiki/a.md", content: "# A\n", baseHash: null }]);
    const commitsBefore = git("rev-list", "--count", "HEAD");
    index.close();
    const again = await openVault(dir);
    index = again.index;
    expect([...again.wiki.topics]).toEqual(["업무/경제"]);
    const o2 = new ScopedVault(again.vault, ownerPrincipal, again.index, again.wiki);
    expect((await o2.read("업무/경제/wiki/index.md")).content).toContain("[[업무/경제/wiki/a|A]]");
    expect(git("status", "--porcelain")).toBe("");
    // 재시작해도 쓸데없는 커밋이 생기지 않는다
    expect(git("rev-list", "--count", "HEAD")).toBe(commitsBefore);
    expect(git("ls-files")).not.toContain("wiki/index.md");
  });
});

describe("REST 업로드·MCP", () => {
  it("업로드는 x-keyring-upload 헤더가 있어야 하고, 토픽 목록·수집이 된다", async () => {
    const config = new ConfigStore(path.join(dir, ".keyring", "test-config.json"));
    config.setPassword("correct horse");
    const token = config.issueToken("wiki-work");
    config.setRule("wiki-work", "업무/경제/raw", "append");
    config.setRule("wiki-work", "업무/경제/wiki", "delete");
    const app = createApp({ vault, index, config, wiki, ingestor, admin: { backups: new BackupService(vault, config, path.join(vault.root, ".keyring", "backups"), () => wiki.resync()) } });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const json = { "content-type": "application/json", cookie };

    expect((await app.request("/api/topics", { method: "POST", headers: json, body: JSON.stringify({ name: "업무/경제" }) })).status).toBe(200);
    const topics = await (await app.request("/api/topics", { headers: { cookie } })).json();
    expect(topics.topics).toEqual([expect.objectContaining({ name: "업무/경제", wiki: true })]);

    const url = `/api/ingest/file?topic=${encodeURIComponent("업무/경제")}&name=${encodeURIComponent("보고서.pdf")}`;
    const noHeader = await app.request(url, { method: "POST", headers: { cookie, "content-type": "application/octet-stream" }, body: TINY_PDF });
    expect(noHeader.status).toBe(415);
    const up = await app.request(url, {
      method: "POST",
      headers: { cookie, "content-type": "application/octet-stream", "x-keyring-upload": "1" },
      body: TINY_PDF,
    });
    expect(up.status).toBe(200);
    expect((await up.json()).asset).toMatch(/\.pdf$/);

    const text = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "text", topic: "업무/경제", title: "에이전트 메모", text: "메모" }),
    });
    expect(text.status).toBe(200);
    const idx = await (await app.request(`/api/file?path=${encodeURIComponent("업무/경제/wiki/index.md")}`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(idx.generated).toBe(true);
    expect(idx.content).toContain("에이전트 메모");
  });
});
