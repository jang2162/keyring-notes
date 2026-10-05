import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let index: NoteIndex;
let app: ReturnType<typeof createApp>;
let cookie = "";
let token = "";
let owner: ScopedVault;
let agent: ScopedVault;

beforeEach(async () => {
  const t = await tempDir("keyring-plugins-");
  cleanup = t.cleanup;
  const v = await openVault(path.join(t.dir, "vault"));
  index = v.index;
  const pluginsDir = path.join(t.dir, "plugins");
  await mkdir(pluginsDir);
  await writeFile(path.join(pluginsDir, "kanban.js"), "export default { render(el) { el.textContent = 'ok'; } };");
  await writeFile(path.join(pluginsDir, "Bad Name.js"), "x");
  await writeFile(path.join(pluginsDir, "notes.txt"), "x");
  const config = new ConfigStore(path.join(t.dir, "config.json"));
  config.setPassword("correct horse");
  token = config.issueToken("a");
  config.setRules("a", { 업무: "read" });
  app = createApp({ ...v, config, admin: { backups: new BackupService(v.vault, config, path.join(t.dir, "b"), async () => undefined) }, pluginsDir });
  const login = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  owner = new ScopedVault(v.vault, ownerPrincipal, v.index, v.wiki);
  agent = new ScopedVault(v.vault, agentPrincipal("a", { 업무: "read" }), v.index, v.wiki);
  await owner.batch([
    { op: "write", path: "업무/a.md", content: "---\nstatus: todo\n---\n# A\n", baseHash: null },
    { op: "write", path: "업무/b.md", content: "---\nstatus: done\n---\n# B\n", baseHash: null },
    { op: "write", path: "개인/c.md", content: "---\nstatus: todo\n---\n# C\n", baseHash: null },
  ]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

describe("위젯 플러그인", () => {
  it("이름 규칙에 맞는 .js만 목록에 나오고, 모듈은 소유자 로그인으로만 받는다", async () => {
    expect((await (await app.request("/api/plugins", { headers: { cookie } })).json()).plugins).toEqual(["kanban"]);
    const ok = await app.request("/plugins/kanban.js", { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("javascript");
    expect(await ok.text()).toContain("render");
    expect((await app.request("/plugins/kanban.js")).status).toBe(401);
    expect((await app.request("/plugins/kanban.js", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    for (const bad of ["/plugins/..%2Fconfig.json", "/plugins/Bad%20Name.js", "/plugins/notes.txt", "/plugins/없음.js"]) {
      expect((await app.request(bad, { headers: { cookie } })).status, bad).toBe(404);
    }
  });

  it("type: plugin 위젯은 같은 쿼리(권한 포함)를 돌려 행과 options를 넘긴다", async () => {
    const r = await owner.widget("type: plugin\nplugin: kanban\nshow: [title, status]\noptions:\n  group: status\n  columns: [todo, done]");
    expect(r).toMatchObject({ type: "plugin", plugin: "kanban", options: { group: "status", columns: ["todo", "done"] }, columns: ["title", "status"], total: 3 });
    const a = await agent.widget("type: plugin\nplugin: kanban\nshow: [status]");
    if (a.type !== "plugin") throw new Error();
    expect(a.rows.map((x) => x.path)).toEqual(["업무/a.md", "업무/b.md"]);
    await expect(owner.widget("type: plugin")).rejects.toThrow(/plugin/);
    await expect(owner.widget("type: plugin\nplugin: ../x")).rejects.toThrow(/plugin/);
    await expect(owner.widget("type: plugin\nplugin: k\noptions: [1]")).rejects.toThrow(/options/);
  });
});
