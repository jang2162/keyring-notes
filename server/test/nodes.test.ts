import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFrontmatter } from "@keyring-notes/core";
import { AccessPolicy } from "../src/access.js";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import type { Ingestor } from "../src/ingest.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import { hashContent, type Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let ingestor: Ingestor;
let owner: ScopedVault;

beforeEach(async () => {
  const t = await tempDir("keyring-nodes-");
  cleanup = t.cleanup;
  ({ vault, index, wiki, ingestor } = await openVault(path.join(t.dir, "vault")));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("권한: 규칙 X는 노드 노트 X.md도 덮는다", () => {
  it("AccessPolicy", () => {
    const p = new AccessPolicy({ 업무: "read", "업무/비밀": "hidden", "업무/비밀/공개": "read" });
    expect(p.level("업무.md")).toBe("read");
    expect(p.level("업무/비밀.md")).toBe("hidden");
    expect(p.level("업무/비밀/x.md")).toBe("hidden");
    expect(p.level("업무/비밀/공개.md")).toBe("read");
    expect(p.level("업무/비밀/공개/a.md")).toBe("read");
    // 이름이 비슷한 형제는 덮지 않는다
    expect(p.level("업무/비밀2.md")).toBe("read");
    expect(p.level("업무/비밀.md.bak")).toBe("read");
    expect(p.mayContainVisible("업무/비밀")).toBe(true);
    expect(new AccessPolicy({ 업무: "read", "업무/비밀": "hidden" }).mayContainVisible("업무/비밀")).toBe(false);
  });

  it("숨김 노드의 노트·하위가 목록·검색·백링크·링크 해석·태그·그래프·위젯·위키 index/log·하위 목록에서 새지 않는다", async () => {
    await owner.createTopic("업무/경제");
    await owner.batch([
      { op: "write", path: "업무/공개.md", content: "# 공개\n[[비밀]] [[비밀/계획]] 그리고 [[계획]]\n#공개태그", baseHash: null },
      { op: "write", path: "업무/비밀.md", content: "---\ntags: [비밀태그]\n---\n# 비밀 노드 노트\n기밀단어 [[공개]]", baseHash: null },
      { op: "write", path: "업무/비밀/계획.md", content: "# 계획\n기밀단어 #비밀태그2 [[공개]]", baseHash: null },
      { op: "write", path: "업무/경제/raw/기사.md", content: "# 기사", baseHash: null },
      { op: "write", path: "업무/경제/wiki/금리.md", content: "---\nsources: ['[[기사]]']\n---\n# 금리 [[비밀]]", baseHash: null },
    ]);
    // 위키 log에 숨김 노드 이름이 든 커밋(같은 일괄 쓰기에서 토픽과 숨김 노드를 같이 바꿈)
    await owner.batch(
      [
        { op: "append", path: "업무/경제/wiki/금리.md", content: "더" },
        { op: "append", path: "업무/비밀.md", content: "더" },
      ],
      "비밀 노드와 금리를 같이 고침",
    );
    const agent = new ScopedVault(vault, agentPrincipal("bot", { 업무: "read", "업무/비밀": "hidden" }), index, wiki);
    // 링크 글("비밀")은 보이는 문서에 적힌 글이라 새는 것이 아니다. 숨김 노드의 경로·내용·태그·커밋 메시지만 본다
    const leaks = (v: unknown) => /비밀 노드|기밀단어|비밀태그|업무\/비밀["./]/.test(JSON.stringify(v));

    expect(leaks(await agent.documents())).toBe(false);
    expect(leaks(await agent.tree())).toBe(false);
    expect(leaks(await agent.children("업무"))).toBe(false);
    expect((await agent.children("업무")).map((c) => c.name)).toEqual(["경제", "공개"]);
    await expect(agent.children("업무/비밀")).rejects.toThrow(/노드가 없습니다/);
    expect(await agent.search("기밀단어")).toEqual([]);
    expect(await agent.search("#비밀태그")).toEqual([]);
    expect(await agent.search("기밀단어", { folder: "업무/비밀", lines: 3 })).toEqual([]);
    expect(await agent.search("", { tags: ["비밀태그"] })).toEqual([]);
    expect(await agent.search("", { tags: ["비밀태그2"], folder: "업무" })).toEqual([]);
    expect(leaks(await agent.search("공개", { folder: "업무", lines: 50 }))).toBe(false);
    expect(leaks(await agent.tags())).toBe(false);
    expect((await agent.backlinks("업무/공개.md")).map((b) => b.path)).toEqual([]);
    const outline = await agent.outline("업무/공개.md");
    expect(outline.links.map((l) => l.path)).toEqual([null, null, null]);
    expect(leaks(await agent.graph())).toBe(false);
    const w = await agent.widget("type: query\nfrom: 업무");
    expect(leaks(w)).toBe(false);
    expect(leaks(await agent.topics())).toBe(false);
    const idx = await agent.read("업무/경제/wiki/index.md");
    const log = await agent.read("업무/경제/wiki/log.md");
    expect(leaks(idx.content)).toBe(false);
    expect(leaks(log.content)).toBe(false);
    expect(log.content).toContain("(일부 숨김) 변경");
    expect(leaks(await agent.lint())).toBe(false);
    expect(leaks(await agent.sources("업무/경제/wiki/금리.md"))).toBe(false);
    await expect(agent.read("업무/비밀.md")).rejects.toThrow(/문서가 없습니다/);
    await expect(agent.history("업무/비밀.md")).rejects.toThrow(/문서가 없습니다/);
    // 소유자는 다 보인다
    expect((await owner.outline("업무/공개.md")).links.map((l) => l.path)).toEqual(["업무/비밀.md", "업무/비밀/계획.md", "업무/비밀/계획.md"]);
  });
});

describe("위키 토픽은 워크스페이스 바로 아래(2단계)", () => {
  it("<워크스페이스>/<토픽>/SCHEMA.md만 토픽이고, 맨 위나 3단계 SCHEMA.md는 아니다", async () => {
    await owner.batch([
      { op: "write", path: "옛토픽/SCHEMA.md", content: "# 옛", baseHash: null },
      { op: "write", path: "업무/a/b/SCHEMA.md", content: "# 깊음", baseHash: null },
    ]);
    expect(wiki.topics.size).toBe(0);
    await expect(owner.createTopic("경제")).rejects.toThrow(/두 단계/);
    await expect(owner.createTopic("업무/경제/세부")).rejects.toThrow(/두 단계/);
    await owner.createTopic("업무/경제");
    expect([...wiki.topics]).toEqual(["업무/경제"]);
    expect((await owner.read("업무/경제/wiki/index.md")).content).toContain("# 업무/경제 위키 목차");
    const topics = await owner.topics();
    expect(topics.find((t) => t.name === "업무/경제")).toMatchObject({ wiki: true, workspace: "업무" });
    expect(topics.find((t) => t.name === "업무/a")).toMatchObject({ wiki: false });
    const r = await ingestor.ingest(owner, { kind: "text", topic: "업무/경제", title: "기사", text: "본문" });
    expect(r.path).toMatch(/^업무\/경제\/raw\//);
    await expect(ingestor.ingest(owner, { kind: "text", topic: "업무/a", title: "t", text: "x" })).rejects.toThrow(/위키 토픽이 아닙니다/);
  });

  it("볼트 언어가 영어면 SCHEMA 템플릿·index·log·커밋 메시지가 영어", async () => {
    vault.fallbackLang = "en";
    await owner.createTopic("Work/Economy");
    expect((await owner.read("Work/Economy/SCHEMA.md")).content).toContain("# Work/Economy wiki schema");
    expect((await owner.read("Work/Economy/wiki/index.md")).content).toContain("## Unprocessed sources");
    expect((await owner.read("Work/Economy/wiki/log.md")).content).toContain("Create wiki topic: Work/Economy");
    await owner.write("Work/a.md", "x", null);
    expect((await owner.history("Work/a.md"))[0].message).toBe("Create: Work/a.md");
  });
});

describe("이력 가리기: 커밋의 실제 변경 목록으로", () => {
  it("이동·노드 이동·일괄 쓰기 모두, 메시지가 어떤 언어·모양이어도 숨김 경로가 낀 커밋은 가린다", async () => {
    await owner.batch([
      { op: "write", path: "비밀/가계부.md", content: "돈", baseHash: null },
      { op: "write", path: "비밀/노드.md", content: "노드", baseHash: null },
      { op: "write", path: "비밀/노드/하위.md", content: "하위", baseHash: null },
      { op: "write", path: "공개/메모.md", content: "메모", baseHash: null },
    ]);
    const agent = new ScopedVault(vault, agentPrincipal("bot", { 공개: "read" }), index, wiki);
    // 1) 문서 이동(한국어 메시지)
    const g = await owner.read("비밀/가계부.md");
    await owner.move(g.path, "공개/가계부.md", g.hash);
    // 2) 볼트 언어를 영어로 바꾼 뒤 노드 이동(영어 메시지 "Move node: …")
    vault.fallbackLang = "en";
    await owner.moveNode("비밀/노드", "공개/노드");
    // 3) 사람이 쓴 메시지의 일괄 쓰기(숨김 경로 이름이 메시지에 들어 있음)
    const m = await owner.read("공개/메모.md");
    await owner.batch(
      [
        { op: "append", path: "공개/메모.md", content: "더" },
        { op: "write", path: "비밀/새비밀.md", content: "x", baseHash: null },
      ],
      "비밀/새비밀.md 만들고 메모 고침",
    );
    void m;
    const all = [
      ...(await agent.history("공개/가계부.md")),
      ...(await agent.history("공개/노드.md")),
      ...(await agent.history("공개/노드/하위.md")),
      ...(await agent.history("공개/메모.md")),
    ];
    const text = all.map((c) => c.message).join("\n");
    expect(text).not.toContain("비밀");
    expect(all.filter((c) => c.message === "(change involving hidden paths)").length).toBeGreaterThanOrEqual(5);
    // 숨김 경로가 없는 커밋은 그대로
    await owner.write("공개/메모2.md", "y", null);
    expect((await agent.history("공개/메모2.md"))[0].message).toBe("Create: 공개/메모2.md");
    // 에이전트 언어가 한국어면 가린 글도 한국어
    agent.agentLang = "ko";
    expect((await agent.history("공개/가계부.md")).map((c) => c.message)).toContain("(숨김 경로가 포함된 변경)");
    // 소유자는 원래 메시지
    expect((await owner.history("공개/메모.md"))[0].message).toBe("비밀/새비밀.md 만들고 메모 고침");
  });
});

describe("REST·MCP: 노드 API와 에이전트 언어", () => {
  let app: ReturnType<typeof createApp>;
  let config: ConfigStore;
  let cookie = "";
  let token = "";
  const json = { "content-type": "application/json" };

  beforeEach(async () => {
    const t = await tempDir("keyring-nodes-api-");
    const prev = cleanup;
    cleanup = async () => {
      await prev();
      await t.cleanup();
    };
    config = new ConfigStore(path.join(t.dir, "keyring.json"));
    config.setPassword("correct horse");
    token = config.issueToken("bot");
    config.setRule("bot", "업무", "read");
    config.setRule("bot", "업무/비밀", "hidden");
    app = createApp({
      vault,
      index,
      config,
      wiki,
      ingestor,
      admin: { backups: new BackupService(vault, config, path.join(t.dir, "backups"), () => wiki.resync()) },
    });
    const res = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
    cookie = res.headers.get("set-cookie")!.split(";")[0];
    await owner.batch([
      { op: "write", path: "업무/노드.md", content: "노드", baseHash: null },
      { op: "write", path: "업무/노드/하위.md", content: "하위", baseHash: null },
      { op: "write", path: "업무/비밀.md", content: "비밀", baseHash: null },
    ]);
  });

  async function mcp(lang?: "ko") {
    if (lang) config.update((c) => void (c.agentLanguage = lang));
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: async (url, init) => app.request(String(url), init as RequestInit),
      }),
    );
    return client;
  }

  it("노드 이동·삭제·되살리기(첨부 base64)", async () => {
    const h = { ...json, cookie };
    let res = await app.request("/api/move", { method: "POST", headers: h, body: JSON.stringify({ from: "업무/노드", to: "업무/보관/노드", node: true }) });
    expect(res.status).toBe(200);
    expect((await res.json()).moved).toEqual([
      ["업무/노드.md", "업무/보관/노드.md"],
      ["업무/노드/하위.md", "업무/보관/노드/하위.md"],
    ]);
    res = await app.request("/api/node/delete", { method: "POST", headers: h, body: JSON.stringify({ path: "업무/보관/노드" }) });
    expect((await res.json()).deleted).toEqual(["업무/보관/노드.md", "업무/보관/노드/하위.md"]);
    res = await app.request("/api/batch", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        operations: [
          { op: "write", path: "업무/보관/노드.md", content: "노드", baseHash: null },
          { op: "put", path: "업무/보관/노드/그림.png", data: Buffer.from([1, 2, 3]).toString("base64") },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect([...(await vault.readRaw("업무/보관/노드/그림.png")).data]).toEqual([1, 2, 3]);
  });

  it("MCP: 기본은 영어 설명, 에이전트 언어를 바꾸면 한국어. list_children은 숨김 노드를 빼고, lint 설명도 그 언어로", async () => {
    let client = await mcp();
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "list_children")!.description).toMatch(/^Child nodes of a node/);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
      return JSON.parse(r.content[0].text);
    };
    expect((await call("list_children", { path: "업무" })).map((c: { name: string }) => c.name)).toEqual(["노드"]);
    expect((await call("list_children")).map((c: { name: string }) => c.name)).toEqual(["업무"]);
    await owner.write("업무/깨진.md", "[[없는것]]", null);
    expect((await call("lint")).issues[0].detail).toBe("Link [[없는것]] points to a missing or hidden document");
    await client.close();
    client = await mcp("ko");
    expect((await client.listTools()).tools.find((t) => t.name === "whoami")!.description).toBe("이 토큰의 에이전트 이름과 경로별 권한 표");
    expect((await call("lint")).issues[0].detail).toBe("링크 [[없는것]]의 대상이 없거나 볼 수 없음");
    await client.close();
  });
});

