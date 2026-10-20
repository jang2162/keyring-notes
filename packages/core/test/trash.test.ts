import { describe, expect, it } from "vitest";
import { LocalVault, MemoryStore, NotFoundError, restoreTargets, trashHead } from "../src/index.js";

async function vault(files: Record<string, string> = {}) {
  const store = new MemoryStore();
  for (const [p, c] of Object.entries(files)) store.touch(p, c);
  const v = new LocalVault(store, { author: "노트북" });
  await v.open();
  return { store, v };
}

const text = async (v: LocalVault, p: string) => (await v.read(p)).content;

describe("휴지통 판정(core)", () => {
  it("머리: 노트 하나, 노드(노트+하위), 노트 없는 폴더 노드, 상관없는 여러 노트", () => {
    expect(trashHead(["W/a.md"], () => true)).toBe("W/a");
    expect(trashHead(["W/A.md", "W/A/b.md", "W/A/img.png"], () => true)).toBe("W/A");
    expect(trashHead(["W/A/b.md", "W/A/c.md"], (d) => d === "W/A")).toBe("W/A");
    // 폴더가 남아 있으면 그 폴더를 지운 것이 아니다
    expect(trashHead(["W/A/b.md", "W/A/c.md"], () => false)).toBeNull();
    expect(trashHead(["W/a.md", "X/b.md"], () => true)).toBeNull();
  });

  it('자리: 겹치지 않으면 그대로, 겹치면 노드째 " 2"(대소문자 무시), 노드가 없으면 파일마다', () => {
    expect([...restoreTargets(["W/a.md"], "W/a", ["W/b.md"])]).toEqual([["W/a.md", "W/a.md"]]);
    expect([...restoreTargets(["W/a.md"], "W/a", ["W/A.md"])]).toEqual([["W/a.md", "W/a 2.md"]]);
    // 노드 이름은 노트와 폴더가 모두 비어야 한다: "A 2/"가 있으면 "A 3"
    expect([...restoreTargets(["W/A.md", "W/A/b.md"], "W/A", ["W/A.md", "W/A 2/x.md"])]).toEqual([
      ["W/A.md", "W/A 3.md"],
      ["W/A/b.md", "W/A 3/b.md"],
    ]);
    expect([...restoreTargets(["W/a.md", "X/b.md", "X/c.png"], null, ["X/b.md", "X/c.png"])]).toEqual([
      ["W/a.md", "W/a.md"],
      ["X/b.md", "X/b 2.md"],
      ["X/c.png", "X/c 2.png"],
    ]);
  });
});

