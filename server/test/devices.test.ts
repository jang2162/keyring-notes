import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpRemote, LocalVault, MemoryStore, pairDevice, SyncEngine } from "@keyring-notes/core";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { ScopedVault } from "../src/scoped.js";
import { hashContent } from "../src/vault.js";
import { openVault, ownerPrincipal, tempDir } from "./helpers.js";

const json = { "content-type": "application/json" };
let cleanup: () => Promise<void>;
let env: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = await tempDir("keyring-devices-");
  cleanup = t.cleanup;
  const v = await openVault(path.join(t.dir, "vault"));
  const config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  const backups = new BackupService(v.vault, config, path.join(t.dir, "backups"), () => v.wiki.resync());
  const app = createApp({ ...v, config, admin: { backups } });
  const owner = new ScopedVault(v.vault, ownerPrincipal, v.index, v.wiki);
  // 앱의 fetch를 서버 앱으로 바로 보낸다
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => app.request(String(url), init)) as typeof fetch;
  return { ...v, config, app, owner, fetchFn };
}

beforeEach(async () => {
  env = await setup();
});
afterEach(() => cleanup());

describe("기기 토큰", () => {
  it("비밀번호로 발급받아 소유자처럼 쓰지만 관리 콘솔·MCP는 못 쓴다", async () => {
    const { app, config, vault } = env;
    let res = await app.request("/api/auth/device", { method: "POST", headers: json, body: JSON.stringify({ password: "틀림", name: "노트북" }) });
    expect(res.status).toBe(401);
    res = await app.request("/api/auth/device", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse", name: "" }) });
    expect(res.status).toBe(400);
    const { token, id, name } = await (
      await app.request("/api/auth/device", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse", name: "노트북" }) })
    ).json();
    expect(token).toMatch(/^kd_/);
    expect(name).toBe("노트북");
    const auth = { authorization: `Bearer ${token}` };

    res = await app.request("/api/file", {
      method: "PUT",
      headers: { ...json, ...auth },
      body: JSON.stringify({ path: "앱에서.md", content: "글", baseHash: null }),
    });
    expect(res.status).toBe(200);
    expect((await vault.history("앱에서.md"))[0].author).toBe("me (노트북)");
    expect((await app.request("/api/admin/status", { headers: auth })).status).toBe(403);
    expect((await app.request("/mcp", { method: "POST", headers: { ...json, ...auth }, body: "{}" })).status).toBe(401);

    // 관리 콘솔(쿠키 로그인)에서 기기 목록·끊기
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
    const cookie = { cookie: login.headers.get("set-cookie")!.split(";")[0] };
    const list = await (await app.request("/api/admin/devices", { headers: cookie })).json();
    expect(list.devices).toMatchObject([{ id, name: "노트북" }]);
    expect(list.devices[0].lastUsed).not.toBeNull();
    expect((await app.request(`/api/admin/devices/${id}`, { method: "DELETE", headers: { ...json, ...cookie } })).status).toBe(200);
    expect((await app.request("/api/tree", { headers: auth })).status).toBe(401);
    expect(config.get().devices).toEqual([]);
  });

  it("CORS: 토큰 요청에만 응답을 연다", async () => {
    const { app, config } = env;
    const pre = await app.request("/api/sync/manifest", {
      method: "OPTIONS",
      headers: { origin: "tauri://localhost", "access-control-request-headers": "authorization" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    const { token } = config.issueDeviceToken("폰");
    const withToken = await app.request("/api/tree", { headers: { origin: "tauri://localhost", authorization: `Bearer ${token}` } });
    expect(withToken.headers.get("access-control-allow-origin")).toBe("*");
    const login = await app.request("/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse" }) });
    const withCookie = await app.request("/api/tree", { headers: { origin: "https://evil.example", cookie: login.headers.get("set-cookie")!.split(";")[0] } });
    expect(withCookie.status).toBe(200);
    expect(withCookie.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("동기화 목록: 모든 파일과 해시, 서버가 만드는 위키 index·log는 뺀다", async () => {
    const { app, config, owner } = env;
    await owner.createTopic("업무/경제");
    await owner.write("업무/경제/wiki/금리.md", "# 금리\n", null);
    await owner.batch([{ op: "put", path: "업무/경제/raw/assets/표.png", data: new Uint8Array([7, 8]) }]);
    const { token } = config.issueDeviceToken("폰");
    const res = await app.request("/api/sync/manifest", { headers: { authorization: `Bearer ${token}` } });
    const files = (await res.json()).files as { path: string; hash: string; size: number }[];
    expect(files.map((f) => f.path).sort()).toEqual(["업무/경제/SCHEMA.md", "업무/경제/raw/assets/표.png", "업무/경제/wiki/금리.md"]);
    expect(files.find((f) => f.path.endsWith(".png"))).toMatchObject({ hash: hashContent(Buffer.from([7, 8])), size: 2 });
    const agent = config.issueToken("bot");
    expect((await app.request("/api/sync/manifest", { headers: { authorization: `Bearer ${agent}` } })).status).toBe(403);
  });
});

describe("첨부 올리기 API", () => {
  it("새 파일만 만들고, 이미 있으면 409, 숨김 경로·권한 없는 에이전트는 막는다", async () => {
    const { app, config, owner } = env;
    const { token } = config.issueDeviceToken("폰");
    const up = (path: string, body: Uint8Array, auth = token, origin?: string) =>
      app.request(`/api/attachment?path=${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${auth}`, "content-type": "application/octet-stream", "x-keyring-upload": "1", ...(origin ? { origin } : {}) },
        body: body as Uint8Array<ArrayBuffer>,
      });
    let res = await up("노트/attachments/그림.png", new Uint8Array([1, 2, 3]), token, "tauri://localhost");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await owner.readRaw("노트/attachments/그림.png")).data.length).toBe(3);
    expect((await up("노트/attachments/그림.png", new Uint8Array([9]))).status).toBe(409);
    expect((await up("노트/.숨김/a.png", new Uint8Array([9]))).status).toBe(400);
    expect((await up("노트/글.md", new Uint8Array([9]))).status).toBe(400);
    const agent = config.issueToken("bot");
    config.setRules("bot", { 공개: "read" });
    expect((await up("공개/a.png", new Uint8Array([1]), agent)).status).toBe(403);
    // 헤더 없이 보내면(다른 사이트의 폼 전송) 받지 않는다
    const plain = await app.request(`/api/attachment?path=x.png`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
      body: new Uint8Array([1]) as Uint8Array<ArrayBuffer>,
    });
    expect(plain.status).toBe(415);
  });
});

