import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpRemote, LocalVault, MemoryStore, pairDevice, sha256Hex, SyncEngine, withoutEdited } from "@keyring-notes/core";
import { createApp } from "../src/app.js";
import { BackupService } from "../src/backup.js";
import { ConfigStore } from "../src/config.js";
import { ScopedVault } from "../src/scoped.js";
import { hashContent } from "../src/vault.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let env: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const t = await tempDir("keyring-attach-manage-");
  cleanup = t.cleanup;
  const v = await openVault(path.join(t.dir, "vault"));
  const config = new ConfigStore(path.join(t.dir, "config", "keyring.json"));
  config.setPassword("correct horse");
  const backups = new BackupService(v.vault, config, path.join(t.dir, "backups"), () => v.wiki.resync());
  const app = createApp({ ...v, config, admin: { backups } });
  const owner = new ScopedVault(v.vault, ownerPrincipal, v.index, v.wiki);
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => app.request(String(url), init)) as typeof fetch;
  return { ...v, config, app, owner, fetchFn };
}

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  env.index.close();
  await cleanup();
});

const bytes = (...b: number[]) => new Uint8Array(b);
const h = (b: Uint8Array) => hashContent(Buffer.from(b));

describe("첨부 교체", { timeout: 20_000 }, () => {
  it("같은 경로에 내용만 바꾸고(링크 그대로), 옛 내용은 이력에 남는다. 내용 해시가 다르면 409", async () => {
    const { app, config, owner, vault } = env;
    await owner.batch([
      { op: "write", path: "W/글.md", content: "![[그림.png]]", baseHash: null },
      { op: "put", path: "W/그림.png", data: bytes(1, 2, 3) },
    ]);
    const { token } = config.issueDeviceToken("폰");
    const put = (p: string, body: Uint8Array, base: string, auth = token) =>
      app.request(`/api/attachment?path=${encodeURIComponent(p)}&baseHash=${base}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${auth}`, "content-type": "application/octet-stream", "x-keyring-upload": "1" },
        body: body as Uint8Array<ArrayBuffer>,
      });
    // 낡은 해시(다른 창·기기가 먼저 바꿈)는 거부하고 그대로 둔다
    let res = await put("W/그림.png", bytes(9), h(bytes(7)));
    expect(res.status).toBe(409);
    expect((await res.json()).currentHash).toBe(h(bytes(1, 2, 3)));
    res = await put("W/그림.png", bytes(4, 5), h(bytes(1, 2, 3)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ path: "W/그림.png", hash: h(bytes(4, 5)) });
    expect([...(await owner.readRaw("W/그림.png")).data]).toEqual([4, 5]);
    const [last] = await vault.git.log(undefined, 1);
    expect(last.message).toBe(vault.text().commit.replaceAttachment("W/그림.png"));
    // 옛 내용은 그 커밋의 부모에서 바이트 그대로
    const [old] = await vault.git.readMany([{ rev: `${last.rev}^`, path: "W/그림.png" }]);
    expect([...old!]).toEqual([1, 2, 3]);
    // 노트의 링크는 그대로이고 백링크도 그대로
    expect(withoutEdited((await owner.read("W/글.md")).content)).toBe("![[그림.png]]");
    expect((await owner.backlinks("W/그림.png")).map((b) => b.path)).toEqual(["W/글.md"]);
    // 없는 첨부는 404, 마크다운은 받지 않는다
    expect((await put("W/없음.png", bytes(1), h(bytes(1)))).status).toBe(404);
    expect((await put("W/글.md", bytes(1), h(bytes(1)))).status).toBe(400);
  });

  it("에이전트는 modify(write) 권한이 있어야 바꾼다 — append 는 새 파일만", async () => {
    const { vault, index, wiki, owner } = env;
    await owner.batch([
      { op: "put", path: "A/덧.png", data: bytes(1) },
      { op: "put", path: "B/쓰기.png", data: bytes(1) },
    ]);
    const bot = new ScopedVault(vault, agentPrincipal("bot", { A: "append", B: "write" }), index, wiki);
    await expect(bot.replaceAttachment("A/덧.png", bytes(2), h(bytes(1)))).rejects.toMatchObject({ code: "forbidden_append_only" });
    await expect(bot.replaceAttachment("B/쓰기.png", bytes(2), h(bytes(1)))).resolves.toMatchObject({ hash: h(bytes(2)) });
    expect([...(await owner.readRaw("A/덧.png")).data]).toEqual([1]);
  });
});

