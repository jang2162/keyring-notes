import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { parseTable } from "./tableModel";
import { enterTableFrom, exitTarget, navigate, newRowSpec, snapToCell } from "./tableNav";
import { tableEditor } from "./tableWidget";

const T = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
const m = parseTable(Text.of(T.split("\n")), 0, T.length)!;

describe("navigate (2열, 머리 + 본문 2행)", () => {
  it("Tab: 오른쪽, 줄 끝이면 다음 행 첫 칸, 마지막 칸이면 새 행", () => {
    expect(navigate(m, 0, 0, "Tab", false, false)).toEqual({ kind: "cell", row: 0, col: 1 });
    expect(navigate(m, 0, 1, "Tab", false, false)).toEqual({ kind: "cell", row: 1, col: 0 });
    expect(navigate(m, 2, 1, "Tab", false, false)).toEqual({ kind: "newRow" });
  });

  it("Shift-Tab: 왼쪽, 줄 처음이면 앞 행 끝 칸, 머리 첫 칸이면 그대로", () => {
    expect(navigate(m, 1, 1, "Shift-Tab", false, false)).toEqual({ kind: "cell", row: 1, col: 0 });
    expect(navigate(m, 1, 0, "Shift-Tab", false, false)).toEqual({ kind: "cell", row: 0, col: 1 });
    expect(navigate(m, 0, 0, "Shift-Tab", false, false)).toEqual({ kind: "stay" });
  });

  it("Enter: 아래 칸, 마지막 행이면 새 행", () => {
    expect(navigate(m, 0, 1, "Enter", false, false)).toEqual({ kind: "cell", row: 1, col: 1 });
    expect(navigate(m, 2, 0, "Enter", false, false)).toEqual({ kind: "newRow" });
  });

  it("↑ ↓: 위·아래 칸, 머리 위·마지막 행 아래는 표 밖", () => {
    expect(navigate(m, 1, 1, "ArrowUp", false, false)).toEqual({ kind: "cell", row: 0, col: 1 });
    expect(navigate(m, 0, 0, "ArrowUp", false, false)).toEqual({ kind: "exit", where: "before" });
    expect(navigate(m, 1, 0, "ArrowDown", false, false)).toEqual({ kind: "cell", row: 2, col: 0 });
    expect(navigate(m, 2, 1, "ArrowDown", false, false)).toEqual({ kind: "exit", where: "after" });
  });

  it("← →: 칸 글의 처음·끝일 때만 옆 칸으로", () => {
    expect(navigate(m, 1, 1, "ArrowLeft", true, false)).toEqual({ kind: "cell", row: 1, col: 0 });
    expect(navigate(m, 1, 1, "ArrowLeft", false, true)).toEqual({ kind: "stay" });
    expect(navigate(m, 1, 0, "ArrowLeft", true, true)).toEqual({ kind: "stay" });
    expect(navigate(m, 1, 0, "ArrowRight", false, true)).toEqual({ kind: "cell", row: 1, col: 1 });
    expect(navigate(m, 1, 0, "ArrowRight", true, false)).toEqual({ kind: "stay" });
    expect(navigate(m, 1, 1, "ArrowRight", true, true)).toEqual({ kind: "stay" });
  });

  it("본문이 없는 표: 머리에서 Enter·Tab(끝 칸)은 새 행, ↓ 는 표 밖", () => {
    const h = parseTable(Text.of(["| a | b |", "|---|---|"]), 0, 19)!;
    expect(navigate(h, 0, 0, "Enter", false, false)).toEqual({ kind: "newRow" });
    expect(navigate(h, 0, 1, "Tab", false, false)).toEqual({ kind: "newRow" });
    expect(navigate(h, 0, 0, "ArrowDown", false, false)).toEqual({ kind: "exit", where: "after" });
  });
});

