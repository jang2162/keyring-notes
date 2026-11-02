import { describe, expect, it } from "vitest";
import { closedForGood, CreatedNotes, dropFromNav, hasNodeChildren, isBlankNote, openAnywhere } from "./emptyNote";
import { emptyLayout, openIn, splitPane, type Layout } from "./panes";

describe("손대지 않은 노트 내용", () => {
  it("앱이 적는 속성만 있고 본문이 비었으면 빈 노트다", () => {
    expect(isBlankNote("---\nedited: 2026-11-02T10:00:00.000Z\n---\n")).toBe(true);
    expect(isBlankNote("---\nsort: custom\nrank: a0\nedited: 2026-11-02T10:00:00.000Z\n---\n")).toBe(true);
  });

  it("sort 만 있어도 빈 노트다", () => {
    expect(isBlankNote("---\nsort: custom\n---\n")).toBe(true);
  });

  it("프런트매터가 없고 내용이 비었으면 빈 노트다", () => {
    expect(isBlankNote("")).toBe(true);
  });

  it("본문이 공백·빈 줄뿐이면 빈 노트다", () => {
    expect(isBlankNote("  \n\n\t \n")).toBe(true);
    expect(isBlankNote("---\nedited: 2026-11-02T10:00:00.000Z\n---\n\n   \n")).toBe(true);
  });

  it("본문에 글이 한 글자라도 있으면 빈 노트가 아니다", () => {
    expect(isBlankNote("a")).toBe(false);
    expect(isBlankNote("---\nedited: 2026-11-02T10:00:00.000Z\n---\n가")).toBe(false);
  });

  it("사람이 적는 속성이 하나라도 있으면 빈 노트가 아니다", () => {
    expect(isBlankNote("---\nedited: 2026-11-02T10:00:00.000Z\ntags: []\n---\n")).toBe(false);
    expect(isBlankNote("---\nstatus:\n---\n")).toBe(false);
  });

  it("프런트매터가 깨졌으면 지우지 않는다", () => {
    expect(isBlankNote("---\nedited: [\n---\n")).toBe(false);
    expect(isBlankNote("---\n- a\n---\n")).toBe(false);
  });

  it("닫히지 않은 프런트매터는 본문 글이다", () => {
    expect(isBlankNote("---\nedited: x\n")).toBe(false);
  });

  it("프런트매터에 YAML 주석이 있으면 사람이 쓴 것이다", () => {
    expect(isBlankNote("---\nedited: x\n# memo\n---\n")).toBe(false);
    expect(isBlankNote("---\n  # memo\n---\n")).toBe(false);
    expect(isBlankNote("---\nedited: x # memo\n---\n")).toBe(false);
    expect(isBlankNote("\uFEFF---\r\nedited: x\r\n# memo\r\n---\r\n")).toBe(false);
    // 주석이 아닌 # (값 안)과 프런트매터 밖의 줄은 이 판정에 들지 않는다
    expect(isBlankNote("---\nrank: a#0\n---\n")).toBe(true);
  });
});

describe("하위 노트·첨부", () => {
  const paths = ["W/제목 없음.md", "W/제목 없음 2.md", "W/다른.md", "W/다른/그림.png"];

  it("노드 아래에 파일이 없으면 없다 — 이름이 앞부분만 같은 형제는 하위가 아니다", () => {
    expect(hasNodeChildren("W/제목 없음.md", paths)).toBe(false);
  });

  it("하위 노트나 첨부가 있으면 있다", () => {
    expect(hasNodeChildren("W/다른.md", paths)).toBe(true);
    expect(hasNodeChildren("W/제목 없음.md", [...paths, "W/제목 없음/하위.md"])).toBe(true);
  });
});

describe("닫혀서 지울지 볼 차례", () => {
  const two = (): Layout => {
    const l = openIn(emptyLayout(), "", "W/a.md");
    return splitPane(l, l.focused, "right", "W/a.md");
  };

  it("어느 칸에든 열려 있으면 열린 것이다", () => {
    expect(openAnywhere("W/a.md", [two()])).toBe(true);
    expect(openAnywhere("W/a.md", [emptyLayout(), openIn(emptyLayout(), "", "W/b.md")])).toBe(false);
    // 다른 워크스페이스의 배치에 남아 있어도 열린 것이다
    expect(openAnywhere("W/a.md", [openIn(emptyLayout(), "", "W/b.md"), openIn(emptyLayout(), "", "W/a.md")])).toBe(true);
  });

  it("이 창에서 만든 노트가 어느 칸에도 없으면 지울지 본다", () => {
    expect(closedForGood("W/a.md", new Set(["W/a.md"]), [openIn(emptyLayout(), "", "W/b.md")])).toBe(true);
  });

  it("다른 칸에 아직 열려 있으면 보지 않는다", () => {
    expect(closedForGood("W/a.md", new Set(["W/a.md"]), [two()])).toBe(false);
  });

  it("이 창에서 만든 노트가 아니면(이름을 바꿨으면) 보지 않는다", () => {
    expect(closedForGood("W/a.md", new Set(["W/c.md"]), [emptyLayout()])).toBe(false);
  });
});