describe("앱 ↔ 서버 동기화(실제 서버 API)", () => {
  it("기기 등록 → 양방향 동기화 → 충돌 사본", async () => {
    const { owner, fetchFn, vault } = env;
    await owner.createTopic("업무/경제");
    await owner.write("업무/경제/raw/기사.md", "# 기사\n본문\n", null);
    await owner.batch([{ op: "put", path: "업무/경제/raw/assets/표.png", data: new Uint8Array([1, 2]) }]);

    const paired = await pairDevice("http://localhost/", "correct horse", "노트북", fetchFn);
    expect(paired.server).toBe("http://localhost");
    const store = new MemoryStore();
    const local = new LocalVault(store, { author: "노트북" });
    await local.open();
    // 서버 없이 먼저 쓴 글
    await local.write("오프라인.md", "비행기에서 씀", null);
    const sync = new SyncEngine(local, new HttpRemote(paired.server, paired.token, fetchFn));

    let r = await sync.run();
    expect(r.errors).toEqual([]);
    expect(r.pushed).toEqual(["오프라인.md"]);
    expect(r.pulled.sort()).toEqual(["업무/경제/SCHEMA.md", "업무/경제/raw/assets/표.png", "업무/경제/raw/기사.md"]);
    expect((await owner.read("오프라인.md")).content).toBe("비행기에서 씀");
    expect((await vault.history("오프라인.md"))[0].author).toBe("me (노트북)");
    // 위키 index는 기기가 따로 만든다
    expect((await local.read("업무/경제/wiki/index.md")).content).toContain("[[업무/경제/raw/기사|기사]]");
    expect([...(await store.read("업무/경제/raw/assets/표.png"))!]).toEqual([1, 2]);

    // 양쪽에서 같은 문서를 다르게 고친다
    const srv = await owner.read("업무/경제/raw/기사.md");
    await owner.write("업무/경제/raw/기사.md", "# 기사\n서버에서 고침\n", srv.hash);
    const mine = await local.read("업무/경제/raw/기사.md");
    await local.write("업무/경제/raw/기사.md", "# 기사\n기기에서 고침\n", mine.hash);
    r = await sync.run();
    expect(r.conflicts).toHaveLength(1);
    expect((await local.read("업무/경제/raw/기사.md")).content).toContain("서버에서 고침");
    expect((await owner.read(r.conflicts[0].copy)).content).toContain("기기에서 고침");
    expect((await local.read(r.conflicts[0].copy)).content).toContain("기기에서 고침");

    // 이제 같다
    r = await sync.run();
    expect([r.pulled, r.pushed, r.conflicts, r.errors].flat()).toEqual([]);

    // 서로 다른 줄을 고치면 자동으로 합쳐 양쪽이 같아진다(서버 이력에 기기 이름으로 남는다)
    const doc = "# 할 일\n\n- 장보기\n\n- 운동\n";
    await local.write("할일.md", doc, null);
    await sync.run();
    const s1 = await owner.read("할일.md");
    await owner.write("할일.md", doc.replace("- 운동", "- 운동 30분"), s1.hash);
    const l1 = await local.read("할일.md");
    await local.write("할일.md", doc.replace("- 장보기", "- 장보기(우유)"), l1.hash);
    r = await sync.run();
    expect(r.merged).toEqual(["할일.md"]);
    const both = doc.replace("- 운동", "- 운동 30분").replace("- 장보기", "- 장보기(우유)");
    expect((await owner.read("할일.md")).content).toBe(both);
    expect((await local.read("할일.md")).content).toBe(both);
    expect((await vault.history("할일.md"))[0].author).toBe("me (노트북)");
  });
});
