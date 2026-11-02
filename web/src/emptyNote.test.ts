import { describe, expect, it } from "vitest";
import { closedForGood, dropFromNav, hasNodeChildren, isBlankNote, openAnywhere } from "./emptyNote";
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