describe("첨부를 가리키는 노트(삭제 확인창)", { timeout: 20_000 }, () => {
  it("위키링크·임베드·상대 경로 마크다운 링크·이미지·출처를 세고, 코드 안·다른 파일은 세지 않는다. 숨긴 노트는 에이전트에게 안 보인다", async () => {
    const { owner, vault, index, wiki } = env;
    await owner.batch([
      { op: "put", path: "W/_첨부/그림 1.png", data: bytes(1) },
      { op: "put", path: "W/_첨부/다른.png", data: bytes(2) },
      { op: "write", path: "W/임베드.md", content: "![[그림 1.png]]", baseHash: null },
      { op: "write", path: "W/위키.md", content: "[[_첨부/그림 1.png|그림]]", baseHash: null },
      { op: "write", path: "W/sub/마크다운.md", content: "![x](../_첨부/그림%201.png)", baseHash: null },
      { op: "write", path: "W/출처.md", content: "---\nsources:\n  - W/_첨부/그림 1.png\n---\n본문", baseHash: null },
      { op: "write", path: "W/코드.md", content: "`![[그림 1.png]]`\n```\n![[그림 1.png]]\n```", baseHash: null },
      { op: "write", path: "W/딴것.md", content: "![[다른.png]]", baseHash: null },
      { op: "write", path: "비밀/숨김.md", content: "![[W/_첨부/그림 1.png]]", baseHash: null },
    ]);
    expect((await owner.backlinks("W/_첨부/그림 1.png")).map((b) => b.path)).toEqual([
      "W/sub/마크다운.md",
      "W/위키.md",
      "W/임베드.md",
      "W/출처.md",
      "비밀/숨김.md",
    ]);
    const bot = new ScopedVault(vault, agentPrincipal("bot", { W: "read" }), index, wiki);
    expect((await bot.backlinks("W/_첨부/그림 1.png")).map((b) => b.path)).not.toContain("비밀/숨김.md");
  });
});