describe("열어 본 기록에서 빼기", () => {
  it("지운 노트를 빼고 지금 자리를 그 앞 기록의 끝으로 옮긴다", () => {
    expect(dropFromNav({ list: ["a", "x", "b"], i: 2 }, "x")).toEqual({ list: ["a", "b"], i: 1 });
    expect(dropFromNav({ list: ["a", "b", "x"], i: 2 }, "x")).toEqual({ list: ["a", "b"], i: 1 });
    expect(dropFromNav({ list: ["a", "x", "b"], i: 0 }, "x")).toEqual({ list: ["a", "b"], i: 0 });
  });

  it("빼서 붙게 된 같은 문서는 하나로 합친다", () => {
    expect(dropFromNav({ list: ["a", "x", "a", "b"], i: 3 }, "x")).toEqual({ list: ["a", "b"], i: 1 });
  });

  it("기록이 그 노트뿐이면 빈 기록이 된다", () => {
    expect(dropFromNav({ list: ["x"], i: 0 }, "x")).toEqual({ list: [], i: -1 });
    expect(dropFromNav({ list: [], i: -1 }, "x")).toEqual({ list: [], i: -1 });
  });
});

describe("이 창에서 만든 노트 집합", () => {
  const closed = [openIn(emptyLayout(), "", "W/b.md")];
  const made = (...paths: string[]) => {
    const c = new CreatedNotes();
    for (const p of paths) c.created(p);
    return c;
  };

  it("만든 노트를 닫으면 한 번만 지울지 본다", () => {
    const c = made("W/a.md");
    expect(c.take("W/a.md", closed)).toBe(true);
    expect(c.take("W/a.md", closed)).toBe(false);
  });

  it("아직 열려 있으면 집합에 둔다", () => {
    const c = made("W/a.md");
    expect(c.take("W/a.md", [openIn(emptyLayout(), "", "W/a.md")])).toBe(false);
    expect(c.has("W/a.md")).toBe(true);
  });

  it("제목 칸에 입력하면(확정 전에도) 지우지 않는다", () => {
    const c = made("W/a.md", "W/b.md");
    c.typed("W/a.md");
    expect(c.take("W/a.md", closed)).toBe(false);
    expect(c.has("W/b.md")).toBe(true);
  });

  it("제목 칸 입력을 Esc 로 취소하면 다시 지울 수 있다", () => {
    const c = made("W/a.md");
    c.typed("W/a.md");
    c.typed("W/a.md");
    c.untyped("W/a.md");
    expect(c.take("W/a.md", closed)).toBe(true);
  });

  it("Esc 로 되돌리는 것은 입력만으로 손댄 새 노트뿐이다", () => {
    // 만들지 않은 노트
    const c = made();
    c.typed("W/a.md");
    c.untyped("W/a.md");
    expect(c.has("W/a.md")).toBe(false);
    // 이름을 바꾸거나 옮겼다(afterMove 의 touched — 옛 경로)
    const moved = made("W/b.md");
    moved.typed("W/b.md");
    moved.touched("W/b.md");
    moved.untyped("W/b.md");
    expect(moved.has("W/b.md")).toBe(false);
    // 다른 창으로 넘겼다·지웠다
    const off = made("W/c.md", "W/d.md");
    off.typed("W/c.md");
    off.typed("W/d.md");
    off.handedOff("W/c.md");
    off.forget((p) => p === "W/d.md");
    off.untyped("W/c.md");
    off.untyped("W/d.md");
    expect([off.has("W/c.md"), off.has("W/d.md")]).toEqual([false, false]);
  });

  it("입력하지 않고 Esc 만 누르면 아무 일도 없다", () => {
    const c = made("W/a.md");
    c.untyped("W/a.md");
    expect(c.take("W/a.md", closed)).toBe(true);
    c.untyped("W/a.md");
    expect(c.has("W/a.md")).toBe(false);
  });

  it("다른 창으로 넘긴 노트는 이 창에서 닫아도 지우지 않는다", () => {
    const c = made("W/a.md");
    c.handedOff("W/a.md");
    expect(c.take("W/a.md", closed)).toBe(false);
  });

  it("지운 노드와 그 하위는 집합에서 빠진다", () => {
    const c = made("W/a.md", "W/a/x.md", "W/ab.md");
    c.forget((p) => p === "W/a.md" || p.startsWith("W/a/"));
    expect([c.has("W/a.md"), c.has("W/a/x.md"), c.has("W/ab.md")]).toEqual([false, false, true]);
  });
});