describe("트리 응답에 정렬·순서·수정 시각", () => {
  it("edited 가 있으면 그 시각, 없으면 서버 색인의 파일 시각. sort·rank 는 맞는 값만", async () => {
    const T = "2026-10-30T09:12:33Z";
    const files: Record<string, string> = {
      "업무.md": `---\nsort: custom\nedited: ${T}\n---\n업무`,
      "업무/가.md": "---\nrank: a0\n---\n가",
      "업무/나.md": "---\nsort: Custom\nrank: [a]\n---\n나",
    };
    // 쓰기 계층을 거치지 않고(앱 밖 변경처럼) 디스크에 두고 색인만 맞춘다
    await vault.batch([{ op: "write", path: "업무/빈.md", content: "", baseHash: null }], ownerPrincipal);
    for (const [rel, content] of Object.entries(files)) await writeFile(path.join(vault.root, rel), content);
    await index.refresh(vault.root, Object.keys(files));
    const tree = await owner.tree();
    const ws = tree.find((n) => n.path === "업무.md")!;
    expect(ws).toMatchObject({ sort: "custom", edited: Date.parse(T) });
    expect(ws.rank).toBeUndefined();
    const kids = tree.find((n) => n.path === "업무")!.children!;
    expect(kids.find((n) => n.path === "업무/가.md")).toMatchObject({ rank: "a0", edited: (await stat(path.join(vault.root, "업무/가.md"))).mtimeMs });
    const na = kids.find((n) => n.path === "업무/나.md")!;
    expect(na.sort).toBeUndefined();
    expect(na.rank).toBeUndefined();
    expect(na.edited).toBe((await stat(path.join(vault.root, "업무/나.md"))).mtimeMs);
    expect(tree.find((n) => n.path === "업무")!.edited).toBeUndefined();
  });
});