describe("첨부 삭제 → 휴지통", { timeout: 20_000 }, () => {
  it("첨부만 지운 커밋도 휴지통에 한 줄로 보이고, 그림 바이트를 보이며, 되살리면 바이트 그대로 같은 자리에", async () => {
    const { owner, app, config } = env;
    await owner.batch([
      { op: "write", path: "W.md", content: "", baseHash: null },
      { op: "put", path: "W/files/그림.png", data: bytes(1, 2, 3) },
      { op: "put", path: "W/files/남김.png", data: bytes(8) },
    ]);
    await owner.delete("W/files/그림.png", h(bytes(1, 2, 3)));
    const page = await owner.trash({ folder: "W" });
    expect(page.items).toHaveLength(1);
    const [item] = page.items;
    expect(item).toMatchObject({ notes: [], attachments: ["W/files/그림.png"], lost: 0, node: null });
    const raw = await owner.trashRaw(item.id, "W/files/그림.png");
    expect([...raw.data]).toEqual([1, 2, 3]);
    // REST: 첨부 응답과 같은 머리(앱 출처에서 스크립트가 돌지 않게)
    const { token } = config.issueDeviceToken("폰");
    const res = await app.request(`/api/trash/raw?id=${item.id}&path=${encodeURIComponent("W/files/그림.png")}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    // 지우지 않은 파일·노트 경로는 미리보기로 내주지 않는다
    await expect(owner.trashRaw(item.id, "W/files/남김.png")).rejects.toThrow();
    const r = await owner.restoreTrash(item.id, []);
    expect(r.restored).toEqual([["W/files/그림.png", "W/files/그림.png"]]);
    expect([...(await owner.readRaw("W/files/그림.png")).data]).toEqual([1, 2, 3]);
    expect((await owner.trash({ folder: "W" })).items).toEqual([]);
  });

  it("되살릴 자리에 같은 이름이 생겼으면 덮어쓰지 않고 「 2」 로", async () => {
    const { owner } = env;
    await owner.batch([
      { op: "write", path: "W.md", content: "", baseHash: null },
      { op: "put", path: "W/a.png", data: bytes(1) },
    ]);
    await owner.delete("W/a.png", h(bytes(1)));
    const [item] = (await owner.trash()).items;
    // 같은 이름이 생기면 그 첨부는 지금 있는 것으로 보고 줄이 빠진다(노트와 같은 규칙)
    await owner.putAttachment("W/a.png", bytes(5));
    expect((await owner.trash()).items).toEqual([]);
    await expect(owner.restoreTrash(item.id, [])).rejects.toThrow();
    expect([...(await owner.readRaw("W/a.png")).data]).toEqual([5]);
  });

  it("노트가 든 삭제는 예전과 같다(노트가 모두 이미 있으면 줄이 없다)", async () => {
    const { owner } = env;
    await owner.batch([
      { op: "write", path: "W.md", content: "", baseHash: null },
      { op: "write", path: "W/n.md", content: "글", baseHash: null },
      { op: "put", path: "W/n/x.png", data: bytes(1) },
    ]);
    await owner.deleteNode("W/n");
    const [item] = (await owner.trash()).items;
    expect(item).toMatchObject({ node: "W/n", notes: ["W/n.md"], attachments: ["W/n/x.png"] });
    await owner.write("W/n.md", "다른 글", null);
    expect((await owner.trash()).items).toEqual([]);
  });
});

describe("기기 볼트 ↔ 서버: 기기에서 바꾼·지운 첨부", { timeout: 20_000 }, () => {
  const pair = async () => {
    const { fetchFn } = env;
    const paired = await pairDevice("http://localhost/", "correct horse", "노트북", fetchFn);
    const store = new MemoryStore();
    const local = new LocalVault(store, { author: "노트북" });
    await local.open();
    return { local, store, sync: new SyncEngine(local, new HttpRemote(paired.server, paired.token, fetchFn)) };
  };

  it("서버가 기준점 그대로면 기기에서 교체한 첨부를 같은 경로에 교체해 올린다(서버 이력에 옛 내용)", async () => {
    const { owner, vault } = env;
    await owner.batch([{ op: "put", path: "W/그림.png", data: bytes(1, 2) }]);
    const { local, sync } = await pair();
    expect((await sync.run()).pulled).toEqual(["W/그림.png"]);
    await local.replaceFile("W/그림.png", bytes(3, 4, 5), await sha256Hex(bytes(1, 2)));
    const r = await sync.run();
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.pushed).toEqual(["W/그림.png"]);
    expect([...(await owner.readRaw("W/그림.png")).data]).toEqual([3, 4, 5]);
    const [last] = await vault.git.log(undefined, 1);
    const [old] = await vault.git.readMany([{ rev: `${last.rev}^`, path: "W/그림.png" }]);
    expect([...old!]).toEqual([1, 2]);
    // 다음 동기화는 아무것도 하지 않는다(기준점이 새 해시)
    const again = await sync.run();
    expect([again.pushed, again.pulled, again.skipped]).toEqual([[], [], []]);
  });

  it("서버도 바뀌었으면 보내지 않고(skipped attachment-local) 서버 내용도 받지 않는다 — 어느 쪽도 덮지 않는다", async () => {
    const { owner } = env;
    await owner.batch([{ op: "put", path: "W/그림.png", data: bytes(1) }]);
    const { local, store, sync } = await pair();
    await sync.run();
    await local.replaceFile("W/그림.png", bytes(2), await sha256Hex(bytes(1)));
    await owner.replaceAttachment("W/그림.png", bytes(3), h(bytes(1)));
    const r = await sync.run();
    expect(r.pushed).toEqual([]);
    expect(r.skipped).toEqual([{ path: "W/그림.png", reason: "attachment-local" }]);
    expect([...(await owner.readRaw("W/그림.png")).data]).toEqual([3]);
    expect([...(await store.read("W/그림.png"))!]).toEqual([2]);
  });

  it("기기에서 지운 첨부는 서버가 그대로면 서버에서도 지우고 서버 휴지통에 남는다", async () => {
    const { owner } = env;
    await owner.batch([{ op: "put", path: "W/그림.png", data: bytes(1, 2) }]);
    const { local, sync } = await pair();
    await sync.run();
    await local.remove("W/그림.png", await sha256Hex(bytes(1, 2)));
    const r = await sync.run();
    expect(r.deletedRemote).toEqual(["W/그림.png"]);
    await expect(owner.readRaw("W/그림.png")).rejects.toThrow();
    const [item] = (await owner.trash()).items;
    expect(item).toMatchObject({ notes: [], attachments: ["W/그림.png"] });
  });
});
