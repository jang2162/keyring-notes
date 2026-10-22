import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import type { Ingestor } from "../src/ingest.js";
import type { NoteIndex } from "../src/noteindex.js";
import type { Wiki } from "../src/wiki.js";
import type { Vault } from "../src/vault.js";
import { openVault, tempDir } from "./helpers.js";

const json = { "content-type": "application/json" };

let cleanup: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let config: ConfigStore;
let vault: Vault;
let index: NoteIndex;
let cookie = "";
let wikiToken = "";
let workToken = "";

async function login(password = "correct horse") {
  const res = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password }) });
  const set = res.headers.get("set-cookie");
  return { res, cookie: set ? set.split(";")[0] : "" };
}

beforeEach(async () => {
  const t = await tempDir("keyring-api-");
  cleanup = t.cleanup;
  let wiki: Wiki;
  let ingestor: Ingestor;
  ({ vault, index, wiki, ingestor } = await openVault(path.join(t.dir, "vault")));
  config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  wikiToken = config.issueToken("wiki-work");
  config.setRule("wiki-work", "업무/경제/raw", "append");
  config.setRule("wiki-work", "업무/경제/wiki", "delete");
  workToken = config.issueToken("openclaw-work");
  config.setRule("openclaw-work", "업무", "read");
  app = createApp({
    vault,
    index,
    config,
    wiki,
    ingestor,
    admin: { backups: new BackupService(vault, config, path.join(vault.root, ".keyring", "backups"), () => wiki.resync()) },
  });
  cookie = (await login()).cookie;
  for (const [p, c] of Object.entries({
    "업무/경제/raw/기사.md": "# 기사\n원문\n",
    "업무/경제/wiki/금리.md": "# 금리\n\n## 배경\n배경 설명\n\n## 전망\n전망 설명\n",
    "개인/일기.md": "# 일기\n금리 걱정\n",
  })) {
    const r = await app.request("/api/file", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ path: p, content: c, baseHash: null }) });
    expect(r.status).toBe(200);
  }
});

afterEach(() => cleanup());

describe("인증", () => {
  it("로그인 없이는 401, 틀린 비밀번호도 401", async () => {
    expect((await app.request("/api/tree")).status).toBe(401);
    expect((await login("wrong password")).res.status).toBe(401);
    expect((await app.request("/api/tree", { headers: { authorization: "Bearer kn_nope" } })).status).toBe(401);
  });

  it("쿠키는 HttpOnly·SameSite=Strict, 상태 조회 가능", async () => {
    const { res } = await login();
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
    const st = await (await app.request("/api/auth/status", { headers: { cookie } })).json();
    expect(st).toMatchObject({ authenticated: true, principal: { kind: "owner" } });
  });

  it("비밀번호를 바꾸면 기존 세션이 끊긴다", async () => {
    config.setPassword("another password");
    expect((await app.request("/api/tree", { headers: { cookie } })).status).toBe(401);
  });

  it("토큰을 재발급하면 이전 토큰은 무효", async () => {
    config.issueToken("wiki-work");
    expect((await app.request("/api/tree", { headers: { authorization: `Bearer ${wikiToken}` } })).status).toBe(401);
  });

  it("JSON이 아닌 변경 요청은 거부(CSRF 방어)", async () => {
    const res = await app.request("/api/file", { method: "PUT", headers: { cookie }, body: "path=x.md&content=x" });
    expect(res.status).toBe(415);
  });
});

