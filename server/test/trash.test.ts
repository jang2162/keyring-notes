import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlobStore } from "../src/blobs.js";
import type { NoteIndex } from "../src/noteindex.js";
import { S3Client } from "../src/s3.js";
import { ScopedVault } from "../src/scoped.js";
import { hashContent, type Vault } from "../src/vault.js";
import type { Wiki } from "../src/wiki.js";
import { startFakeS3 } from "./fakeS3.js";
import { agentPrincipal, openVault, ownerPrincipal, tempDir } from "./helpers.js";

let cleanup: () => Promise<void>;
let root: string;
let vault: Vault;
let index: NoteIndex;
let wiki: Wiki;
let owner: ScopedVault;

beforeEach(async () => {
  const t = await tempDir("keyring-trash-");
  cleanup = t.cleanup;
  root = t.dir;
  ({ vault, index, wiki } = await openVault(path.join(t.dir, "vault")));
  owner = new ScopedVault(vault, ownerPrincipal, index, wiki);
});

afterEach(async () => {
  index.close();
  await cleanup();
});

const make = async (files: Record<string, string>) => {
  for (const [p, content] of Object.entries(files)) await owner.write(p, content, null);
};
const hash = async (p: string) => (await owner.read(p)).hash;
const commits = async () => (await vault.git.log(undefined, 1000)).length;

