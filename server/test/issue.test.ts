import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { openVault, tempDir } from "./helpers.js";

let config: ConfigStore;
let cleanup: () => Promise<void>;

/** 던진 오류의 코드(PathError.code)와 인자 */
function failure(fn: () => unknown): { code: string; params?: Record<string, unknown> } {
  try {
    fn();
  } catch (e) {
    const err = e as { code: string; params?: Record<string, unknown> };
    return { code: err.code, params: err.params };
  }
  throw new Error("던지지 않았다");
}

beforeEach(async () => {
  const t = await tempDir("keyring-issue-");
  cleanup = t.cleanup;
  config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.issueToken("boss");
  config.setRules("boss", { 업무: "issue", "업무/비밀": "hidden" });
});

afterEach(() => cleanup());

describe("하위 토큰 발급", () => {
  it("createChild: 이름은 <발급자>-<뒷부분>", () => {
    const { name, token } = config.createChild("boss", "w1", { "업무/a": "write" });
    expect(name).toBe("boss-w1");
    const p = config.agentByToken(token);
    expect(p).toMatchObject({ kind: "agent", name: "boss-w1", issuedBy: "boss" });
    expect(config.get().agents.find((a) => a.name === "boss-w1")).toMatchObject({ issuedBy: "boss", rules: { "업무/a": "write" } });
    // 사람이 만든 에이전트의 Principal 에는 issuedBy 가 없다
    const bossToken = config.issueToken("boss");
    expect(config.agentByToken(bossToken)).not.toHaveProperty("issuedBy");
  });

  it("범위 밖·단계 초과면 아무것도 만들지 않는다", () => {
    const before = config.get().agents.length;
    expect(failure(() => config.createChild("boss", "w1", { "업무/a": "read", 개인: "read" }))).toMatchObject({
      code: "issue_scope",
      params: { path: "개인" },
    });
    expect(failure(() => config.createChild("boss", "w1", { "업무/a": "issue" }))).toMatchObject({ code: "issue_level", params: { path: "업무/a" } });
    expect(failure(() => config.createChild("boss", "w1", { "업무/비밀": "read" }))).toMatchObject({ code: "issue_level", params: { path: "업무/비밀" } });
    expect(config.get().agents.length).toBe(before);
  });

  it("이름 경계", () => {
    expect(failure(() => config.createChild("boss", "", { "업무/a": "read" })).code).toBe("agent_name");
    expect(failure(() => config.createChild("boss", "A b", { "업무/a": "read" })).code).toBe("agent_name");
    // "boss-" 5자 + 60자 = 65자
    expect(failure(() => config.createChild("boss", "x".repeat(60), { "업무/a": "read" })).code).toBe("agent_name");
    expect(config.createChild("boss", "x".repeat(59), { "업무/a": "read" }).name).toHaveLength(64);
    config.issueToken("boss-x");
    expect(failure(() => config.createChild("boss", "x", { "업무/a": "read" })).code).toBe("agent_exists");
    expect(config.get().agents.find((a) => a.name === "boss-x")?.issuedBy).toBeUndefined();
  });

  it("issue 없는 발급자·하위 토큰 발급자는 거부", () => {
    config.issueToken("plain");
    config.setRules("plain", { 업무: "delete" });
    expect(failure(() => config.createChild("plain", "w1", { "업무/a": "read" })).code).toBe("issue_scope");
    expect(failure(() => config.createChild("plain", "w1", {})).code).toBe("issue_scope");
    config.createChild("boss", "w1", { "업무/a": "read" });
    expect(failure(() => config.createChild("boss-w1", "w2", { "업무/a": "read" })).code).toBe("issue_scope");
    expect(failure(() => config.createChild("nobody", "w1", {})).code).toBe("agent_missing");
  });

  it("상한 50", () => {
    for (let i = 0; i < 50; i++) config.createChild("boss", `w${i}`, { "업무/a": "read" });
    expect(failure(() => config.createChild("boss", "w50", { "업무/a": "read" }))).toMatchObject({ code: "issue_limit", params: { limit: 50 } });
    expect(config.childrenOf("boss")).toHaveLength(50);
  });

  it("childrenOf 는 자기가 발급한 것만", () => {
    config.issueToken("other");
    config.setRules("other", { 업무: "issue" });
    config.createChild("boss", "w1", { "업무/a": "read" });
    config.createChild("other", "w1", { "업무/a": "read" });
    expect(config.childrenOf("boss").map((a) => a.name)).toEqual(["boss-w1"]);
  });

  it("남의 이름은 agent_missing", () => {
    config.issueToken("claude");
    config.issueToken("other");
    config.setRules("other", { 업무: "issue" });
    config.createChild("other", "1", { "업무/a": "read" });
    expect(failure(() => config.rotateChild("boss", "other-1"))).toMatchObject({ code: "agent_missing", params: { name: "other-1" } });
    expect(failure(() => config.removeChild("boss", "claude"))).toMatchObject({ code: "agent_missing", params: { name: "claude" } });
    expect(failure(() => config.removeChild("boss", "boss-none")).code).toBe("agent_missing");
    expect(config.get().agents.map((a) => a.name)).toEqual(expect.arrayContaining(["claude", "other-1"]));
  });

  it("rotateChild 는 이전 토큰을 바로 무효로 한다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    const next = config.rotateChild("boss", "boss-w1");
    expect(next).not.toBe(token);
    expect(config.agentByToken(token)).toBeNull();
    expect(config.agentByToken(next)).toMatchObject({ name: "boss-w1", issuedBy: "boss" });
  });

  it("removeChild 는 그 하위 토큰을 지운다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.removeChild("boss", "boss-w1");
    expect(config.agentByToken(token)).toBeNull();
    expect(config.childrenOf("boss")).toEqual([]);
  });

  it("발급자 삭제는 하위 토큰도 지운다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    expect(config.removeAgent("boss")).toEqual(["boss-w1"]);
    expect(config.agentByToken(token)).toBeNull();
    expect(config.get().agents.map((a) => a.name)).not.toContain("boss-w1");
    config.issueToken("solo");
    expect(config.removeAgent("solo")).toEqual([]);
  });

  it("발급자 재발급은 하위 토큰을 유지", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.issueToken("boss");
    expect(config.agentByToken(token)).toMatchObject({ name: "boss-w1" });
  });

  it("발급자 권한을 줄이면 다음 인증부터 줄어든다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "write" });
    const p = config.agentByToken(token);
    expect(p?.kind === "agent" && p.policy.level("업무/a/n.md")).toBe("write");
    config.setRule("boss", "업무", "read");
    const after = config.agentByToken(token);
    expect(after?.kind === "agent" && after.policy.level("업무/a/n.md")).toBe("read");
    expect(config.policyOf("boss-w1")?.level("업무/a/n.md")).toBe("read");
    expect(config.policyOf("boss-w1")?.toJSON()).toEqual({ "업무/a": "write" });
  });

  it("policyOf: 없는 에이전트는 null, 사람이 만든 에이전트는 자기 규칙", () => {
    expect(config.policyOf("nobody")).toBeNull();
    expect(config.policyOf("boss")?.level("업무/x.md")).toBe("issue");
  });

  it("하위 토큰에 issue 를 줄 수 없다", () => {
    config.createChild("boss", "w1", { "업무/a": "read" });
    expect(failure(() => config.setRule("boss-w1", "업무/a", "issue")).code).toBe("child_cannot_issue");
    expect(failure(() => config.setRules("boss-w1", { "업무/a": "issue" })).code).toBe("child_cannot_issue");
    // 소유자는 하위 토큰 규칙을 issue 아래로는 고칠 수 있다
    config.setRule("boss-w1", "업무/a", "delete");
    expect(config.get().agents.find((a) => a.name === "boss-w1")?.rules).toEqual({ "업무/a": "delete" });
  });

  it("설정 검증", () => {
    const base = config.get();
    const agent = (name: string, extra: Record<string, unknown>) => ({ name, tokenHash: "0".repeat(64), rules: {}, createdAt: "", ...extra });
    expect(
      failure(() =>
        config.replaceAll({
          ...base,
          agents: [agent("boss", { rules: { 업무: "issue" } }), agent("boss-a", { issuedBy: "boss" }), agent("boss-a-b", { issuedBy: "boss-a" })],
        }),
      ),
    ).toMatchObject({ code: "config.child_chain", params: { name: "boss-a-b" } });
    expect(
      failure(() =>
        config.replaceAll({ ...base, agents: [agent("boss", { rules: { 업무: "issue" } }), agent("boss-a", { issuedBy: "boss", rules: { 업무: "issue" } })] }),
      ),
    ).toMatchObject({ code: "config.child_issue", params: { name: "boss-a" } });
    // 설정이 바뀌지 않았다
    expect(config.get().agents.map((a) => a.name)).toEqual(["boss"]);

    // 발급자가 없는 하위 토큰은 검증을 통과하고 인증만 막힌다
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    const now = config.get();
    config.replaceAll({ ...now, agents: now.agents.filter((a) => a.name !== "boss") });
    expect(config.get().agents.map((a) => a.name)).toEqual(["boss-w1"]);
    expect(config.agentByToken(token)).toBeNull();
    expect(config.policyOf("boss-w1")).toBeNull();
  });

  it("발급자가 사라진 뒤 같은 이름을 새로 만들면 고아 하위 토큰은 지워진다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.agentByToken(token);
    expect(config.lastUsed.has("boss-w1")).toBe(true);
    const now = config.get();
    config.replaceAll({ ...now, agents: now.agents.filter((a) => a.name !== "boss") });
    config.issueToken("boss");
    expect(config.agentByToken(token)).toBeNull();
    expect(config.get().agents.map((a) => a.name)).toEqual(["boss"]);
    expect(config.lastUsed.has("boss-w1")).toBe(false);
  });

  it("발급자 재발급은 하위 토큰을 건드리지 않는다", () => {
    const { token } = config.createChild("boss", "w1", { "업무/a": "read" });
    config.issueToken("boss");
    expect(config.agentByToken(token)).not.toBeNull();
  });
});