describe("REST + 에이전트 토큰", () => {
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  it("에이전트는 권한 표대로만 보고 쓴다", async () => {
    const tree = await (await app.request("/api/tree", { headers: as(workToken) })).json();
    expect(JSON.stringify(tree)).not.toContain("개인");
    expect((await app.request(`/api/file?path=${encodeURIComponent("개인/일기.md")}`, { headers: as(workToken) })).status).toBe(404);

    const read = await app.request(`/api/file?path=${encodeURIComponent("업무/경제/wiki/금리.md")}`, { headers: as(workToken) });
    const doc = await read.json();
    const put = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, ...as(workToken) },
      body: JSON.stringify({ path: doc.path, content: "바꿈", baseHash: doc.hash }),
    });
    expect(put.status).toBe(403);

    const append = await app.request("/api/append", {
      method: "POST",
      headers: { ...json, ...as(wikiToken) },
      body: JSON.stringify({ path: "업무/경제/raw/기사.md", content: "추가" }),
    });
    expect(append.status).toBe(200);
  });

  it("작성자 이름이 에이전트 이름으로 기록된다", async () => {
    await app.request("/api/batch", {
      method: "POST",
      headers: { ...json, ...as(wikiToken) },
      body: JSON.stringify({
        message: "기사 수집",
        operations: [
          { op: "append", path: "업무/경제/raw/기사.md", content: "더" },
          { op: "write", path: "업무/경제/wiki/기사 요약.md", content: "요약", baseHash: null },
        ],
      }),
    });
    const res = await app.request(`/api/history?path=${encodeURIComponent("업무/경제/wiki/기사 요약.md")}`, { headers: { cookie } });
    const { commits } = await res.json();
    expect(commits[0]).toMatchObject({ author: "wiki-work", message: "기사 수집" });
  });

  it("충돌은 409와 currentHash", async () => {
    const res = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({ path: "업무/경제/raw/기사.md", content: "x", baseHash: null }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).currentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("MCP", () => {
  async function connect(token: string) {
    const client = new Client({ name: "test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (url, init) => app.request(String(url), init as RequestInit),
    });
    await client.connect(transport);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { error: res.isError === true, data: JSON.parse(res.content[0].text) };
  }

  it("토큰 없이는 연결할 수 없다", async () => {
    const res = await app.request("/mcp", { method: "POST", headers: json, body: "{}" });
    expect(res.status).toBe(401);
    // 소유자 쿠키로도 MCP는 열리지 않는다
    expect((await app.request("/mcp", { method: "POST", headers: { ...json, cookie }, body: "{}" })).status).toBe(401);
  });

  it("도구 목록과 권한 확인", async () => {
    const client = await connect(wikiToken);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        "append_document",
        "batch_write",
        "delete_document",
        "list_documents",
        "list_frontmatter",
        "move_document",
        "read_document",
        "read_outline",
        "read_section",
        "search",
        "backlinks",
        "unlinked_mentions",
        "list_tags",
        "query",
        "list_topics",
        "list_children",
        "ingest_url",
        "ingest_text",
        "my_proposals",
        "sources",
        "lint",
        "semantic_search",
        "whoami",
        "write_document",
      ].sort(),
    );
    const me = await call(client, "whoami");
    expect(me.data).toMatchObject({ name: "wiki-work", rules: { "업무/경제/raw": "append", "업무/경제/wiki": "delete" } });
    await client.close();
  });

  it("개요 → 섹션 단위 읽기", async () => {
    const client = await connect(workToken);
    const outline = await call(client, "read_outline", { path: "업무/경제/wiki/금리.md" });
    expect(outline.data.headings.map((x: { text: string }) => x.text)).toEqual(["금리", "배경", "전망"]);
    const sec = await call(client, "read_section", { path: "업무/경제/wiki/금리.md", heading: "금리 > 전망" });
    expect(sec.data.content).toBe("## 전망\n전망 설명\n");
    await client.close();
  });

  it("숨김·읽기 전용·추가 전용이 MCP에서도 막힌다", async () => {
    const work = await connect(workToken);
    const hidden = await call(work, "read_document", { path: "개인/일기.md" });
    expect(hidden).toMatchObject({ error: true, data: { error: "not_found" } });
    const search = await call(work, "search", { query: "금리" });
    expect(search.data.map((x: { path: string }) => x.path)).toEqual(["업무/경제/wiki/금리.md"]);
    const doc = await call(work, "read_document", { path: "업무/경제/wiki/금리.md" });
    const ro = await call(work, "write_document", { path: "업무/경제/wiki/금리.md", content: "x", base_hash: doc.data.hash });
    expect(ro).toMatchObject({ error: true, data: { error: "forbidden" } });
    await work.close();

    const wiki = await connect(wikiToken);
    const raw = await call(wiki, "read_document", { path: "업무/경제/raw/기사.md" });
    const overwrite = await call(wiki, "write_document", { path: "업무/경제/raw/기사.md", content: "왜곡", base_hash: raw.data.hash });
    expect(overwrite).toMatchObject({ error: true, data: { error: "forbidden" } });
    const appended = await call(wiki, "append_document", { path: "업무/경제/raw/기사.md", content: "메모" });
    expect(appended.error).toBe(false);
    const del = await call(wiki, "delete_document", { path: "업무/경제/raw/기사.md", base_hash: appended.data.hash });
    expect(del).toMatchObject({ error: true, data: { error: "forbidden" } });
    await wiki.close();
  });

  it("query·backlinks·list_tags도 권한 표를 따른다", async () => {
    const r = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({ path: "개인/일기2.md", content: "---\nstatus: todo\n---\n[[금리]] #비밀\n- [ ] 비밀 할 일\n", baseHash: null }),
    });
    expect(r.status).toBe(200);
    const work = await connect(workToken);
    const q = await call(work, "query", { spec: "type: table\nwhere: status\nshow: [title, status]" });
    expect(q.error).toBe(false);
    expect(q.data.rows.map((x: { path: string }) => x.path)).not.toContain("개인/일기2.md");
    const tasks = await call(work, "query", { spec: "type: tasks\nstatus: all" });
    expect(JSON.stringify(tasks.data)).not.toContain("비밀");
    const bl = await call(work, "backlinks", { path: "업무/경제/wiki/금리.md" });
    expect(bl.data).toEqual([]);
    const tags = await call(work, "list_tags");
    expect(JSON.stringify(tags.data)).not.toContain("비밀");
    // 소유자 REST로는 보인다
    const owner = await (await app.request(`/api/backlinks?path=${encodeURIComponent("업무/경제/wiki/금리.md")}`, { headers: { cookie } })).json();
    expect(owner.backlinks.map((x: { path: string }) => x.path)).toEqual(["개인/일기2.md"]);
    await work.close();
  });

  it("batch_write는 한 커밋, 실패 시 전체 취소", async () => {
    const wiki = await connect(wikiToken);
    const page = await call(wiki, "read_document", { path: "업무/경제/wiki/금리.md" });
    const before = (await vault.git.log()).length;

    const bad = await call(wiki, "batch_write", {
      operations: [
        { op: "write", path: "업무/경제/wiki/새 페이지.md", content: "새", base_hash: null },
        { op: "write", path: "업무/경제/wiki/금리.md", content: "수정", base_hash: "0".repeat(64) },
      ],
    });
    expect(bad).toMatchObject({ error: true, data: { error: "conflict" } });
    expect((await vault.git.log()).length).toBe(before);

    const ok = await call(wiki, "batch_write", {
      message: "금리 페이지 정리",
      operations: [
        { op: "write", path: "업무/경제/wiki/새 페이지.md", content: "새", base_hash: null },
        { op: "write", path: "업무/경제/wiki/금리.md", content: page.data.content + "\n추가", base_hash: page.data.hash },
        { op: "append", path: "업무/경제/raw/기사.md", content: "출처 확인함" },
      ],
    });
    expect(ok.error).toBe(false);
    expect(ok.data.files).toHaveLength(3);
    const log = await vault.git.log();
    expect(log.length).toBe(before + 1);
    expect(log[0]).toMatchObject({ author: "wiki-work", message: "금리 페이지 정리" });
    await wiki.close();
  });
});