describe("newRowSpec / exitTarget", () => {
  const apply = (doc: string, spec: { changes: { from: number; insert: string }; selection: { anchor: number } }) => {
    const s = EditorState.create({ doc }).update(spec).state;
    return { doc: s.doc.toString(), head: s.selection.main.head };
  };

  it("새 행을 끝에 넣고 그 행의 칸에 커서(트랜잭션 하나)", () => {
    const r = apply(T, newRowSpec(m, 0));
    expect(r.doc).toBe(T + "\n|  |  |");
    expect(r.head).toBe(T.length + 3);
    const c = apply(T, newRowSpec(m, 1));
    expect(c.head).toBe(T.length + 6);
  });

  it("표 밖: 앞 줄 끝 / 뒤 줄 처음. 표가 문서 끝이면 뒤에 빈 줄을 만든다", () => {
    const doc = "앞\n" + T + "\n뒤";
    const mm = parseTable(Text.of(doc.split("\n")), 2, 2 + T.length)!;
    const state = EditorState.create({ doc });
    expect(exitTarget(state, mm, "before")).toEqual({ selection: { anchor: 1 } });
    expect(exitTarget(state, mm, "after")).toEqual({ selection: { anchor: 3 + T.length } });
    const end = EditorState.create({ doc: T });
    expect(exitTarget(end, m, "after")).toEqual({ changes: { from: T.length, insert: "\n" }, selection: { anchor: T.length + 1 } });
    expect(exitTarget(end, m, "before")).toBeNull();
  });
});

describe("enterTableFrom: 본문에서 ↓·↑ 로 표에 들어가기", () => {
  // 표 바로 뒤에 글 줄이 붙으면 GFM 은 그 줄도 표의 행으로 읽는다 — 빈 줄로 뗀다
  const doc = "위\n" + T + "\n\n아래";
  const state = (() => {
    const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), tableEditor(() => null, { linkCandidates: () => [] })] });
    ensureSyntaxTree(s, doc.length, 5000);
    return s;
  })();
  it("표 바로 위 줄에서 ↓ → 머리 첫 칸", () => {
    expect(enterTableFrom(state, 1, "down")).toBe(doc.indexOf("a"));
  });
  it("표 바로 아래 줄에서 ↑ → 마지막 행 첫 칸", () => {
    expect(enterTableFrom(state, 6, "up")).toBe(doc.indexOf("3"));
  });
  it("표와 붙지 않은 줄이나 반대 방향은 null", () => {
    expect(enterTableFrom(state, 1, "up")).toBeNull();
    expect(enterTableFrom(state, 6, "down")).toBeNull();
  });
});

describe("snapToCell(셀 밖 자리 → 가장 가까운 셀)", () => {
  const at = (s: string, i = 0) => {
    let k = -1;
    for (let n = 0; n <= i; n++) k = T.indexOf(s, k + 1);
    return k;
  };
  it("셀 안이면 null(그대로 둔다)", () => {
    expect(snapToCell(m, at("a"))).toBeNull();
    expect(snapToCell(m, at("a") + 1)).toBeNull();
  });
  it("표 처음(머리 앞 |)은 머리 첫 셀 처음, 표 끝(마지막 | 뒤)은 마지막 행 마지막 셀 끝", () => {
    expect(snapToCell(m, 0)).toBe(at("a"));
    expect(snapToCell(m, T.length)).toBe(at("4") + 1);
  });
  it("| 위·셀 사이 공백은 같은 행의 가까운 셀로", () => {
    expect(snapToCell(m, at("| b"))).toBe(at("a") + 1);
    expect(snapToCell(m, at("| b") + 1)).toBe(at("b"));
    expect(snapToCell(m, at("1") - 2)).toBe(at("1"));
  });
  it("구분 줄은 머리 행의 같은 열 셀 끝", () => {
    const delim = T.indexOf("|---");
    expect(snapToCell(m, delim)).toBe(at("a") + 1);
    expect(snapToCell(m, delim + "|---|-".length)).toBe(at("b") + 1);
    expect(snapToCell(m, delim + "|---|---|".length)).toBe(at("b") + 1);
  });
});
