import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, LocalVault, MemoryStore, NotFoundError, sha256Hex, sha256Sync, utf8 } from "../src/index.js";

const KO_SETTINGS = "---\nkeyring: settings\nvault:\n  language: ko\n---\n";

/** 볼트 언어는 한국어(커밋 메시지·위키 목차가 한국어) */
async function vault(files: Record<string, string> = {}) {
  const store = new MemoryStore();
  store.touch("keyring-settings.md", KO_SETTINGS);
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
    expect(v.tree().map((n) => n.name)).toEqual(["일기", "계획.md", "keyring-settings.md"]);
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

  it("이동하면 이력이 이어지고, 링크 갱신을 끄면 링크가 깨진다", async () => {
    const { v } = await vault({ "a.md": "내용", "b.md": "[[a]]" });
    const a = await v.read("a.md");
    const r = await v.move("a.md", "폴더/a2.md", a.hash, { updateLinks: false });
    expect(r.linksUpdated).toEqual([]);
    await expect(v.read("a.md")).rejects.toBeInstanceOf(NotFoundError);
    expect((await v.read("폴더/a2.md")).content).toBe("내용");
    expect(v.history("폴더/a2.md")[0].message).toContain("이동");
    expect(v.lint().issues.map((i) => i.kind)).toContain("broken_link");
  });

  it("이동하면 링크를 같은 기록 안에서 함께 고친다", async () => {
    const { v } = await vault({
      "업무/계획.md": "# 계획\n[회의](회의록.md)",
      "업무/회의록.md": "# 회의록",
      "노트.md": "---\nsources: ['[[계획]]']\n---\n[[계획#일정|일정]] 그리고 [본문](업무/계획.md)",
      "무관.md": "[[회의록]]",
    });
    const a = await v.read("업무/계획.md");
    const r = await v.move("업무/계획.md", "보관/2026 계획.md", a.hash);
    expect(r.linksUpdated.sort()).toEqual(["노트.md", "보관/2026 계획.md"]);
    expect(r.linkCount).toBe(4);
    expect(r.content).toBe("# 계획\n[회의](../업무/회의록.md)");
    expect((await v.read("노트.md")).content).toBe("---\nsources: ['[[2026 계획]]']\n---\n[[2026 계획#일정|일정]] 그리고 [본문](보관/2026%20계획.md)");
    expect(v.lint().issues.filter((i) => i.kind === "broken_link")).toEqual([]);
    // 한 기록으로 남는다
    const entry = v.entries().at(-1)!;
    expect(entry.message).toBe("이동: 업무/계획.md → 보관/2026 계획.md");
    expect(entry.files.map((f) => f.path).sort()).toEqual(["노트.md", "보관/2026 계획.md"]);
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
    expect(v.history("a.md")[0].author).toBe("external");
    expect(seen[0][0]).toBe("external");
    // 다시 열어도 기록은 남는다
    const again = new LocalVault(store);
    await again.open();
    expect(again.history("a.md").map((h) => h.author)).toEqual(["external", "노트북", "노트북"]);
  });

  it("위키 토픽: index·log를 앱이 만들고 고칠 수 없다", async () => {
    const { v } = await vault({ "업무/경제/raw/기사.md": "# 기사\n본문", "업무/경제/wiki/index.md": "옛 파일" });
    await expect(v.createTopic("경제")).rejects.toThrow(/두 단계/);
    await v.createTopic("업무/경제");
    expect(v.topics().find((t) => t.name === "업무/경제")).toMatchObject({ wiki: true, raw: 1, pages: 0 });
    const idx = await v.read("업무/경제/wiki/index.md");
    expect(idx.generated).toBe(true);
    expect(idx.content).toContain("미반영 원본");
    expect(idx.content).toContain("[[업무/경제/raw/기사|기사]]");
    await v.write("업무/경제/wiki/금리.md", "---\nsources: ['[[업무/경제/raw/기사]]']\n---\n# 금리\n", null);
    expect((await v.read("업무/경제/wiki/index.md")).content).toContain("페이지 1개에서 인용");
    expect((await v.read("업무/경제/wiki/log.md")).content).toContain("위키 토픽 만들기: 업무/경제");
    await expect(v.write("업무/경제/wiki/index.md", "x", idx.hash)).rejects.toBeInstanceOf(ForbiddenError);
    expect(v.search("옛").length).toBe(0);
    expect(v.graph().edges).toEqual([{ source: "업무/경제/wiki/금리.md", target: "업무/경제/raw/기사.md", kind: "source" }]);
  });

  it("할 일 체크", async () => {
    const { v } = await vault({ "t.md": "- [ ] 하나\n- [ ] 둘\n" });
    const d = await v.read("t.md");
    const r = await v.setTask("t.md", 2, true, d.hash);
    expect(r.content).toBe("- [ ] 하나\n- [x] 둘\n");
  });
});

