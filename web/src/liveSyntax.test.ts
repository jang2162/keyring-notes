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

  it("따로 떨어진 인용은 각각 첫 단계다", () => {
    expect(only(marks("> a\n\nb\n\n> c"), "quoteLine")).toEqual([
      { kind: "quoteLine", line: 1, depth: 1 },
      { kind: "quoteLine", line: 5, depth: 1 },
    ]);
  });

  it("인용 안 코드 블록은 그 줄의 인용 기호까지만 숨기고 > 로 시작하는 코드 글자는 둔다", () => {
    const list = marks("> ```js\n> a();\n>\n> >b\n> ```");
    expect(only(list, "hide")).toEqual([
      { kind: "hide", from: 0, to: 2 },
      { kind: "hide", from: 8, to: 10 },
      { kind: "hide", from: 15, to: 16 },
      { kind: "hide", from: 17, to: 19 },
      { kind: "hide", from: 22, to: 24 },
    ]);
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

  it("펼친 프런트매터(커서가 안)의 YAML 목록은 글머리·할 일로 그리지 않는다", () => {
    const list = marks("---\ntags:\n  - a\n  - [ ] b\n---\n\n- c", [2]);
    expect(only(list, "task")).toEqual([]);
    expect(only(list, "bullet")).toEqual([{ kind: "bullet", from: 31, to: 32 }]);
  });

  it("할 일이 아닌 줄은 null", () => {
    expect(toggleTaskAt(state("- a\n글"), 1)).toBeNull();
    expect(toggleTaskAt(state("- a\n글"), 9)).toBeNull();
  });
});

describe("코드 블록", () => {
  const doc = "앞\n```ts\nconst a = 1;\n```\n뒤";

  it("커서가 블록 밖이면 펜스 두 줄을 숨기고 머리에 언어와 안쪽 코드를 싣는다", () => {
    const list = marks(doc, [1]);
    expect(only(list, "fenceHead")).toEqual([{ kind: "fenceHead", from: 2, to: 7, lang: "ts", code: "const a = 1;" }]);
    expect(only(list, "codeLine")).toEqual([{ kind: "codeLine", line: 3 }]);
    expect(only(list, "fenceTail")).toEqual([{ kind: "fenceTail", from: 21, to: 24 }]);
  });

  it("커서가 블록 안이면 펜스 줄은 원문, 상자는 그대로", () => {
    const list = marks(doc, [3]);
    expect(only(list, "fenceHead")).toEqual([]);
    expect(only(list, "fenceTail")).toEqual([]);
    expect(only(list, "codeLine")).toEqual([{ kind: "codeLine", line: 3 }]);
    expect(only(marks(doc, [2]), "fenceHead")).toEqual([]);
  });

  it("Mermaid 는 건드리지 않는다(liveBlocks 가 그린다)", () => {
    const list = marks("```mermaid\ngraph TD\n```");
    expect(list.filter((m) => m.kind === "fenceHead" || m.kind === "fenceTail" || m.kind === "codeLine")).toEqual([]);
  });

  it("들여쓴 코드 블록은 상자만", () => {
    expect(marks("    code\n    more")).toEqual([
      { kind: "codeLine", line: 1 },
      { kind: "codeLine", line: 2 },
    ]);
  });

  it("닫는 펜스 없이 문서가 끝나면 머리만, 코드는 끝까지", () => {
    const list = marks("```js\nabc\ndef");
    expect(only(list, "fenceHead")).toEqual([{ kind: "fenceHead", from: 0, to: 5, lang: "js", code: "abc\ndef" }]);
    expect(only(list, "fenceTail")).toEqual([]);
    expect(only(list, "codeLine").map((m) => m.line)).toEqual([2, 3]);
  });

  it("언어가 없거나 비어 있는 블록, ~~~ 펜스", () => {
    expect(only(marks("```\n```"), "fenceHead")).toEqual([{ kind: "fenceHead", from: 0, to: 3, lang: "", code: "" }]);
    expect(only(marks("~~~py extra\nx\n~~~"), "fenceHead")).toEqual([{ kind: "fenceHead", from: 0, to: 11, lang: "py", code: "x" }]);
  });

  it("목록 안 코드 블록: 펜스 기호부터 숨기고(글머리 들여쓰기는 둔다) 복사할 코드는 모든 줄", () => {
    const list = marks("- item\n  ```js\n  a();\n  b();\n  ```");
    expect(only(list, "fenceHead")).toEqual([{ kind: "fenceHead", from: 9, to: 14, lang: "js", code: "a();\nb();" }]);
    expect(only(list, "fenceTail")).toEqual([{ kind: "fenceTail", from: 31, to: 34 }]);
  });

  it("목록 안 코드 블록의 빈 줄도 복사할 코드에 남는다", () => {
    expect(only(marks("- item\n  ```js\n  a();\n\n  b();\n  ```"), "fenceHead")[0]?.code).toBe("a();\n\nb();");
  });

  it("인용 안 코드 블록: 펜스 기호부터 숨기고 복사할 코드는 인용 기호를 뺀 모든 줄", () => {
    expect(only(marks("> ```js\n> a();\n> b();\n> ```"), "fenceHead")).toEqual([{ kind: "fenceHead", from: 2, to: 7, lang: "js", code: "a();\nb();" }]);
    expect(only(marks("> ```js\n> a();\n>\n> >b\n> ```"), "fenceHead")[0]?.code).toBe("a();\n\n>b");
  });

  it("코드 안의 ---·> ·- 는 그리지 않는다", () => {
    const list = marks("```\n---\n> a\n- b\n```");
    expect(list.filter((m) => m.kind === "hr" || m.kind === "quoteLine" || m.kind === "bullet")).toEqual([]);
  });
});
