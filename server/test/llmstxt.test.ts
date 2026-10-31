import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { mountWebApp } from "../src/webApp.js";
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

describe("앱 화면(web dist) 응답", () => {
  let web: { dir: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    web = await tempDir("keyring-webdist-");
    await mkdir(path.join(web.dir, "assets"));
    await writeFile(path.join(web.dir, "index.html"), "<!doctype html>app");
    await writeFile(path.join(web.dir, "assets", "index-a.js"), "export {};");
  });
  afterEach(() => web.cleanup());

  it("없는 /assets 파일은 index.html 이 아니라 404 — 서비스 워커가 HTML 을 조각으로 캐시하지 않게", async () => {
    const app = new Hono();
    mountWebApp(app, web.dir);
    const res = await app.request("/assets/gone-chunk-zz9.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("있는 /assets 파일은 그대로, 화면 경로는 여전히 index.html, /api 는 404", async () => {
    const app = new Hono();
    mountWebApp(app, web.dir);
    const asset = await app.request("/assets/index-a.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("export {};");
    for (const p of ["/", "/settings", "/Hello/Note"]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toBe("<!doctype html>app");
    }
    expect((await app.request("/api/nope")).status).toBe(404);
  });

  it("dist 가 없으면 아무것도 달지 않는다", async () => {
    const app = new Hono();
    expect(mountWebApp(app, path.join(web.dir, "missing"))).toBe(false);
    expect((await app.request("/")).status).toBe(404);
  });
});