describe("검색 API", () => {
  const get = async (params: URLSearchParams, headers: Record<string, string>) => {
    const res = await app.request(`/api/search?${params}`, { headers });
    expect(res.status).toBe(200);
    return (await res.json()).hits as { path: string; matches?: { line: number }[]; matchCount?: number }[];
  };

  it("tag 를 여러 번 주면 모두 가진 문서, lines 면 일치 줄들", async () => {
    for (const [p, c] of Object.entries({ "업무/a.md": "# a\n금리 걱정 1\n금리 걱정 2\n#x #y", "업무/b.md": "# b\n금리 걱정 #x" })) {
      const r = await app.request("/api/file", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ path: p, content: c, baseHash: null }) });
      expect(r.status).toBe(200);
    }
    const params = new URLSearchParams({ q: "금리 걱정", folder: "업무", lines: "5" });
    params.append("tag", "x");
    expect((await get(params, { cookie })).map((h) => h.path).sort()).toEqual(["업무/a.md", "업무/b.md"]);
    params.append("tag", "y");
    const hits = await get(params, { cookie });
    expect(hits.map((h) => h.path)).toEqual(["업무/a.md"]);
    expect(hits[0].matches?.map((m) => m.line)).toEqual([2, 3]);
    expect(hits[0].matchCount).toBe(2);
  });

  it("lines 가 0 이상의 정수가 아니면 400 bad_request, 빈 값은 안 준 것", async () => {
    for (const lines of ["1e3", "2.9", "-1", "abc", " 3", "0x5"]) {
      const res = await app.request(`/api/search?q=${encodeURIComponent("금리")}&lines=${encodeURIComponent(lines)}`, { headers: { cookie } });
      expect(res.status, lines).toBe(400);
      expect(await res.json(), lines).toMatchObject({ error: "bad_request", code: "integer_required", params: { field: "lines" } });
    }
    for (const lines of ["", "0", "7", "999"]) {
      const res = await app.request(`/api/search?q=${encodeURIComponent("금리")}&lines=${lines}`, { headers: { cookie } });
      expect(res.status, lines).toBe(200);
    }
  });

  it("에이전트: 숨긴 폴더·태그를 필터로 줘도 응답이 없는 폴더·태그와 같다", async () => {
    const r = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({ path: "개인/비밀.md", content: "# 비밀\n금리 #개인태그", baseHash: null }),
    });
    expect(r.status).toBe(200);
    const agent = { authorization: `Bearer ${workToken}` };
    const hidden = await (
      await app.request(`/api/search?q=${encodeURIComponent("금리")}&folder=${encodeURIComponent("개인")}&lines=5`, { headers: agent })
    ).text();
    const missing = await (
      await app.request(`/api/search?q=${encodeURIComponent("금리")}&folder=${encodeURIComponent("없음")}&lines=5`, { headers: agent })
    ).text();
    expect(hidden).toBe(missing);
    expect(JSON.parse(hidden)).toEqual({ hits: [] });
    const tag = await app.request(`/api/search?q=&tag=${encodeURIComponent("개인태그")}`, { headers: agent });
    expect(await tag.json()).toEqual({ hits: [] });
    const all = await (await app.request(`/api/search?q=${encodeURIComponent("금리")}&lines=50`, { headers: agent })).text();
    expect(all).not.toContain("개인");
  });
});