describe("휴지통(서버: Git 이력 기반)", () => {
  it("지운 노트가 보이고(지운 사람·시각), 미리보기는 지우기 직전 내용, 되살리면 한 커밋으로 원래 자리에 생기고 목록에서 빠진다", async () => {
    await make({ "W.md": "", "W/a.md": "처음" });
    await owner.write("W/a.md", "지우기 직전", await hash("W/a.md"));
    await owner.delete("W/a.md", await hash("W/a.md"));
    const page = await owner.trash();
    expect(page.next).toBeNull();
    expect(page.items).toHaveLength(1);
    const item = page.items[0];
    expect(item).toMatchObject({ node: "W/a", notes: ["W/a.md"], attachments: [], lost: 0, author: "me" });
    expect(item.id).toMatch(/^[0-9a-f]{40}$/);
    expect(Date.parse(item.date)).toBeGreaterThan(0);
    expect(await owner.trashPreview(item.id, "W/a.md")).toEqual({ path: "W/a.md", content: "지우기 직전" });
    const before = await commits();
    const r = await owner.restoreTrash(item.id);
    expect(r.restored).toEqual([["W/a.md", "W/a.md"]]);
    expect(await commits()).toBe(before + 1);
    expect((await vault.git.log(undefined, 1))[0].message).toBe(vault.text().commit.restoreDeleted("W/a"));
    expect((await owner.read("W/a.md")).content).toBe("지우기 직전");
    expect((await owner.trash()).items).toEqual([]);
    await expect(owner.restoreTrash(item.id)).rejects.toThrow();
    // 낡은 목록으로 한 번 더 눌러도 같은 내용이 이미 있으면 사본을 만들지 않는다
    await expect(owner.restoreTrash(item.id, ["W/a.md"])).rejects.toThrow();
    expect((await owner.documents("W")).map((d) => d.path)).toEqual(["W/a.md"]);
  });

  it("이동·이름 바꾸기로 사라진 옛 경로는 휴지통에 없다(빈 노트, 링크를 고친 이동, 노드 이동)", async () => {
    await make({ "W.md": "", "W/빈.md": "", "W/글.md": "[[빈]] 이라는 링크", "W/N.md": "노드", "W/N/c.md": "하위", "W/N/d.md": "" });
    await owner.move("W/빈.md", "W/빈2.md", await hash("W/빈.md"));
    await owner.move("W/글.md", "W/다른.md", await hash("W/글.md"));
    await owner.moveNode("W/N", "W/M");
    expect((await owner.trash()).items).toEqual([]);
    // 노드를 옮기며 하위 노트 안의 전체 경로 링크가 고쳐져 내용이 바뀌어도 이동이다(git 의 비슷한 내용 짝짓기)
    const body = "하위 노트들 사이의 링크가 있는 꽤 긴 본문이다. ".repeat(4);
    await make({ "W/P.md": "", "W/P/x.md": `${body}\n[[W/P/y]]\n`, "W/P/y.md": `${body}\n[[W/P/x]]\n` });
    await owner.moveNode("W/P", "W/Q");
    expect((await owner.read("W/Q/x.md")).content).toContain("[[W/Q/y]]");
    expect((await owner.trash()).items).toEqual([]);
    // 이동한 뒤 새 자리에서 지우면 그 새 자리가 보인다
    await owner.delete("W/빈2.md", await hash("W/빈2.md"));
    expect((await owner.trash()).items.map((i) => i.notes)).toEqual([["W/빈2.md"]]);
  });

  it("노드 삭제는 한 줄(노드 + 하위), 첨부까지 바이트 그대로 한 커밋으로 되살린다", async () => {
    await make({ "W.md": "", "W/N.md": "노드", "W/N/c.md": "하위", "W/N/d/e.md": "손자" });
    const png = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]);
    await owner.putAttachment("W/N/img.png", png);
    await owner.deleteNode("W/N");
    const [item] = (await owner.trash()).items;
    expect(item).toMatchObject({ node: "W/N", notes: ["W/N.md", "W/N/c.md", "W/N/d/e.md"], attachments: ["W/N/img.png"], lost: 0 });
    const before = await commits();
    const r = await owner.restoreTrash(item.id, item.notes);
    expect(r.lost).toBe(0);
    expect(r.restored.map(([, to]) => to).sort()).toEqual(["W/N.md", "W/N/c.md", "W/N/d/e.md", "W/N/img.png"]);
    expect(await commits()).toBe(before + 1);
    expect(new Uint8Array(await readFile(path.join(vault.root, "W/N/img.png")))).toEqual(png);
    expect((await owner.read("W/N/d/e.md")).content).toBe("손자");
  });

  it('같은 경로에 지금 노트가 있으면 보이지 않고, 목록을 본 뒤 그 자리에 생긴 파일은 덮어쓰지 않고 " 2" 로 만든다(노드는 통째로)', async () => {
    await make({ "W.md": "", "W/a.md": "옛 글", "W/b.md": "비", "W/N.md": "노드", "W/N/c.md": "하위" });
    await owner.delete("W/a.md", await hash("W/a.md"));
    await owner.delete("W/b.md", await hash("W/b.md"));
    await owner.write("W/b.md", "새 비", null);
    expect((await owner.trash()).items.map((i) => i.notes)).toEqual([["W/a.md"]]);
    const id = (await owner.trash()).items[0].id;
    await owner.write("W/a.md", "그 사이 새 글", null);
    expect((await owner.restoreTrash(id, ["W/a.md"])).restored).toEqual([["W/a.md", "W/a 2.md"]]);
    expect((await owner.read("W/a.md")).content).toBe("그 사이 새 글");
    expect((await owner.read("W/a 2.md")).content).toBe("옛 글");

    await owner.deleteNode("W/N");
    const node = (await owner.trash()).items[0];
    await owner.write("W/N.md", "새 노드", null);
    const r = await owner.restoreTrash(node.id, node.notes);
    expect(r.restored).toEqual([
      ["W/N.md", "W/N 2.md"],
      ["W/N/c.md", "W/N 2/c.md"],
    ]);
    expect((await owner.read("W/N.md")).content).toBe("새 노드");
    expect((await owner.read("W/N 2/c.md")).content).toBe("하위");
  });

  it("범위(워크스페이스)와 쪽 나누기: 최근 것부터, next 로 이어 읽고 지금 있는 것만 지운 커밋은 건너뛴다", async () => {
    await make({ "W.md": "", "X.md": "", "X/x.md": "엑스" });
    for (let i = 0; i < 5; i++) await owner.write(`W/n${i}.md`, `글 ${i}`, null);
    for (let i = 0; i < 5; i++) await owner.delete(`W/n${i}.md`, await hash(`W/n${i}.md`));
    await owner.delete("X/x.md", await hash("X/x.md"));
    await owner.write("W/n3.md", "다시 만듦", null);
    expect((await owner.trash({ folder: "X" })).items.map((i) => i.notes[0])).toEqual(["X/x.md"]);
    const first = await owner.trash({ folder: "W", limit: 2 });
    expect(first.items.map((i) => i.notes[0])).toEqual(["W/n4.md", "W/n2.md"]);
    const second = await owner.trash({ folder: "W", limit: 2, cursor: first.next! });
    expect(second.items.map((i) => i.notes[0])).toEqual(["W/n1.md", "W/n0.md"]);
    expect(second.next).toBeNull();
    expect((await owner.trash()).items).toHaveLength(5);
  });

  it("공통 설정 파일·서버 밖에서 지운 파일·위키 자동 생성 문서", async () => {
    await make({ "W.md": "", "keyring-settings.md": "---\nkeyring: settings\n---\n", "W/밖.md": "밖에서 지움" });
    await owner.delete("keyring-settings.md", await hash("keyring-settings.md"));
    expect((await owner.trash()).items).toEqual([]);
    // 서버 밖(파인더 등)에서 지운 것도 흡수 커밋으로 이력에 남아 보인다(지운 사람: system)
    const { rm } = await import("node:fs/promises");
    await rm(path.join(vault.root, "W/밖.md"));
    await vault.absorbOutsideChanges();
    expect((await owner.trash()).items.map((i) => [i.notes, i.author])).toEqual([[["W/밖.md"], "system"]]);
    // 위키 토픽의 index·log 는 자동 생성 문서라 이력에도 없다
    await owner.createTopic("W/위키");
    expect((await owner.trash()).items.every((i) => i.notes.every((p) => !p.startsWith("W/위키/")))).toBe(true);
  });

  it("에이전트는 휴지통을 쓸 수 없다", async () => {
    const agent = new ScopedVault(vault, agentPrincipal("bot", { W: "delete" }), index, wiki);
    await expect(agent.trash()).rejects.toThrow();
    await expect(agent.restoreTrash("0".repeat(40))).rejects.toThrow();
  });
});

