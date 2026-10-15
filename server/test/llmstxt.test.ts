import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { openVault, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let make: (admin?: { publicUrl?: string; allowedHosts?: string[] }) => ReturnType<typeof createApp>;
let token = "";

beforeEach(async () => {
  const t = await tempDir("keyring-llms-");
  cleanup = t.cleanup;
  const { vault, index, wiki, ingestor } = await openVault(path.join(t.dir, "vault"));
  await vault.batch(
    [{ op: "write", path: "비밀노트.md", content: "# 비밀노트\n개인 내용\n", baseHash: null }],
    { name: "me", email: "me@test" },
    { message: "seed" },
  );
  const config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  token = config.issueToken("wiki-work");
  make = (admin = {}) =>
    createApp({
      vault,
      index,
      config,
      wiki,
      ingestor,
      admin: { backups: new BackupService(vault, config, path.join(vault.root, ".keyring", "backups"), () => wiki.resync()), ...admin },
    });
});
afterEach(() => cleanup());

describe("GET /llms.txt", () => {
  it("인증 없이 열리고 llms.txt 형식의 텍스트를 준다", async () => {
    const res = await make().request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.text();
    expect(body.startsWith("# Keyring Notes\n\n> ")).toBe(true);
    for (const h of ["## Connect", "## Permissions", "## Rules to follow", "## Docs"]) expect(body).toContain(h);
    expect(body).toContain("/mcp");
    expect(body).toContain("base_hash");
    expect(body).toContain("409");
  });

  it("볼트 내용·토큰·비밀번호 같은 이 서버의 상태를 담지 않는다", async () => {
    const body = await (await make().request("/llms.txt")).text();
    for (const secret of [token, "correct horse", "비밀노트", "wiki-work"]) expect(body).not.toContain(secret);
    expect(body).not.toMatch(/[0-9a-f]{64}/);
  });

  it("KEYRING_PUBLIC_URL 이 있으면 절대 주소로, 없으면 상대 경로로 적는다", async () => {
    expect(await (await make().request("/llms.txt")).text()).toContain("[MCP endpoint](/mcp)");
    const body = await (await make({ publicUrl: "https://notes.example.com" }).request("/llms.txt")).text();
    expect(body).toContain("[MCP endpoint](https://notes.example.com/mcp)");
    expect(body).toContain("[Health check](https://notes.example.com/api/health)");
  });

  it("허용 호스트 검사를 그대로 받는다", async () => {
    const app = make({ allowedHosts: ["notes.example.com"] });
    expect((await app.request("http://notes.example.com/llms.txt")).status).toBe(200);
    expect((await app.request("http://evil.example.net/llms.txt")).status).toBe(421);
  });

  it("앱 페이지의 SPA 대체 경로가 가로채지 않는다", async () => {
    // index.ts 와 같은 순서: createApp 뒤에 모든 GET 을 index.html 로 받는 경로를 단다
    const app = make();
    app.get("*", (c) => c.html("<!doctype html>spa"));
    const res = await app.request("/llms.txt");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toContain("# Keyring Notes");
  });
});