describe("공통 설정·노드 이동", () => {
  it("설정 파일은 검색·위젯·속성 통계에서 빠지고, [[날짜]]는 같은 워크스페이스의 그날 데일리 노트로", async () => {
    const { v } = await vault({
      "keyring-settings.md": "---\nkeyring: settings\nvault:\n  language: ko\nworkspaces:\n  개인:\n    daily:\n      format: YYYY/YYYY-MM-DD\n---\n# Keyring Notes 설정\n일기",
      "개인/일기/2026/2026-10-07 회의.md": "---\nicon: 📅\n---\n회의 일기",
      "업무/일기/2026-10-07.md": "업무 일기",
      "개인/a.md": "[[2026-10-07]] 일기",
      "업무/b.md": "[[2026-10-07]]",
    });
    expect(v.daily().of("개인")).toMatchObject({ folder: "개인/일기", format: "YYYY/YYYY-MM-DD" });
    expect(v.search("일기").map((h) => h.path).sort()).toEqual(["개인/a.md", "개인/일기/2026/2026-10-07 회의.md", "업무/일기/2026-10-07.md"]);
    expect(v.properties().map((p) => p.key)).toEqual(["icon"]);
    const w = v.widget("type: query\nfrom: 개인");
    expect(w.type === "query" && w.rows.map((r) => r.path).sort()).toEqual(["개인/a.md", "개인/일기/2026/2026-10-07 회의.md"]);
    expect(v.backlinks("개인/일기/2026/2026-10-07 회의.md").map((b) => b.path)).toEqual(["개인/a.md"]);
    expect(v.backlinks("업무/일기/2026-10-07.md").map((b) => b.path)).toEqual(["업무/b.md"]);
    expect(v.graph().nodes.map((n) => n.id)).not.toContain("keyring-settings.md");
  });

  it("노드 이동: 노트와 하위(문서·첨부)를 한 기록으로, 링크(첨부 임베드·상대 경로) 갱신", async () => {
    const { v, store } = await vault({
      "업무/프로젝트.md": "# 프로젝트 소개 [[계획]]",
      "업무/프로젝트/계획.md": "![[도식.png]] ![](도식.png) [[참고]]",
      "업무/프로젝트/참고.md": "참고",
      "업무/밖.md": "[[프로젝트]] [[프로젝트/참고]] ![[프로젝트/도식.png]] [x](프로젝트/도식.png)",
    });
    store.touch("업무/프로젝트/도식.png", "PNG");
    await v.rescan();
    const r = await v.moveNode("업무/프로젝트", "보관/2026 프로젝트");
    // 처음 고치는 문서의 "기존 내용" 기록 뒤에 이동 한 건
    expect(v.entries().map((e) => e.message).slice(-2)).toEqual(["기존 내용", "노드 이동: 업무/프로젝트 → 보관/2026 프로젝트"]);
    expect(r.moved.map(([, t]) => t).sort()).toEqual(["보관/2026 프로젝트.md", "보관/2026 프로젝트/계획.md", "보관/2026 프로젝트/도식.png", "보관/2026 프로젝트/참고.md"]);
    expect((await v.read("업무/밖.md")).content).toBe("[[2026 프로젝트]] [[보관/2026 프로젝트/참고]] ![[보관/2026 프로젝트/도식.png]] [x](../보관/2026%20프로젝트/도식.png)");
    expect((await v.read("보관/2026 프로젝트/계획.md")).content).toBe("![[도식.png]] ![](도식.png) [[참고]]");
    expect(new TextDecoder().decode(await v.readBytes("보관/2026 프로젝트/도식.png"))).toBe("PNG");
    await expect(v.readBytes("업무/프로젝트/도식.png")).rejects.toBeInstanceOf(NotFoundError);
    await expect(v.moveNode("보관", "보관/안")).rejects.toThrow(/하위/);
  });

  it("노드 삭제는 하위까지 한 기록, 되살리면 하위까지", async () => {
    const { v, store } = await vault({ "개인/여행.md": "여행", "개인/여행/제주.md": "제주", "개인/여행/제주/일정.md": "일정" });
    store.touch("개인/여행/사진.png", "IMG");
    await v.rescan();
    const before = v.entries().length;
    const { deleted } = await v.deleteNode("개인/여행");
    expect(deleted.map((d) => d.path)).toEqual(["개인/여행.md", "개인/여행/사진.png", "개인/여행/제주.md", "개인/여행/제주/일정.md"]);
    expect(v.entries().length - before).toBe(2); // 기존 내용 + 노드 삭제
    expect(v.entries().at(-1)!.message).toBe("노드 삭제: 개인/여행");
    expect(v.tree().find((n) => n.name === "개인")).toBeUndefined();
    await v.restoreFiles(deleted);
    expect((await v.read("개인/여행/제주/일정.md")).content).toBe("일정");
    expect(new TextDecoder().decode(await v.readBytes("개인/여행/사진.png"))).toBe("IMG");
  });
});
