import { describe, expect, it } from "vitest";
import { ConflictError, LocalVault, MemoryStore, NotFoundError, SyncEngine } from "../src/index.js";
import { FakeServer } from "./fakeServer.js";

async function device(name = "폰") {
  const store = new MemoryStore();
  const v = new LocalVault(store, { author: name });
  await v.open();
  return { store, v };
}

async function content(v: LocalVault, p: string) {
  return (await v.read(p)).content;
}

describe("동기화", () => {
  it("처음 연결: 서버 문서는 받고 기기 문서는 보낸다", async () => {
    const server = new FakeServer();
    await server.put("서버.md", "서버에서 쓴 글");
    await server.put("그림.png", new Uint8Array([1, 2, 3]));
    const { v, store } = await device();
    await v.write("기기.md", "오프라인에서 쓴 글", null);
    const r = await new SyncEngine(v, server).run();
    expect(r.pulled.sort()).toEqual(["그림.png", "서버.md"]);
    expect(r.pushed).toEqual(["기기.md"]);
    expect(await content(v, "서버.md")).toBe("서버에서 쓴 글");
    expect([...(await store.read("그림.png"))!]).toEqual([1, 2, 3]);
    expect(server.text("기기.md")).toBe("오프라인에서 쓴 글");
    // 다시 돌리면 할 일이 없다
    const again = await new SyncEngine(v, server).run();
    expect([again.pulled, again.pushed, again.conflicts, again.errors].flat()).toEqual([]);
  });

  it("한쪽만 바뀌면 그쪽을 반영하고, 삭제도 전한다", async () => {
    const server = new FakeServer();
    await server.put("a.md", "1");
    await server.put("b.md", "b");
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    await server.put("a.md", "2 (서버)");
    const b = await v.read("b.md");
    await v.remove("b.md", b.hash);
    const r = await sync.run();
    expect(r.pulled).toEqual(["a.md"]);
    expect(r.deletedRemote).toEqual(["b.md"]);
    expect(await content(v, "a.md")).toBe("2 (서버)");
    expect(server.files.has("b.md")).toBe(false);
    server.files.delete("a.md");
    expect((await sync.run()).deletedLocal).toEqual(["a.md"]);
    await expect(v.read("a.md")).rejects.toBeInstanceOf(NotFoundError);
    // 동기화로 받은 변경도 이력에 남는다
    expect(v.history("a.md").map((h) => h.author)).toContain("sync");
  });

  it("양쪽이 다르게 바뀌면 덮어쓰지 않고 충돌 사본을 만든다", async () => {
    const server = new FakeServer();
    await server.put("메모.md", "원래");
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    const d = await v.read("메모.md");
    await v.write("메모.md", "기기에서 고침", d.hash);
    await server.put("메모.md", "서버에서 고침");
    const r = await sync.run();
    expect(r.conflicts).toHaveLength(1);
    const copy = r.conflicts[0].copy;
    expect(copy).toMatch(/^메모 \(sync conflict copy \d{8}-\d{4}\)\.md$/);
    expect(await content(v, "메모.md")).toBe("서버에서 고침");
    expect(await content(v, copy)).toBe("기기에서 고침");
    expect(server.text(copy)).toBe("기기에서 고침");
    expect(server.text("메모.md")).toBe("서버에서 고침");
    const again = await sync.run();
    expect([again.pulled, again.pushed, again.conflicts].flat()).toEqual([]);
  });

  it("양쪽이 서로 다른 곳을 고쳤으면 자동으로 합친다", async () => {
    const doc = "# 메모\n\n## 아침\n운동\n\n## 저녁\n독서\n";
    const server = new FakeServer();
    await server.put("메모.md", doc);
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    await v.write("메모.md", doc.replace("운동", "운동 30분"), (await v.read("메모.md")).hash);
    await server.put("메모.md", doc.replace("독서", "독서 1시간"));
    const r = await sync.run();
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toEqual(["메모.md"]);
    const merged = doc.replace("운동", "운동 30분").replace("독서", "독서 1시간");
    expect(await content(v, "메모.md")).toBe(merged);
    expect(server.text("메모.md")).toBe(merged);
    expect(v.history("메모.md")[0].message).toContain("merged automatically");
    // 그 뒤로는 같다
    const again = await sync.run();
    expect([again.pulled, again.pushed, again.merged, again.conflicts].flat()).toEqual([]);
  });

  it("서버에서 받은 적 없는(처음부터 양쪽에 있던) 문서도 다음부터는 합친다", async () => {
    const doc = "a\nb\nc\nd\ne\n";
    const server = new FakeServer();
    await server.put("x.md", doc);
    const { v, store } = await device();
    store.touch("x.md", doc); // 같은 내용이 기기에도 이미 있다(예: 폴더를 복사해 옴)
    await v.rescan();
    const sync = new SyncEngine(v, server);
    await sync.run();
    await v.write("x.md", doc.replace("a", "A"), (await v.read("x.md")).hash);
    await server.put("x.md", doc.replace("e", "E"));
    expect((await sync.run()).merged).toEqual(["x.md"]);
    expect(await content(v, "x.md")).toBe("A\nb\nc\nd\nE\n");
  });

  it("처음 연결했는데 양쪽 내용이 다르면(기준점 없음) 합치지 않고 사본", async () => {
    const server = new FakeServer();
    await server.put("y.md", "서버\n");
    const { v } = await device();
    await v.write("y.md", "기기\n", null);
    const r = await new SyncEngine(v, server).run();
    expect(r.merged).toEqual([]);
    expect(r.conflicts).toHaveLength(1);
  });

  it("지운 쪽과 고친 쪽이 갈리면 고친 쪽을 살린다", async () => {
    const server = new FakeServer();
    await server.put("x.md", "x");
    await server.put("y.md", "y");
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    // x: 기기에서 지우고 서버에서 고침 → 서버 것을 살림
    await v.remove("x.md", (await v.read("x.md")).hash);
    await server.put("x.md", "x 서버 수정");
    // y: 서버에서 지우고 기기에서 고침 → 기기 것을 다시 올림
    await v.write("y.md", "y 기기 수정", (await v.read("y.md")).hash);
    server.files.delete("y.md");
    const r = await sync.run();
    expect(await content(v, "x.md")).toBe("x 서버 수정");
    expect(server.text("y.md")).toBe("y 기기 수정");
    expect(r.conflicts).toEqual([]);
  });

  it("보내는 순간 서버가 바뀌었으면(409) 충돌로 처리한다", async () => {
    const server = new FakeServer();
    await server.put("a.md", "1");
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    await v.write("a.md", "기기", (await v.read("a.md")).hash);
    // 목록을 받은 뒤 쓰기 직전에 다른 기기가 고친다
    const orig = server.manifest.bind(server);
    server.manifest = async () => {
      const m = await orig();
      await server.put("a.md", "다른 기기");
      return m;
    };
    const r = await sync.run();
    expect(r.conflicts.map((c) => c.path)).toEqual(["a.md"]);
    expect(server.text("a.md")).toBe("다른 기기");
    expect(await content(v, r.conflicts[0].copy)).toBe("기기");
  });

  it("오프라인이면 아무것도 잃지 않고 멈춘다", async () => {
    const server = new FakeServer();
    const { v } = await device();
    await v.write("a.md", "글", null);
    server.offline = true;
    await expect(new SyncEngine(v, server).run()).rejects.toBeInstanceOf(TypeError);
    server.offline = false;
    expect((await new SyncEngine(v, server).run()).pushed).toEqual(["a.md"]);
  });

  it("두 기기가 서버를 거쳐 같은 내용이 된다", async () => {
    const server = new FakeServer();
    const a = await device("노트북");
    const b = await device("폰");
    const sa = new SyncEngine(a.v, server);
    const sb = new SyncEngine(b.v, server);
    await a.v.write("공유.md", "노트북에서 시작", null);
    await sa.run();
    await sb.run();
    await b.v.write("공유.md", "폰에서 이어 씀", (await b.v.read("공유.md")).hash);
    await sb.run();
    await sa.run();
    expect(await content(a.v, "공유.md")).toBe("폰에서 이어 씀");
  });

  it("기기에서 새로 만든 첨부(붙여넣은 이미지)는 올린다", async () => {
    const server = new FakeServer();
    const { v } = await device();
    await v.putFile("노트/attachments/그림.png", new Uint8Array([5, 6]));
    await v.write("노트/글.md", "![[그림.png]]", null);
    const r = await new SyncEngine(v, server).run();
    expect(r.pushed.sort()).toEqual(["노트/attachments/그림.png", "노트/글.md"]);
    expect([...(server.files.get("노트/attachments/그림.png")!.content as Uint8Array)]).toEqual([5, 6]);
    const again = await new SyncEngine(v, server).run();
    expect([again.pushed, again.pulled, again.skipped].flat()).toEqual([]);
    await expect(v.putFile("노트/attachments/그림.png", new Uint8Array([1]))).rejects.toBeInstanceOf(ConflictError);
  });

  it("기기에서 바뀐 첨부는 보내지 않고 알린다", async () => {
    const server = new FakeServer();
    await server.put("img.png", new Uint8Array([1]));
    const { v, store } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    store.files.set("img.png", { data: new Uint8Array([9]), mtime: Date.now() });
    const r = await sync.run();
    expect(r.skipped.map((s) => s.path)).toEqual(["img.png"]);
    expect([...(server.files.get("img.png")!.content as Uint8Array)]).toEqual([1]);
  });

  it("기기에서 첨부가 든 폴더를 옮기면 새 자리는 올리고 원래 자리는 서버에서도 지운다", async () => {
    const server = new FakeServer();
    await server.put("노트/글.md", "![[그림.png]] [링크](그림.png)");
    await server.put("노트/그림.png", new Uint8Array([7, 8]));
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    const r = await v.moveNode("노트", "보관/노트");
    expect(r.moved.map(([, t]) => t).sort()).toEqual(["보관/노트/그림.png", "보관/노트/글.md"]);
    // 한 기록(첨부는 기록에 남지 않는다)
    expect(v.entries().at(-1)!.message).toBe("Move node: 노트 → 보관/노트");
    const s = await sync.run();
    expect(s.deletedRemote.sort()).toEqual(["노트/그림.png", "노트/글.md"]);
    expect([...server.files.keys()].sort()).toEqual(["보관/노트/그림.png", "보관/노트/글.md"]);
    expect(server.text("보관/노트/글.md")).toBe("![[그림.png]] [링크](그림.png)");
    const again = await sync.run();
    expect([again.pushed, again.pulled, again.deletedLocal, again.deletedRemote, again.skipped].flat()).toEqual([]);
  });

  it("기기에서 지운 첨부라도 그 사이 서버에서 바뀌었으면 서버 것을 받는다", async () => {
    const server = new FakeServer();
    await server.put("img.png", new Uint8Array([1]));
    const { v, store } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    await store.remove("img.png");
    await v.rescan();
    await server.put("img.png", new Uint8Array([2]));
    const r = await sync.run();
    expect(r.pulled).toEqual(["img.png"]);
    expect([...(await v.readBytes("img.png"))]).toEqual([2]);
  });

  it("공통 설정 파일은 충돌 사본 없이 키 단위로 합친다(양쪽이 다르게 바꾼 키는 서버 값, 기기 값은 알림)", async () => {
    const server = new FakeServer();
    const base = "---\nkeyring: settings\nvault:\n  language: ko\nui:\n  theme: light\n  editorSize: 16\n---\n# 설정\n";
    await server.put("keyring-settings.md", base);
    const { v } = await device();
    const sync = new SyncEngine(v, server);
    await sync.run();
    // 기기: 테마·글꼴 크기, 서버: 테마·줄 번호
    const mine = await v.read("keyring-settings.md");
    await v.write("keyring-settings.md", mine.content.replace("theme: light", "theme: dark").replace("editorSize: 16", "editorSize: 18"), mine.hash);
    await server.put("keyring-settings.md", base.replace("theme: light", "theme: system").replace("editorSize: 16", "editorSize: 16\n  lineNumbers: true"));
    const r = await sync.run();
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toEqual(["keyring-settings.md"]);
    expect(r.settingsConflicts).toEqual([{ key: ["ui", "theme"], local: "dark", server: "system" }]);
    const merged = server.text("keyring-settings.md")!;
    expect(merged).toContain("theme: system");
    expect(merged).toContain("editorSize: 18");
    expect(merged).toContain("lineNumbers: true");
    expect(merged).toContain("# 설정");
    expect(await content(v, "keyring-settings.md")).toBe(merged);
    expect([...server.files.keys()].filter((p) => p.includes("사본") || p.includes("copy"))).toEqual([]);
  });

  it("처음 연결해 기준점이 없어도 설정 파일은 키 단위로 합친다", async () => {
    const server = new FakeServer();
    await server.put("keyring-settings.md", "---\nkeyring: settings\nui:\n  theme: dark\n---\n");
    const { v } = await device();
    await v.write("keyring-settings.md", "---\nkeyring: settings\nui:\n  theme: light\n  live: false\n---\n", null);
    const r = await new SyncEngine(v, server).run();
    expect(r.conflicts).toEqual([]);
    expect(r.settingsConflicts).toEqual([{ key: ["ui", "theme"], local: "light", server: "dark" }]);
    expect(server.text("keyring-settings.md")).toBe("---\nkeyring: settings\nui:\n  theme: dark\n  live: false\n---\n");
  });
});