describe("에이전트 표면: REST·MCP", () => {
  const json = { "content-type": "application/json" };
  let app: ReturnType<typeof createApp>;
  let bossToken = "";
  let cookie = "";
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeEach(async () => {
    const t = await tempDir("keyring-issue-app-");
    const prev = cleanup;
    cleanup = async () => {
      await prev();
      await t.cleanup();
    };
    const { vault, index, wiki, ingestor } = await openVault(path.join(t.dir, "vault"));
    await vault.batch(
      [
        { op: "write", path: "업무/a/n.md", content: "# n\n", baseHash: null },
        { op: "write", path: "업무/b.md", content: "# b\n", baseHash: null },
      ],
      { name: "me", email: "me@test" },
      { message: "seed" },
    );
    config.setPassword("correct horse");
    bossToken = config.issueToken("boss");
    app = createApp({
      vault,
      index,
      config,
      wiki,
      ingestor,
      admin: { publicUrl: "https://notes.example.com", backups: new BackupService(vault, config, path.join(t.dir, "backups"), () => wiki.resync()) },
    });
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
    cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  });

  async function connect(token: string) {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
        requestInit: { headers: bearer(token) },
        fetch: async (url, init) => app.request(String(url), init as RequestInit),
      }),
    );
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { error: res.isError === true, data: JSON.parse(res.content[0].text) };
    };
    return { client, call };
  }

  it("REST: 발급한 토큰은 범위 안에서만 동작하고, 목록·재발급·삭제는 자기 것만", async () => {
    const res = await app.request("/api/tokens", {
      method: "POST",
      headers: { ...json, ...bearer(bossToken) },
      body: JSON.stringify({ name: "w1", rules: { "업무/a": "read" } }),
    });
    expect(res.status).toBe(200);
    const issued = await res.json();
    expect(issued).toMatchObject({
      name: "boss-w1",
      mcp: { url: "https://notes.example.com/mcp", headers: { Authorization: `Bearer ${issued.token}` } },
    });
    const file = (p: string) => app.request(`/api/file?path=${encodeURIComponent(p)}`, { headers: bearer(issued.token) });
    expect((await file("업무/a/n.md")).status).toBe(200);
    expect((await file("업무/b.md")).status).toBe(404);
    expect(await (await app.request("/api/whoami", { headers: bearer(issued.token) })).json()).toMatchObject({ name: "boss-w1", issuedBy: "boss" });
    expect(await (await app.request("/api/whoami", { headers: bearer(bossToken) })).json()).not.toHaveProperty("issuedBy");

    const list = await (await app.request("/api/tokens", { headers: bearer(bossToken) })).json();
    expect(list).toEqual({ tokens: [{ name: "boss-w1", rules: { "업무/a": "read" }, createdAt: expect.any(String), lastUsed: expect.any(String) }] });

    const rotated = await (await app.request("/api/tokens/boss-w1/rotate", { method: "POST", headers: { ...json, ...bearer(bossToken) } })).json();
    expect(rotated).toMatchObject({ name: "boss-w1", mcp: { headers: { Authorization: `Bearer ${rotated.token}` } } });
    expect((await file("업무/a/n.md")).status).toBe(401);

    // 남의 이름은 없는 것과 같다
    config.issueToken("claude");
    expect((await app.request("/api/tokens/claude", { method: "DELETE", headers: { ...json, ...bearer(bossToken) } })).status).toBe(404);
    expect((await app.request("/api/tokens/claude/rotate", { method: "POST", headers: { ...json, ...bearer(bossToken) } })).status).toBe(404);
    expect(config.get().agents.map((a) => a.name)).toContain("claude");

    const del = await app.request("/api/tokens/boss-w1", { method: "DELETE", headers: { ...json, ...bearer(bossToken) } });
    expect(await del.json()).toEqual({ ok: true });
    expect(config.childrenOf("boss")).toEqual([]);
  });

  it("REST: 범위 밖은 400 issue_scope, 잘못된 본문은 400", async () => {
    const post = (body: unknown) => app.request("/api/tokens", { method: "POST", headers: { ...json, ...bearer(bossToken) }, body: JSON.stringify(body) });
    const scope = await post({ name: "w1", rules: { 개인: "read" } });
    expect(scope.status).toBe(400);
    expect(await scope.json()).toMatchObject({ code: "issue_scope" });
    expect(await (await post({ rules: {} })).json()).toMatchObject({ code: "field_required", params: { field: "name" } });
    expect(await (await post({ name: "w1", rules: null })).json()).toMatchObject({ code: "rules_invalid" });
    expect(await (await post({ name: "w1", rules: { "업무/a": "boss" } })).json()).toMatchObject({ code: "level_invalid" });
    expect(config.childrenOf("boss")).toEqual([]);
  });

  it("발급자의 issue 경로 아래에서 넓은 delete 를 받은 하위 토큰도 issue_token 은 거부된다", async () => {
    const { token } = config.createChild("boss", "w1", { 업무: "delete" });
    const before = config.get().agents.map((a) => a.name);
    const res = await app.request("/api/tokens", {
      method: "POST",
      headers: { ...json, ...bearer(token) },
      body: JSON.stringify({ name: "x", rules: { "업무/a": "read" } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "issue_scope" });
    const { client, call } = await connect(token);
    const r = await call("issue_token", { name: "x", rules: { "업무/a": "read" } });
    expect(r.error).toBe(true);
    await client.close();
    expect(config.get().agents.map((a) => a.name)).toEqual(before);
  });

  it("REST: 소유자(세션)는 403 issue_agent_only", async () => {
    const owner = { ...json, cookie };
    for (const [method, url] of [
      ["GET", "/api/tokens"],
      ["POST", "/api/tokens"],
      ["POST", "/api/tokens/boss-w1/rotate"],
      ["DELETE", "/api/tokens/boss-w1"],
    ]) {
      const res = await app.request(url, { method, headers: owner, body: method === "GET" ? undefined : JSON.stringify({ name: "w1", rules: {} }) });
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(await res.json()).toMatchObject({ code: "issue_agent_only" });
    }
    expect(config.childrenOf("boss")).toEqual([]);
  });

  it("MCP: issue_token·list_issued_tokens·rotate·revoke, whoami 에 issuedBy", async () => {
    const { client, call } = await connect(bossToken);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["issue_token", "list_issued_tokens", "rotate_issued_token", "revoke_issued_token"]));
    const issued = await call("issue_token", { name: "w1", rules: { "업무/a": "read" } });
    expect(issued).toMatchObject({ error: false, data: { name: "boss-w1", mcp: { url: "https://notes.example.com/mcp" } } });
    expect((await call("list_issued_tokens")).data).toEqual([{ name: "boss-w1", rules: { "업무/a": "read" }, createdAt: expect.any(String), lastUsed: null }]);
    expect(await call("issue_token", { name: "w2", rules: { 개인: "read" } })).toMatchObject({
      error: true,
      data: { error: "bad_request", code: "issue_scope" },
    });

    const child = await connect(issued.data.token);
    expect((await child.call("whoami")).data).toMatchObject({ name: "boss-w1", kind: "agent", issuedBy: "boss", rules: { "업무/a": "read" } });
    expect(await child.call("issue_token", { name: "x", rules: {} })).toMatchObject({ error: true, data: { code: "issue_scope" } });
    await child.client.close();

    const rotated = await call("rotate_issued_token", { name: "boss-w1" });
    expect(rotated.data.token).not.toBe(issued.data.token);
    expect(await call("revoke_issued_token", { name: "nobody" })).toMatchObject({ error: true, data: { error: "not_found", code: "agent_missing" } });
    expect(await call("revoke_issued_token", { name: "boss-w1" })).toMatchObject({ error: false, data: { ok: true } });
    expect((await call("list_issued_tokens")).data).toEqual([]);
    await client.close();
  });
});
