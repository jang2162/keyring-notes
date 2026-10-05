import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, LocalVault, MemoryStore, NotFoundError, sha256Hex, sha256Sync, utf8 } from "../src/index.js";

async function vault(files: Record<string, string> = {}) {
  const store = new MemoryStore();
  for (const [p, c] of Object.entries(files)) store.touch(p, c);
  const v = new LocalVault(store, { author: "노트북" });
  await v.open();
  return { store, v };
}

describe("해시", () => {
  it("순수 구현이 WebCrypto와 같다", async () => {
    for (const s of ["", "abc", "한글 문서\n", "x".repeat(1000)]) {
      expect(sha256Sync(utf8(s))).toBe(await sha256Hex(s));
    }
    expect(sha256Sync(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("로컬 볼트", () => {
  it("서버 없이 쓰기·읽기·검색·백링크·태그·위젯", async () => {
    const { v, store } = await vault({ "일기/첫날.md": "# 첫날\n\n#일상 오늘 [[계획]]을 세웠다.\n\n- [ ] 운동\n" });
    const plan = await v.write("계획.md", "---\nstatus: 진행\n---\n# 계획\n\n금리 공부\n", null);
    expect(plan.hash).toBe(await sha256Hex("---\nstatus: 진행\n---\n# 계획\n\n금리 공부\n"));
    expect(new TextDecoder().decode((await store.read("계획.md"))!)).toContain("금리 공부");
    expect(v.search("금리").map((h) => h.path)).toEqual(["계획.md"]);
    // 1~2글자 한글 단어도 찾는다
    expect(v.search("오늘").map((h) => h.path)).toEqual(["일기/첫날.md"]);
    expect(v.search("#일상").map((h) => h.path)).toEqual(["일기/첫날.md"]);
    expect(v.backlinks("계획.md")).toEqual([{ path: "일기/첫날.md", title: "첫날" }]);
    expect(v.tags()).toEqual([{ tag: "일상", count: 1 }]);
    const w = v.widget("type: table\nwhere: status = 진행\nshow: [status]");
    expect(w.type === "table" && w.rows.map((r) => r.path)).toEqual(["계획.md"]);
    const t = v.widget("type: tasks");
    expect(t.type === "tasks" && t.total).toBe(1);
    expect(v.tree().map((n) => n.name)).toEqual(["일기", "계획.md"]);
  });

  it("baseHash가 다르면 덮어쓰지 않는다", async () => {
    const { v } = await vault({ "a.md": "하나" });
    const a = await v.read("a.md");
    await v.write("a.md", "둘", a.hash);
    await expect(v.write("a.md", "셋", a.hash)).rejects.toBeInstanceOf(ConflictError);
    await expect(v.write("a.md", "새로", null)).rejects.toBeInstanceOf(ConflictError);
    await expect(v.read("없음.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await v.read("a.md")).content).toBe("둘");
  });

  it("이력: 처음 고칠 때 기존 내용을 남기고, 되돌릴 수 있다", async () => {
    const { v } = await vault({ "a.md": "원래" });
    const a = await v.read("a.md");
    const b = await v.write("a.md", "고침1", a.hash);
    const c = await v.write("a.md", "고침2", b.hash);
    const hist = v.history("a.md");
    expect(hist.map((h) => h.message)).toEqual(["수정: a.md", "수정: a.md", "기존 내용"]);
    expect(await v.revision("a.md", hist[2].rev)).toBe("원래");
    expect(await v.revision("a.md", hist[1].rev)).toBe("고침1");
    const r = await v.rollback("a.md", hist[2].rev, c.hash);
    expect(r.content).toBe("원래");
    await v.remove("a.md", r.hash);
    expect(await v.revision("a.md", v.history("a.md")[0].rev)).toBeNull();
  });

  it("이동하면 링크 대상이 바뀌고 이력이 이어진다", async () => {
    const { v } = await vault({ "a.md": "내용", "b.md": "[[a]]" });
    const a = await v.read("a.md");
    await v.move("a.md", "폴더/a2.md", a.hash);
    await expect(v.read("a.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await v.read("폴더/a2.md")).content).toBe("내용");
    expect(v.history("폴더/a2.md")[0].message).toContain("이동");
    expect(v.lint().issues.map((i) => i.kind)).toContain("broken_link");
  });

  it("앱 밖에서 바뀐 파일을 다시 읽고 기록한다", async () => {
    const { v, store } = await vault({ "a.md": "하나" });
    const a = await v.read("a.md");
    await v.write("a.md", "둘", a.hash);
    const seen: string[][] = [];
    v.onChange((p, src) => seen.push([src, ...p]));
    store.touch("a.md", "다른 편집기에서 고침");
    store.touch("새 문서.md", "새로");
    expect((await v.rescan()).sort()).toEqual(["a.md", "새 문서.md"]);
    expect((await v.read("a.md")).content).toBe("다른 편집기에서 고침");
    expect(v.history("a.md")[0].author).toBe("외부 변경");
    expect(seen[0][0]).toBe("external");
    // 다시 열어도 기록은 남는다
    const again = new LocalVault(store);
    await again.open();
    expect(again.history("a.md").map((h) => h.author)).toEqual(["외부 변경", "노트북", "노트북"]);
  });

  it("위키 토픽: index·log를 앱이 만들고 고칠 수 없다", async () => {
    const { v } = await vault({ "경제/raw/기사.md": "# 기사\n본문", "경제/wiki/index.md": "옛 파일" });
    await v.createTopic("경제");
    expect(v.topics().find((t) => t.name === "경제")).toMatchObject({ wiki: true, raw: 1, pages: 0 });
    const idx = await v.read("경제/wiki/index.md");
    expect(idx.generated).toBe(true);
    expect(idx.content).toContain("미반영 원본");
    expect(idx.content).toContain("[[경제/raw/기사|기사]]");
    await v.write("경제/wiki/금리.md", "---\nsources: ['[[경제/raw/기사]]']\n---\n# 금리\n", null);
    expect((await v.read("경제/wiki/index.md")).content).toContain("페이지 1개에서 인용");
    expect((await v.read("경제/wiki/log.md")).content).toContain("위키 토픽 만들기: 경제");
    await expect(v.write("경제/wiki/index.md", "x", idx.hash)).rejects.toBeInstanceOf(ForbiddenError);
    expect(v.search("옛").length).toBe(0);
    expect(v.graph().edges).toEqual([{ source: "경제/wiki/금리.md", target: "경제/raw/기사.md", kind: "source" }]);
  });

  it("할 일 체크", async () => {
    const { v } = await vault({ "t.md": "- [ ] 하나\n- [ ] 둘\n" });
    const d = await v.read("t.md");
    const r = await v.setTask("t.md", 2, true, d.hash);
    expect(r.content).toBe("- [ ] 하나\n- [x] 둘\n");
  });
});