describe("휴지통: S3에 둔 첨부", () => {
  let fake: Awaited<ReturnType<typeof startFakeS3>>;
  beforeEach(async () => {
    fake = await startFakeS3();
  });
  afterEach(async () => {
    await fake.close();
  });

  async function s3Vault(withBlobs: boolean) {
    const v = await openVault(path.join(root, withBlobs ? "s3vault" : "s3vault-off"), { init: false });
    const blobs = new BlobStore(v.vault, new S3Client(fake.config), 10);
    await v.wiki.prepare();
    await blobs.attach();
    await v.vault.init();
    await v.wiki.init();
    const o = new ScopedVault(v.vault, ownerPrincipal, v.index, v.wiki);
    return { ...v, blobs, owner: o };
  }

  it("S3 보관 첨부는 목록 파일에서 찾아 받아 되살리고, S3를 끈 서버에서는 되살릴 수 없음으로 센다", async () => {
    const { vault: sv, owner: so, index: si } = await s3Vault(true);
    await so.write("W.md", "", null);
    await so.write("W/N.md", "노드", null);
    const big = new Uint8Array(64).map((_, i) => i);
    await so.putAttachment("W/N/big.bin", big);
    // 큰 첨부는 Git 에 없다(목록 파일에만)
    expect(await sv.git.show((await sv.git.head())!, "W/N/big.bin")).toBeNull();
    await so.deleteNode("W/N");
    const [item] = (await so.trash()).items;
    expect(item).toMatchObject({ node: "W/N", notes: ["W/N.md"], attachments: ["W/N/big.bin"], lost: 0 });

    // 같은 이력을 S3 없이 열면 받을 수 없다
    const before = sv.blobSource;
    sv.blobSource = null;
    expect((await so.trash()).items[0]).toMatchObject({ attachments: [], lost: 1 });
    sv.blobSource = before;

    const r = await so.restoreTrash(item.id, item.notes);
    expect(r.lost).toBe(0);
    expect(new Uint8Array(await readFile(path.join(sv.root, "W/N/big.bin")))).toEqual(big);
    expect(hashContent(Buffer.from(big))).toBe(hashContent(await readFile(path.join(sv.root, "W/N/big.bin"))));
    si.close();
  });
});

// 시험이 쓰는 보조 함수가 실제로 파일을 만든다(빈 노드 폴더 등)
describe("보조", () => {
  it("폴더만 있는 노드도 노드 한 줄로 보인다", async () => {
    await make({ "W.md": "", "W/F/a.md": "에이", "W/F/b.md": "비" });
    await mkdir(path.join(vault.root, "W/F"), { recursive: true });
    await writeFile(path.join(vault.root, "W/F/.keep"), "");
    await owner.deleteNode("W/F");
    expect((await owner.trash()).items[0]).toMatchObject({ node: "W/F", notes: ["W/F/a.md", "W/F/b.md"] });
  });
});