describe("휴지통(로컬 볼트: 기록 기반)", () => {
  it("지운 노트가 보이고, 미리보기는 지우기 직전 내용, 되살리면 원래 자리에 한 기록으로 생기고 목록에서 빠진다", async () => {
    const { v } = await vault({ "W.md": "", "W/a.md": "처음" });
    const a = await v.read("W/a.md");
    const b = await v.write("W/a.md", "지우기 직전", a.hash);
    await v.remove("W/a.md", b.hash);
    const page = v.trash();
    expect(page.next).toBeNull();
    expect(page.items).toHaveLength(1);
    const item = page.items[0];
    expect(item).toMatchObject({ node: "W/a", notes: ["W/a.md"], attachments: [], lost: 0, author: "노트북" });
    expect(await v.trashPreview(item.id, "W/a.md")).toBe("지우기 직전");
    const before = v.entries().length;
    expect(await v.restoreTrash(item.id)).toEqual({ restored: [["W/a.md", "W/a.md"]], lost: 0 });
    expect(await text(v, "W/a.md")).toBe("지우기 직전");
    expect(v.entries().length).toBe(before + 1);
    expect(v.entries().at(-1)!.message).toBe("Restore from trash: W/a");
    expect(v.trash().items).toEqual([]);
    await expect(v.restoreTrash(item.id)).rejects.toBeInstanceOf(NotFoundError);
    // 낡은 목록(다른 창)으로 한 번 더 눌러도 같은 내용이 이미 있으면 사본을 만들지 않는다
    await expect(v.restoreTrash(item.id, ["W/a.md"])).rejects.toBeInstanceOf(NotFoundError);
    expect(
      v
        .tree()
        .find((n) => n.name === "W")
        ?.children?.map((n) => n.name),
    ).toEqual(["a.md"]);
  });

  it("이동·이름 바꾸기로 사라진 옛 경로는 휴지통에 없다(빈 노트·노드 이동 포함)", async () => {
    const { v } = await vault({ "W.md": "", "W/빈.md": "", "W/글.md": "내용", "W/N.md": "노드", "W/N/c.md": "하위" });
    await v.move("W/빈.md", "W/빈2.md", (await v.read("W/빈.md")).hash);
    await v.move("W/글.md", "W/다른.md", (await v.read("W/글.md")).hash);
    await v.moveNode("W/N", "W/M");
    expect(v.trash().items).toEqual([]);
  });

  it("노드 삭제는 한 줄(머리 노드 + 하위), 첨부는 되살릴 수 없음으로 세고 마크다운만 통째로 되살린다", async () => {
    const { v, store } = await vault({ "W.md": "", "W/N.md": "노드", "W/N/c.md": "하위", "W/N/d/e.md": "손자" });
    await store.write("W/N/img.png", new Uint8Array([1, 2, 3]));
    await v.rescan();
    await v.deleteNode("W/N");
    const [item] = v.trash().items;
    expect(item).toMatchObject({ node: "W/N", notes: ["W/N.md", "W/N/c.md", "W/N/d/e.md"], lost: 1, attachments: [] });
    const r = await v.restoreTrash(item.id);
    expect(r.lost).toBe(1);
    expect(r.restored.map(([, to]) => to)).toEqual(["W/N.md", "W/N/c.md", "W/N/d/e.md"]);
    expect(await text(v, "W/N/d/e.md")).toBe("손자");
    expect(await store.read("W/N/img.png")).toBeNull();
  });

  it('같은 경로에 지금 노트가 있으면 보이지 않고, 사이에 생긴 자리는 덮어쓰지 않고 " 2" 로 만든다', async () => {
    const { v } = await vault({ "W.md": "", "W/a.md": "옛 글", "W/b.md": "비" });
    await v.remove("W/a.md", (await v.read("W/a.md")).hash);
    await v.remove("W/b.md", (await v.read("W/b.md")).hash);
    await v.write("W/b.md", "새 비", null);
    expect(v.trash().items.map((i) => i.notes)).toEqual([["W/a.md"]]);
    const id = v.trash().items[0].id;
    // 목록을 본 뒤 다른 창이 같은 이름(대소문자만 다름)으로 만들었다
    const other = new LocalVault(v.store, { author: "다른 창" });
    await other.open();
    await other.write("W/A.md", "다른 창의 새 글", null);
    expect(v.trash().items).toHaveLength(1);
    expect(await v.restoreTrash(id, ["W/a.md"])).toEqual({ restored: [["W/a.md", "W/a 2.md"]], lost: 0 });
    expect(await text(v, "W/a 2.md")).toBe("옛 글");
    expect(new TextDecoder().decode((await v.store.read("W/A.md"))!)).toBe("다른 창의 새 글");
    // 정확히 같은 경로가 생겨도 덮어쓰지 않는다
    const id2 = v.trash().items.find((i) => i.notes[0] === "W/a.md")?.id;
    expect(id2).toBeUndefined();
    const { v: w } = await vault({ "W.md": "", "W/c.md": "씨" });
    await w.remove("W/c.md", (await w.read("W/c.md")).hash);
    const cid = w.trash().items[0].id;
    await w.write("W/c.md", "새 씨", null);
    expect((await w.restoreTrash(cid, ["W/c.md"])).restored).toEqual([["W/c.md", "W/c 2.md"]]);
    expect(await text(w, "W/c.md")).toBe("새 씨");
    expect(await text(w, "W/c 2.md")).toBe("씨");
  });

  it("범위(워크스페이스)와 쪽 나누기: 최근 것부터, next 로 이어 읽는다", async () => {
    const files: Record<string, string> = { "W.md": "", "X.md": "", "X/x.md": "엑스" };
    for (let i = 0; i < 5; i++) files[`W/n${i}.md`] = `글 ${i}`;
    const { v } = await vault(files);
    for (let i = 0; i < 5; i++) await v.remove(`W/n${i}.md`, (await v.read(`W/n${i}.md`)).hash);
    await v.remove("X/x.md", (await v.read("X/x.md")).hash);
    expect(v.trash({ folder: "X" }).items.map((i) => i.notes[0])).toEqual(["X/x.md"]);
    const first = v.trash({ folder: "W", limit: 2 });
    expect(first.items.map((i) => i.notes[0])).toEqual(["W/n4.md", "W/n3.md"]);
    const second = v.trash({ folder: "W", limit: 2, cursor: first.next! });
    expect(second.items.map((i) => i.notes[0])).toEqual(["W/n2.md", "W/n1.md"]);
    const third = v.trash({ folder: "W", limit: 2, cursor: second.next! });
    expect(third.items.map((i) => i.notes[0])).toEqual(["W/n0.md"]);
    expect(third.next).toBeNull();
    expect(v.trash().items).toHaveLength(6);
  });

  it("공통 설정 파일은 휴지통에 넣지 않는다", async () => {
    const { v } = await vault({ "keyring-settings.md": "---\nkeyring: settings\n---\n" });
    await v.remove("keyring-settings.md", (await v.read("keyring-settings.md")).hash);
    expect(v.trash().items).toEqual([]);
  });
});
