import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxMarks, toggleTaskAt, type SyntaxMark } from "./liveSyntax";

const state = (doc: string, anchor = 0) => {
  const s = EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
};
const marks = (doc: string, active: number[] = []) => {
  const s = state(doc);
  return syntaxMarks(s, 0, s.doc.length, new Set(active));
};
const only = <K extends SyntaxMark["kind"]>(list: SyntaxMark[], kind: K) => list.filter((m): m is Extract<SyntaxMark, { kind: K }> => m.kind === kind);

describe("구분선", () => {
  it("커서가 없는 줄의 --- 는 가로줄, 커서가 오면 원문", () => {
    expect(only(marks("a\n\n---\n\nb", [1]), "hr")).toEqual([{ kind: "hr", from: 3, to: 6 }]);
    expect(only(marks("a\n\n---\n\nb", [3]), "hr")).toEqual([]);
  });

  it("맨 앞 프런트매터의 --- 는 구분선이 아니다", () => {
    expect(only(marks("---\nedited: x\n---\n\n***"), "hr")).toEqual([{ kind: "hr", from: 19, to: 22 }]);
  });

  it("글 바로 아래 --- 는 Setext 제목이다", () => {
    expect(only(marks("글\n---"), "hr")).toEqual([]);
  });

  it("프런트매터 바로 뒤의 표, 표 바로 앞의 --- 는 서로 먹지 않는다", () => {
    expect(only(marks("---\nedited: x\n---\n| a | b |\n|---|---|\n| 1 | 2 |"), "hr")).toEqual([]);
    expect(only(marks("a\n\n---\n| a | b |\n|---|---|\n| 1 | 2 |"), "hr")).toEqual([{ kind: "hr", from: 3, to: 6 }]);
  });
});

describe("인용", () => {
  it("모든 줄에 막대, 커서가 없는 줄은 > 와 뒤 공백 하나를 숨긴다", () => {
    const list = marks("> 인용\n>> 겹침");
    expect(only(list, "quoteLine")).toEqual([
      { kind: "quoteLine", line: 1, depth: 1 },
      { kind: "quoteLine", line: 2, depth: 2 },
    ]);
    expect(only(list, "hide")).toEqual([
      { kind: "hide", from: 0, to: 2 },
      { kind: "hide", from: 5, to: 8 },
    ]);
  });

  it("커서가 있는 줄은 기호를 보이되 막대는 둔다", () => {
    const list = marks("> 인용\n>> 겹침", [1]);
    expect(only(list, "hide")).toEqual([{ kind: "hide", from: 5, to: 8 }]);
    expect(only(list, "quoteLine")).toHaveLength(2);
  });

  it("콜아웃은 건드리지 않는다(블록 위젯이 그린다)", () => {
    const list = marks("> [!note] 제목\n> 내용");
    expect(only(list, "quoteLine")).toEqual([]);
    expect(only(list, "hide")).toEqual([]);
  });
});

describe("글머리와 할 일", () => {
  it("- * + 만 점으로, 번호는 그대로", () => {
    expect(only(marks("- a\n  * b\n1. c"), "bullet")).toEqual([
      { kind: "bullet", from: 0, to: 1 },
      { kind: "bullet", from: 6, to: 7 },
    ]);
  });

  it("할 일은 글머리부터 표시 뒤 공백까지를 체크박스로", () => {
    const list = marks("- [ ] 할 일\n- [x] 끝");
    expect(only(list, "task")).toEqual([
      { kind: "task", from: 0, to: 6, done: false, line: 1 },
      { kind: "task", from: 10, to: 16, done: true, line: 2 },
    ]);
    expect(only(list, "bullet")).toEqual([]);
  });

  it("커서가 있는 줄의 글머리·할 일은 원문", () => {
    const list = marks("- [ ] 할 일\n- b", [1, 2]);
    expect(only(list, "task")).toEqual([]);
    expect(only(list, "bullet")).toEqual([]);
  });

  it("toggleTaskAt 은 그 줄의 표시 한 글자만 바꾸고 선택은 그대로 둔다", () => {
    const s = state("- [ ] 할 일\n- [x] 끝", 3);
    const spec = toggleTaskAt(s, 2)!;
    const next = s.update(spec).state;
    expect(next.doc.toString()).toBe("- [ ] 할 일\n- [ ] 끝");
    expect(next.selection.main.head).toBe(3);
    const back = next.update(toggleTaskAt(next, 1)!).state;
    expect(back.doc.toString()).toBe("- [x] 할 일\n- [ ] 끝");
  });

  it("할 일이 아닌 줄은 null", () => {
    expect(toggleTaskAt(state("- a\n글"), 1)).toBeNull();
    expect(toggleTaskAt(state("- a\n글"), 9)).toBeNull();
  });
});