describe("서버의 수정 시각(edited)과 rank", () => {
  /** 앱(기기 토큰)으로 들어온 소유자 — 동기화가 올리는 쓰기 */
  const devicePrincipal = { kind: "owner" as const, name: "me", email: "me@test", device: "노트북" };
  const NOW = "2026-10-30T09:12:33Z";
  const fm = async (rel: string) => parseFrontmatter((await vault.read(rel)).content).data;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T09:12:33.500Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("소유자의 쓰기에는 지금 시각을 적고, 돌려준 내용·해시가 저장된 것이다", async () => {
    const r = await owner.write("업무/A.md", "# A\n", null);
    const disk = (await vault.read("업무/A.md")).content;
    expect(disk).toBe(`---\nedited: ${NOW}\n---\n# A\n`);
    expect(r.content).toBe(disk);
    expect(r.hash).toBe(hashContent(disk));
  });

  it("내용이 그대로인 노트에는 다시 적지 않는다 — 시각만 바뀐 커밋이 생기지 않는다", async () => {
    const first = await owner.write("업무/같음.md", "# 같음\n", null);
    await owner.write("업무/옆.md", "# 옆\n", null);
    const before = (await vault.git.log()).length;
    vi.setSystemTime(new Date("2026-10-30T09:20:00Z"));
    // 같은 내용을 다시 쓴다(웹 저장·REST write)
    const again = await owner.write("업무/같음.md", first.content, first.hash);
    expect(again.hash).toBe(first.hash);
    expect((await vault.git.log()).length).toBe(before);
    // 일괄 쓰기에서 안 바뀐 파일은 그대로, 바뀐 파일만 새 시각
    const side = await vault.read("업무/옆.md");
    await owner.batch([
      { op: "write", path: "업무/같음.md", content: first.content, baseHash: first.hash },
      { op: "write", path: "업무/옆.md", content: side.content.replace("# 옆", "# 옆 고침"), baseHash: side.hash },
    ]);
    expect((await vault.read("업무/같음.md")).content).toBe(first.content);
    expect(await fm("업무/옆.md")).toEqual({ edited: "2026-10-30T09:20:00Z" });
  });

  it("기기 토큰(동기화)의 쓰기는 보낸 내용 그대로 둔다", async () => {
    const device = new ScopedVault(vault, devicePrincipal, index, wiki);
    const sent = "---\nedited: 2026-01-01T00:00:00Z\n---\n기기에서 쓴 글\n";
    const r = await device.write("업무/B.md", sent, null);
    expect((await vault.read("업무/B.md")).content).toBe(sent);
    expect(r.hash).toBe(hashContent(sent));
    const plain = await device.write("업무/C.md", "시각 없는 글", null);
    expect(plain.content).toBe("시각 없는 글");
  });

  it("에이전트의 쓰기에도 적는다", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { 업무: "delete" }), index, wiki);
    await agent.write("업무/D.md", "에이전트 글", null);
    expect(await fm("업무/D.md")).toEqual({ edited: NOW });
  });

  it("이동으로 링크를 고친 노트들에도 적는다", async () => {
    const device = new ScopedVault(vault, devicePrincipal, index, wiki);
    await device.batch([
      { op: "write", path: "업무/옛.md", content: "옛", baseHash: null },
      { op: "write", path: "업무/참조.md", content: "[[옛]] 을 본다", baseHash: null },
    ]);
    const old = await vault.read("업무/옛.md");
    const r = await owner.move("업무/옛.md", "업무/새.md", old.hash);
    expect(r.linksUpdated).toContain("업무/참조.md");
    expect(await fm("업무/새.md")).toEqual({ edited: NOW });
    expect((await vault.read("업무/참조.md")).content).toBe(`---\nedited: ${NOW}\n---\n[[새]] 을 본다`);
  });

  it("다른 부모로 옮긴 노드는 노트의 rank 를 지우고, 같은 부모 안 이름 바꾸기는 남긴다 — 한 커밋으로", async () => {
    const device = new ScopedVault(vault, devicePrincipal, index, wiki);
    await device.batch([
      { op: "write", path: "업무/A.md", content: "---\nrank: V\nicon: 📁\n---\n에이", baseHash: null },
      { op: "write", path: "업무/A/b.md", content: "---\nrank: k\n---\n비", baseHash: null },
      { op: "write", path: "개인.md", content: "개인", baseHash: null },
    ]);
    await owner.moveNode("업무/A", "업무/B");
    expect(await fm("업무/B.md")).toEqual({ rank: "V", icon: "📁", edited: NOW });
    const before = (await vault.git.log()).length;
    const r = await owner.moveNode("업무/B", "개인/B");
    expect((await vault.git.log()).length).toBe(before + 1);
    expect(r.moved.map(([, t]) => t).sort()).toEqual(["개인/B.md", "개인/B/b.md"]);
    expect(await fm("개인/B.md")).toEqual({ icon: "📁", edited: NOW });
    // 함께 옮긴 하위 노트의 rank 는 새 부모(B) 안의 순서라 그대로다
    expect(await fm("개인/B/b.md")).toEqual({ rank: "k", edited: NOW });
  });

  it("BOM 으로 시작하는 노트는 BOM 을 지키고 프런트매터를 하나로 둔다", async () => {
    await owner.write("업무/bom.md", "\uFEFF---\ntitle: 제목\n---\n본문\n", null);
    expect((await vault.read("업무/bom.md")).content).toBe(`\uFEFF---\ntitle: 제목\nedited: ${NOW}\n---\n본문\n`);
  });

  it("사용자의 프런트매터 모양(들여쓰지 않은 목록·[a,b]·CRLF)은 그대로 두고 edited 한 줄만 더한다", async () => {
    await owner.write("업무/모양.md", "---\r\ntags:\r\n- a\r\ny: [a,b]\r\n---\r\n본문\r\n", null);
    expect((await vault.read("업무/모양.md")).content).toBe(`---\r\ntags:\r\n- a\r\ny: [a,b]\r\nedited: ${NOW}\r\n---\r\n본문\r\n`);
  });

  it("YAML 이 깨진 노트도 저장되고 내용은 그대로다", async () => {
    const broken = "---\na: [\n---\n본문";
    const r = await owner.write("업무/깨짐.md", broken, null);
    expect((await vault.read("업무/깨짐.md")).content).toBe(broken);
    expect(r.hash).toBe(hashContent(broken));
  });

  it("공통 설정 파일에는 적지 않는다", async () => {
    const s = await owner.read("keyring-settings.md").catch(() => null);
    const next = "---\nkeyring: settings\n---\n메모\n";
    await owner.write("keyring-settings.md", next, s?.hash ?? null);
    expect((await vault.read("keyring-settings.md")).content).toBe(next);
  });
});
