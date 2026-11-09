import { describe, expect, it } from "vitest";
import { ChangeSet, EditorState, type ChangeSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { cellAt, cellChangesToDoc, cellText, ensureCell, escapeCellInput, parseTable, rawToTextPos, textToRawPos, type TableModel } from "./tableModel";

/** 문서의 첫 최상위 표(lezer Table 노드)를 모델로 */
function tableOf(doc: string): TableModel {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  let range: [number, number] | null = null;
  tree.iterate({
    enter: (n) => {
      if (range) return false;
      if (n.name === "Table") {
        range = [n.from, n.to];
        return false;
      }
      return undefined;
    },
  });
  if (!range) throw new Error("표 없음");
  const m = parseTable(state.doc, range[0], range[1]);
  if (!m) throw new Error("모델 없음");
  return m;
}

const apply = (doc: string, specs: ChangeSpec[]) => ChangeSet.of(specs, doc.length).apply(EditorState.create({ doc }).doc).toString();

describe("parseTable", () => {
  it("바깥 | 가 있는 표: 칸 수·정렬·칸 구간", () => {
    const doc = "| a | b |\n| :-- | --: |\n| 1 | 2 |";
    const m = tableOf(doc);
    expect(m.outerPipes).toBe(true);
    expect(m.columns).toBe(2);
    expect(m.align).toEqual(["left", "right"]);
    expect(m.header.cells[1].raw).toBe("b");
    expect(m.body).toHaveLength(1);
    expect(m.body[0].cells.map((c) => doc.slice(c.from, c.to))).toEqual(["1", "2"]);
    expect(m.from).toBe(0);
    expect(m.to).toBe(doc.length);
  });

  it("바깥 | 가 없는 표", () => {
    const m = tableOf("a | b\n--- | :-:\n1 | 2");
    expect(m.outerPipes).toBe(false);
    expect(m.align).toEqual([null, "center"]);
    expect(m.header.cells.map((c) => c.raw)).toEqual(["a", "b"]);
    expect(m.body[0].cells.map((c) => c.raw)).toEqual(["1", "2"]);
  });

  it("\\| 는 칸을 나누지 않고, 칸이 모자란 행은 모자란 대로", () => {
    const m = tableOf("| a \\| b | c |\n|---|---|\n| x |");
    expect(m.header.cells.map((c) => c.raw)).toEqual(["a \\| b", "c"]);
    expect(m.body[0].cells.map((c) => c.raw)).toEqual(["x"]);
  });

  it("빈 칸은 from === to(여는 | 뒤 공백 하나 다음)", () => {
    const doc = "| a |  |\n|---|---|";
    const m = tableOf(doc);
    const c = m.header.cells[1];
    expect(c.from).toBe(c.to);
    expect(c.from).toBe(6);
    expect(c.raw).toBe("");
    // 공백 없는 빈 칸은 | 바로 뒤
    const n = tableOf("| a ||\n|---|---|");
    expect(n.header.cells[1].from).toBe(5);
    expect(n.header.cells[1].to).toBe(5);
  });

  it("프런트매터 뒤의 표, 끝 줄바꿈 없는 표는 문서 끝까지", () => {
    const doc = "---\nx: 1\n---\n| a |\n|---|";
    const m = tableOf(doc);
    expect(m.from).toBe(doc.indexOf("| a |"));
    expect(m.to).toBe(doc.length);
    expect(m.header.cells[0].raw).toBe("a");
    expect(m.body).toHaveLength(0);
  });

  it("표 뒤 글이 있어도 표 줄까지만", () => {
    const doc = "앞\n\n| a |\n|---|\n| 1 |\n\n뒤";
    const m = tableOf(doc);
    expect(doc.slice(m.from, m.to)).toBe("| a |\n|---|\n| 1 |");
  });
});

describe("칸 글과 원문 위치", () => {
  it("cellText 는 \\| 를 | 로", () => {
    expect(cellText("a \\| b")).toBe("a | b");
    expect(cellText("x")).toBe("x");
  });

  it("textToRawPos / rawToTextPos 는 이스케이프를 따라 맞춘다", () => {
    expect(textToRawPos("a \\| b", 3)).toBe(4);
    expect(textToRawPos("a \\| b", 2)).toBe(2);
    expect(textToRawPos("a \\| b", 5)).toBe(6);
    expect(rawToTextPos("a \\| b", 5)).toBe(4);
    expect(rawToTextPos("a \\| b", 4)).toBe(3);
    expect(rawToTextPos("a \\| b", 6)).toBe(5);
  });

  it("escapeCellInput: | → \\|, 줄바꿈 → <br>", () => {
    expect(escapeCellInput("x|y\nz")).toBe("x\\|y<br>z");
    expect(escapeCellInput("a\r\nb")).toBe("a<br>b");
  });

  it("cellChangesToDoc: 칸 글 위치 4(| 뒤)에 넣으면 원문 위치 cell.from + 5", () => {
    const doc = "| a \\| b | c |\n|---|---|";
    const m = tableOf(doc);
    const cell = m.header.cells[0];
    const text = cellText(cell.raw);
    const changes = ChangeSet.of({ from: 4, insert: "Q" }, text.length);
    const specs = cellChangesToDoc(cell, changes);
    expect(specs).toEqual([{ from: cell.from + 5, to: cell.from + 5, insert: "Q" }]);
    expect(apply(doc, specs)).toBe("| a \\| Qb | c |\n|---|---|");
  });

  it("cellChangesToDoc: 친 | 와 줄바꿈은 이스케이프해 넣는다", () => {
    const doc = "| ab |\n|---|";
    const cell = tableOf(doc).header.cells[0];
    const specs = cellChangesToDoc(cell, ChangeSet.of({ from: 1, to: 2, insert: "|\n" }, 2));
    expect(apply(doc, specs)).toBe("| a\\|<br> |\n|---|");
  });
});

describe("ensureCell", () => {
  it("있는 칸이면 변경 없이 그 자리", () => {
    const m = tableOf("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(ensureCell(m, 1, 1)).toEqual({ changes: [], at: m.body[0].cells[1].from });
  });

  it("바깥 | 가 있는 모자란 행: 행 끝에 '  |' 를 붙이고 새 칸 자리", () => {
    const doc = "| a | b |\n|---|---|\n| x |";
    const m = tableOf(doc);
    const r = ensureCell(m, 1, 1);
    const after = apply(doc, r.changes);
    expect(after).toBe("| a | b |\n|---|---|\n| x |  |");
    const n = tableOf(after);
    expect(n.body[0].cells[1].from).toBe(r.at);
  });

  it("두 칸 모자라면 둘 다 붙인다", () => {
    const doc = "| a | b | c |\n|---|---|---|\n| x |";
    const m = tableOf(doc);
    const r = ensureCell(m, 1, 2);
    const after = apply(doc, r.changes);
    expect(after).toBe("| a | b | c |\n|---|---|---|\n| x |  |  |");
    expect(tableOf(after).body[0].cells[2].from).toBe(r.at);
  });

  it("바깥 | 가 없는 모자란 행: ' | ' 를 붙이고 끝에 칸 자리(친 글이 들어가면 칸이 생긴다)", () => {
    const doc = "a | b\n--- | ---\n1";
    const m = tableOf(doc);
    const r = ensureCell(m, 1, 1);
    // r.at 은 붙인 뒤 문서의 좌표다
    const placed = apply(apply(doc, r.changes), [{ from: r.at, insert: "Q" }]);
    expect(placed).toBe("a | b\n--- | ---\n1 | Q");
    expect(tableOf(placed).body[0].cells.map((c) => c.raw)).toEqual(["1", "Q"]);
  });

  it("행 끝 공백 뒤가 아니라 마지막 | 뒤에 붙인다", () => {
    const doc = "| a | b |\n|---|---|\n| x |   ";
    const m = tableOf(doc);
    const r = ensureCell(m, 1, 1);
    const after = apply(doc, r.changes);
    expect(tableOf(after).body[0].cells.map((c) => c.raw)).toEqual(["x", ""]);
    expect(tableOf(after).body[0].cells[1].from).toBe(r.at);
  });
});

describe("cellAt", () => {
  const doc = "| a | bc |\n|---|---|\n| 1 | 2 |";
  const m = tableOf(doc);
  it("칸 구간 안(양끝 포함)이면 행·열", () => {
    expect(cellAt(m, doc.indexOf("bc"))).toEqual({ row: 0, col: 1 });
    expect(cellAt(m, doc.indexOf("bc") + 2)).toEqual({ row: 0, col: 1 });
    expect(cellAt(m, doc.indexOf("2"))).toEqual({ row: 1, col: 1 });
  });
  it("| 위나 구분 줄이면 null", () => {
    expect(cellAt(m, 0)).toBeNull();
    expect(cellAt(m, doc.indexOf("|---") + 1)).toBeNull();
  });
});
