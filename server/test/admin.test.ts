import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withoutEdited } from "@keyring-notes/core";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import type { NoteIndex } from "../src/noteindex.js";
import { ScopedVault } from "../src/scoped.js";
import type { Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { openVault, ownerPrincipal, tempDir } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let config: ConfigStore;
let backups: BackupService;
let owner: ScopedVault;

async function openServer(name: string) {
  const v = await openVault(path.join(root, name, "vault"));
  const cfg = new ConfigStore(path.join(root, name, "config", "keyring.json"));
  const b = new BackupService(v.vault, cfg, path.join(root, name, "backups"), () => v.wiki.resync());
  return { ...v, config: cfg, backups: b, owner: new ScopedVault(v.vault, ownerPrincipal, v.index, v.wiki) };
}

beforeEach(async () => {
  const t = await tempDir("keyring-admin-");
  root = t.dir;
  cleanup = t.cleanup;
  ({ vault, index, wiki, config, backups, owner } = await openServer("a"));
  config.setPassword("correct horse");
  await owner.createTopic("업무/경제");
  await owner.write("노트/a.md", "# A\n원래 내용\n", null);
  await owner.batch([{ op: "put", path: "노트/첨부.png", data: new Uint8Array([1, 2, 3]) }]);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

const git = (v: Vault, ...args: string[]) =>
  execFileSync("git", ["--git-dir", path.join(v.root, ".history"), "--work-tree", v.root, "-c", "core.quotePath=false", ...args], { encoding: "utf8" }).trim();

describe("백업", () => {
  it("git 번들 + manifest(+설정)를 .tar.gz 하나로 만든다", async () => {
    const b = await backups.create("manual");
    expect(b.name).toMatch(/^keyring-\d{8}-\d{6}-manual\.tar\.gz$/);
    expect(b).toMatchObject({ kind: "manual", head: git(vault, "rev-parse", "HEAD"), includesConfig: true });
    expect(((await stat(path.join(backups.dir, b.name))).mode & 0o777).toString(8)).toBe("600");
    const listed = execFileSync("tar", ["-tzf", path.join(backups.dir, b.name)], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(listed).toEqual(["config.json", "manifest.json", "vault.bundle"]);
    const noCfg = await backups.create("manual", { includeConfig: false });
    expect(noCfg.includesConfig).toBe(false);
    expect((await backups.list()).map((x) => x.name).sort()).toEqual([noCfg.name, b.name].sort());
  });

  it("백업 직전에 서버 밖에서 생긴 변경도 커밋해 넣는다", async () => {
    await writeFile(path.join(vault.root, "노트/밖에서.md"), "외부 편집\n");
    const b = await backups.create("manual");
    expect(git(vault, "show", `${b.head}:노트/밖에서.md`)).toBe("외부 편집");
  });

  it("복원: 파일·이력이 백업 시점으로 돌아가고, 복원 전 상태도 백업·ref로 남는다", async () => {
    const b = await backups.create("manual");
    const a = await owner.read("노트/a.md");
    await owner.write("노트/a.md", "# A\n바뀐 내용 zebra\n", a.hash);
    await owner.write("노트/새 문서.md", "# 새\n", null);
    await owner.batch([{ op: "write", path: "업무/경제/wiki/페이지.md", content: "# 페이지\n", baseHash: null }]);
    const changedHead = git(vault, "rev-parse", "HEAD");

    const r = await backups.restore(b.name);
    expect(r.restoredHead).toBe(b.head);
    expect(r.previousHead).toBe(changedHead);
    expect(git(vault, "rev-parse", "HEAD")).toBe(b.head);
    expect(withoutEdited((await owner.read("노트/a.md")).content)).toBe("# A\n원래 내용\n");
    await expect(owner.read("노트/새 문서.md")).rejects.toThrow(/없습니다/);
    expect(await readFile(path.join(vault.root, "노트/첨부.png"))).toEqual(Buffer.from([1, 2, 3]));
    expect(git(vault, "status", "--porcelain")).toBe("");
    // 인덱스·위키 목차도 맞춰진다
    expect(await owner.search("zebra")).toEqual([]);
    expect((await owner.read("업무/경제/wiki/index.md")).content).not.toContain("[[업무/경제/wiki/페이지");
    // 되돌리기: 복원 전 자동 백업과 ref
    expect(git(vault, "rev-parse", r.previousRef!)).toBe(changedHead);
    expect(r.preRestoreBackup).toMatch(/pre-restore/);
    await backups.restore(r.preRestoreBackup!);
    expect(withoutEdited((await owner.read("노트/a.md")).content)).toBe("# A\n바뀐 내용 zebra\n");
    expect((await owner.read("업무/경제/wiki/index.md")).content).toContain("[[업무/경제/wiki/페이지");
  });

  it("설정은 고른 경우에만 복원한다", async () => {
    const b = await backups.create("manual");
    config.issueToken("later-agent");
    await backups.restore(b.name);
    expect(config.get().agents.map((a) => a.name)).toEqual(["later-agent"]); // 설정은 그대로
    await backups.restore(b.name, { restoreConfig: true });
    expect(config.get().agents).toHaveLength(0);
  });

  it("다른 서버로 옮기기: 백업 파일을 새 서버에 넣고 복원하면 문서·이력·검색이 같다", async () => {
    const b = await backups.create("manual");
    const other = await openServer("b");
    try {
      const imported = await other.backups.importFile(path.join(backups.dir, b.name));
      const r = await other.backups.restore(imported.name, { restoreConfig: true });
      expect(r.preRestoreBackup).toBeNull(); // 빈 서버라 복원 전 백업은 없음
      expect(git(other.vault, "rev-parse", "HEAD")).toBe(b.head);
      expect(git(other.vault, "log", "--format=%an %s")).toBe(git(vault, "log", "--format=%an %s"));
      expect(withoutEdited((await other.owner.read("노트/a.md")).content)).toBe("# A\n원래 내용\n");
      expect((await other.owner.search("원래 내용")).map((h) => h.path)).toEqual(["노트/a.md"]);
      expect([...other.wiki.topics]).toEqual(["업무/경제"]);
      expect(other.config.checkPassword("correct horse")).toBe(true);
    } finally {
      other.index.close();
    }
  });

  it("백업 파일이 아니면 받지 않는다", async () => {
    const junk = path.join(root, "junk.tar.gz");
    await writeFile(junk, "not a tar");
    await expect(backups.importFile(junk)).rejects.toThrow(/백업 파일/);
    await expect(backups.restore("../../etc/passwd")).rejects.toThrow(/이름/);
  });

  it("자동 백업: 처음엔 만들고, 바뀐 게 없으면 건너뛰고, 간격이 지나면 다시, 개수는 keep까지", async () => {
    config.update((c) => {
      c.backup.keep = 2;
      c.backup.intervalHours = 1;
    });
    const first = await backups.runScheduled();
    expect(first?.kind).toBe("auto");
    expect(await backups.runScheduled()).toBeNull(); // 간격 안
    expect(await backups.runScheduled(Date.now() + 2 * 3600_000)).toBeNull(); // 간격은 지났지만 바뀐 게 없음
    for (let i = 0; i < 3; i++) {
      await owner.write(`노트/자동${i}.md`, `${i}`, null);
      await new Promise((r) => setTimeout(r, 1100)); // 이름의 초 단위가 겹치지 않게
      expect(await backups.runScheduled(Date.now() + (i + 3) * 3600_000)).not.toBeNull();
    }
    const autos = (await backups.list()).filter((b) => b.kind === "auto");
    expect(autos).toHaveLength(2);
    config.update((c) => {
      c.backup.enabled = false;
    });
    await owner.write("노트/꺼짐.md", "x", null);
    expect(await backups.runScheduled(Date.now() + 99 * 3600_000)).toBeNull();
  }, 20_000);
});

describe("관리 API·설치·보안", () => {
  const json = { "content-type": "application/json" };
  let app: ReturnType<typeof createApp>;
  let cookie = "";
  let setup: string | null = null;

  async function login(a = app, password = "correct horse") {
    const res = await a.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password }) });
    return res.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  beforeEach(async () => {
    app = createApp({
      vault,
      index,
      config,
      wiki,
      ingestor: undefined as never,
      admin: { backups, allowedHosts: ["notes.example.com"], updateUrl: "" },
      setupCode: () => setup,
    });
    cookie = await login();
  });

  it("에이전트 토큰으로는 관리 API를 쓸 수 없다", async () => {
    const token = config.issueToken("wiki-work");
    for (const [method, url] of [
      ["GET", "/api/admin/status"],
      ["GET", "/api/admin/agents"],
      ["POST", "/api/admin/backups"],
    ] as const) {
      const res = await app.request(url, { method, headers: { ...json, authorization: `Bearer ${token}` }, body: method === "POST" ? "{}" : undefined });
      expect(res.status, url).toBe(403);
    }
    expect((await app.request("/api/admin/status")).status).toBe(401);
  });

  it("상태: 버전·볼트·이력·백업·에이전트", async () => {
    const s = await (await app.request("/api/admin/status", { headers: { cookie } })).json();
    expect(s.app.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(s.vault).toMatchObject({ documents: expect.any(Number), wikiTopics: ["업무/경제"] });
    expect(s.history.commits).toBeGreaterThan(0);
    expect(s.backups).toMatchObject({ count: 0, settings: { enabled: true, intervalHours: 24, keep: 14 } });
    expect(s.disk.totalBytes).toBeGreaterThan(0);
    const u = await (await app.request("/api/admin/update", { headers: { cookie } })).json();
    expect(u).toMatchObject({ current: s.app.version, checked: false });
  });

  it("에이전트 만들기·권한 표 바꾸기·토큰 재발급·삭제", async () => {
    const created = await (
      await app.request("/api/admin/agents", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ name: "wiki-work" }) })
    ).json();
    expect(created.token).toMatch(/^kn_/);
    let res = await app.request("/api/admin/agents/wiki-work/rules", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({ rules: { "업무/경제/raw/": "append", "업무/경제/wiki": "delete", "/": "read" } }),
    });
    expect((await res.json()).rules).toEqual({ "업무/경제/raw": "append", "업무/경제/wiki": "delete", "/": "read" });
    res = await app.request("/api/admin/agents/wiki-work/rules", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({ rules: { "../x": "read" } }),
    });
    expect(res.status).toBe(400);
    res = await app.request("/api/admin/agents/wiki-work/rules", {
      method: "PUT",
      headers: { ...json, cookie },
      body: JSON.stringify({ rules: { "업무/경제": "admin" } }),
    });
    expect(res.status).toBe(400);
    // 새 토큰으로 바로 쓸 수 있고 마지막 사용 시각이 남는다
    expect((await app.request("/api/whoami", { headers: { authorization: `Bearer ${created.token}` } })).status).toBe(200);
    const agents = await (await app.request("/api/admin/agents", { headers: { cookie } })).json();
    expect(agents.agents[0].lastUsed).not.toBeNull();
    const rotated = await (await app.request("/api/admin/agents/wiki-work/rotate", { method: "POST", headers: { ...json, cookie }, body: "{}" })).json();
    expect((await app.request("/api/whoami", { headers: { authorization: `Bearer ${created.token}` } })).status).toBe(401);
    expect((await app.request("/api/whoami", { headers: { authorization: `Bearer ${rotated.token}` } })).status).toBe(200);
    expect((await app.request("/api/admin/agents/wiki-work", { method: "DELETE", headers: { ...json, cookie } })).status).toBe(200);
    expect((await app.request("/api/whoami", { headers: { authorization: `Bearer ${rotated.token}` } })).status).toBe(401);
  });

  it("비밀번호 변경: 지금 브라우저는 유지, 다른 세션은 끊김", async () => {
    const other = await login();
    const bad = await app.request("/api/admin/password", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ current: "wrong", next: "new password 1" }),
    });
    expect(bad.status).toBe(403);
    const res = await app.request("/api/admin/password", {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ current: "correct horse", next: "new password 1" }),
    });
    expect(res.status).toBe(200);
    const fresh = res.headers.get("set-cookie")!.split(";")[0];
    expect((await app.request("/api/tree", { headers: { cookie: fresh } })).status).toBe(200);
    expect((await app.request("/api/tree", { headers: { cookie: other } })).status).toBe(401);
  });

  it("백업 API: 만들기 → 내려받기 → 올리기 → 복원", async () => {
    const made = await (await app.request("/api/admin/backups", { method: "POST", headers: { ...json, cookie }, body: "{}" })).json();
    const dl = await app.request(`/api/admin/backups/${made.name}`, { headers: { cookie } });
    expect(dl.headers.get("content-disposition")).toContain(made.name);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    expect(bytes).toEqual(new Uint8Array(await readFile(path.join(backups.dir, made.name))));
    const noHeader = await app.request("/api/admin/backups/upload", { method: "POST", headers: { cookie, "content-type": "application/gzip" }, body: bytes });
    expect(noHeader.status).toBe(415);
    const up = await app.request("/api/admin/backups/upload", {
      method: "POST",
      headers: { cookie, "content-type": "application/gzip", "x-keyring-upload": "1" },
      body: bytes,
    });
    expect(up.status).toBe(200);
    const a = await owner.read("노트/a.md");
    await owner.write("노트/a.md", "바뀜", a.hash);
    const r = await app.request(`/api/admin/backups/${made.name}/restore`, { method: "POST", headers: { ...json, cookie }, body: "{}" });
    expect(r.status).toBe(200);
    expect(withoutEdited((await owner.read("노트/a.md")).content)).toBe("# A\n원래 내용\n");
    const settings = await app.request("/api/admin/backups/settings", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ keep: 0 }) });
    expect(settings.status).toBe(400);
  });

  it("처음 설치: 비밀번호가 없을 때만, 로그의 설정 코드로", async () => {
    const fresh = await openServer("c");
    try {
      setup = "ABCD-EF12-3456";
      const a2 = createApp({
        ...fresh,
        ingestor: undefined as never,
        admin: { backups: fresh.backups },
        setupCode: () => (fresh.config.get().owner.passwordHash ? null : setup),
      });
      let st = await (await a2.request("/api/auth/status")).json();
      expect(st.passwordSet).toBe(false);
      let res = await a2.request("/api/auth/setup", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ code: "WRONG-CODE-0000", password: "first password" }),
      });
      expect(res.status).toBe(401);
      res = await a2.request("/api/auth/setup", { method: "POST", headers: json, body: JSON.stringify({ code: "abcdef123456", password: "first password" }) });
      expect(res.status).toBe(200);
      const c2 = res.headers.get("set-cookie")!.split(";")[0];
      expect((await a2.request("/api/admin/status", { headers: { cookie: c2 } })).status).toBe(200);
      // 두 번째는 안 된다(이미 설정됨)
      res = await a2.request("/api/auth/setup", { method: "POST", headers: json, body: JSON.stringify({ code: "ABCD-EF12-3456", password: "take over!!" }) });
      expect(res.status).toBe(403);
      st = await (await a2.request("/api/auth/status")).json();
      expect(st.passwordSet).toBe(true);
    } finally {
      fresh.index.close();
      setup = null;
    }
  });

  it("허용 호스트·보안 헤더·헬스체크", async () => {
    const ok = await app.request("http://notes.example.com/api/health");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-frame-options")).toBe("DENY");
    expect(ok.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await app.request("http://evil.example.net/api/health")).status).toBe(421);
    expect((await app.request("http://localhost/api/health")).status).toBe(200);
    // 첨부는 자체 sandbox CSP를 유지한다
    const raw = await app.request("http://notes.example.com/api/raw?path=" + encodeURIComponent("노트/첨부.png"), { headers: { cookie } });
    expect(raw.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("HTTPS(프록시 뒤)면 로그인 쿠키에 Secure", async () => {
    const res = await app.request("http://notes.example.com/api/auth/login", {
      method: "POST",
      headers: { ...json, "x-forwarded-proto": "https" },
      body: JSON.stringify({ password: "correct horse" }),
    });
    expect(res.headers.get("set-cookie")).toMatch(/Secure/);
    const a3 = createApp({ vault, index, config, wiki, ingestor: undefined as never, admin: { backups, publicUrl: "https://notes.example.com" } });
    const res2 = await a3.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
    expect(res2.headers.get("set-cookie")).toMatch(/Secure/);
  });
});