describe("휴지통 API", () => {
  it("소유자: 목록·미리보기·되살리기, 에이전트 토큰은 403", async () => {
    const doc = await (await app.request(`/api/file?path=${encodeURIComponent("개인/일기.md")}`, { headers: { cookie } })).json();
    const del = await app.request("/api/file", {
      method: "DELETE",
      headers: { ...json, cookie },
      body: JSON.stringify({ path: "개인/일기.md", baseHash: doc.hash }),
    });
    expect(del.status).toBe(200);
    const list = await (await app.request("/api/trash?folder=%EA%B0%9C%EC%9D%B8", { headers: { cookie } })).json();
    expect(list.items.map((i: { notes: string[] }) => i.notes)).toEqual([["개인/일기.md"]]);
    expect(list.next).toBeNull();
    const id = list.items[0].id;
    const pv = await (await app.request(`/api/trash/preview?id=${id}&path=${encodeURIComponent("개인/일기.md")}`, { headers: { cookie } })).json();
    expect(pv.content).toBe("# 일기\n금리 걱정\n");
    const agent = await app.request("/api/trash", { headers: { authorization: `Bearer ${workToken}` } });
    expect(agent.status).toBe(403);
    const r = await app.request("/api/trash/restore", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ id, paths: ["개인/일기.md"] }) });
    expect(r.status).toBe(200);
    expect((await r.json()).restored).toEqual([["개인/일기.md", "개인/일기.md"]]);
    expect((await (await app.request("/api/trash", { headers: { cookie } })).json()).items).toEqual([]);
  });
});
