import { describe, expect, it } from "vitest";
import { ChangeSet, EditorState, type ChangeSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  cellAt,
  cellChangesToDoc,
  cellText,
  compareCells,
  deleteColumn,
  deleteRow,
  ensureCell,
  escapeCellInput,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  rawToTextPos,
  setAlign,
  sortRows,
  textToRawPos,
  visibleText,
  type TableModel,
} from "./tableModel";

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

/** 줄 수가 같을 때 바뀐 줄 번호(0부터) */
function changedLines(before: string, after: string): number[] {
  const a = before.split("\n");
  const b = after.split("\n");
  expect(b).toHaveLength(a.length);
  return a.flatMap((l, i) => (l === b[i] ? [] : [i]));
}

const T = "| h1 | h2 |\n|----|----|\n| a | b |\n| c | d |\n| e | f |";
const run = (doc: string, op: (m: TableModel) => ChangeSpec[]) => apply(doc, op(tableOf(doc)));

describe("행 작업", () => {
  it("insertRow: 그 자리에 빈 행 줄 하나만", () => {
    const after = run(T, (m) => insertRow(m, 1));
    expect(after.split("\n")).toEqual(["| h1 | h2 |", "|----|----|", "| a | b |", "|  |  |", "| c | d |", "| e | f |"]);
    expect(tableOf(after).body).toHaveLength(4);
  });

  it("insertRow: 맨 앞·맨 끝(끝 줄바꿈 없는 표)", () => {
    expect(run(T, (m) => insertRow(m, 0)).split("\n")[2]).toBe("|  |  |");
    const end = run(T, (m) => insertRow(m, 3));
    expect(end.split("\n").at(-1)).toBe("|  |  |");
    expect(end.startsWith(T + "\n")).toBe(true);
  });

  it("insertRow: 본문이 없는 표", () => {
    expect(run("| a |\n|---|", (m) => insertRow(m, 0))).toBe("| a |\n|---|\n|  |");
  });

  it("insertRow: 바깥 | 없는 표도 빈 칸이 사라지지 않게 양끝 | 를 쓴다", () => {
    // "  |  " 는 GFM 이 앞 공백을 떼고 맨 앞 | 를 테두리로 봐 칸 하나가 된다
    const after = run("a | b\n--- | ---\n1 | 2", (m) => insertRow(m, 1));
    expect(after.split("\n")[3]).toBe("|  |  |");
    expect(tableOf(after).body[1].cells).toHaveLength(2);
  });

  it("insertRow: 표 뒤에 글이 있어도 표 끝 줄 다음에", () => {
    expect(run("| a |\n|---|\n| 1 |\n\n뒤", (m) => insertRow(m, 1))).toBe("| a |\n|---|\n| 1 |\n|  |\n\n뒤");
  });

  it("deleteRow: 그 줄만 사라진다(가운데·끝)", () => {
    expect(run(T, (m) => deleteRow(m, 1))).toBe("| h1 | h2 |\n|----|----|\n| a | b |\n| e | f |");
    expect(run(T, (m) => deleteRow(m, 2))).toBe("| h1 | h2 |\n|----|----|\n| a | b |\n| c | d |");
    expect(run(T + "\n\n뒤", (m) => deleteRow(m, 2))).toBe("| h1 | h2 |\n|----|----|\n| a | b |\n| c | d |\n\n뒤");
  });

  it("moveRow: 줄 글은 그대로, 순서만(위로·아래로)", () => {
    const up = run(T, (m) => moveRow(m, 2, 0));
    expect(up.split("\n").slice(2)).toEqual(["| e | f |", "| a | b |", "| c | d |"]);
    expect(changedLines(T, up)).toEqual([2, 3, 4]);
    const down = run(T, (m) => moveRow(m, 0, 2));
    expect(down.split("\n").slice(2)).toEqual(["| c | d |", "| e | f |", "| a | b |"]);
    const one = run(T, (m) => moveRow(m, 1, 2));
    expect(changedLines(T, one)).toEqual([3, 4]);
    expect(run(T, (m) => moveRow(m, 1, 1))).toBe(T);
  });
});

describe("열 작업", () => {
  const W = "|  a   | b |\n|---|:-:|\n| 1 | 2 |";

  it("insertColumn: 모든 줄에 칸 하나, 구분 줄에는 ---, 다른 칸 글·공백은 그대로", () => {
    const after = run(W, (m) => insertColumn(m, 1));
    expect(after).toBe("|  a   |  | b |\n|---| --- |:-:|\n| 1 |  | 2 |");
    const m = tableOf(after);
    expect(m.columns).toBe(3);
    expect(m.align).toEqual([null, null, "center"]);
    expect(m.header.cells.map((c) => c.raw)).toEqual(["a", "", "b"]);
  });

  it("insertColumn: 맨 앞·맨 끝", () => {
    expect(run(W, (m) => insertColumn(m, 0)).split("\n")[0]).toBe("|  |  a   | b |");
    const end = run(W, (m) => insertColumn(m, 2));
    expect(end).toBe("|  a   | b |  |\n|---|:-:| --- |\n| 1 | 2 |  |");
  });

  it("insertColumn: 바깥 | 없는 표의 끝 열은 머리 빈 칸을 | 로 닫는다", () => {
    const after = run("a | b\n--- | ---\n1 | 2", (m) => insertColumn(m, 2));
    const m = tableOf(after);
    expect(m.columns).toBe(3);
    expect(m.header.cells).toHaveLength(3);
    expect(after.split("\n")[2].startsWith("1 | 2")).toBe(true);
  });

  it("insertColumn: 바깥 | 없는 표의 맨 앞 열", () => {
    const after = run("a | b\n--- | ---\n1 | 2", (m) => insertColumn(m, 0));
    const m = tableOf(after);
    expect(m.columns).toBe(3);
    expect(m.header.cells.map((c) => c.raw)).toEqual(["", "a", "b"]);
    expect(m.body[0].cells.map((c) => c.raw)).toEqual(["", "1", "2"]);
  });

  it("insertColumn: 칸이 모자란 행은 그 칸 앞이면 넣고, 뒤면 그대로 둔다", () => {
    const doc = "| a | b | c |\n|---|---|---|\n| x |";
    expect(run(doc, (m) => insertColumn(m, 0)).split("\n")[2]).toBe("|  | x |");
    expect(run(doc, (m) => insertColumn(m, 2)).split("\n")[2]).toBe("| x |");
  });

  it("deleteColumn: 그 칸과 | 하나만 지운다", () => {
    const after = run(W, (m) => deleteColumn(m, 0));
    expect(after).toBe("| b |\n|:-:|\n| 2 |");
    expect(run(W, (m) => deleteColumn(m, 1))).toBe("|  a   |\n|---|\n| 1 |");
    // 열이 하나 남으면 | 가 하나는 있어야 표로 읽힌다
    expect(run("a | b\n--- | ---\n1 | 2", (m) => deleteColumn(m, 1))).toBe("a |\n--- |\n1 |");
  });

  it("deleteColumn: 칸이 모자란 행에서 없는 칸을 지워도 깨지지 않는다", () => {
    const doc = "| a | b | c |\n|---|---|---|\n| x |";
    const after = run(doc, (m) => deleteColumn(m, 2));
    expect(after).toBe("| a | b |\n|---|---|\n| x |");
  });

  it("moveColumn: 칸 글과 공백을 통째로 옮긴다", () => {
    const after = run(W, (m) => moveColumn(m, 0, 1));
    expect(after).toBe("| b |  a   |\n|:-:|---|\n| 2 | 1 |");
    expect(tableOf(after).align).toEqual(["center", null]);
  });

  it("moveColumn: 칸이 모자란 행은 빈 칸을 채워 옮긴다", () => {
    const doc = "| a | b | c |\n|---|---|---|\n| x |";
    expect(run(doc, (m) => moveColumn(m, 0, 2)).split("\n")[2]).toBe("|  |  | x |");
    expect(run(doc, (m) => moveColumn(m, 1, 2)).split("\n")[2]).toBe("| x |");
  });
});

describe("setAlign", () => {
  it("구분 줄만, 그 칸만 바뀐다(원래 - 개수, 최소 3)", () => {
    const doc = "| a | b |\n|-----|---|\n| 1 | 2 |";
    const c = run(doc, (m) => setAlign(m, 0, "center"));
    expect(c).toBe("| a | b |\n|:-----:|---|\n| 1 | 2 |");
    expect(changedLines(doc, c)).toEqual([1]);
    expect(run(doc, (m) => setAlign(m, 1, "right")).split("\n")[1]).toBe("|-----|---:|");
    expect(run("| a |\n| :-: |", (m) => setAlign(m, 0, null)).split("\n")[1]).toBe("| --- |");
    expect(run("| a |\n|:-|", (m) => setAlign(m, 0, "left")).split("\n")[1]).toBe("|:---|");
  });
});

describe("sort", () => {
  const col = (vals: string[]) => `| v |\n|---|\n${vals.map((v) => (v ? `| ${v} |` : "|  |")).join("\n")}`;
  const values = (doc: string) => tableOf(doc).body.map((r) => r.cells[0]?.raw ?? "");

  it("숫자는 숫자로, 빈 칸은 어느 쪽이든 맨 뒤", () => {
    const doc = col(["10", "9", "", "2%", "1,000"]);
    expect(values(run(doc, (m) => sortRows(m, 0, "asc")))).toEqual(["2%", "9", "10", "1,000", ""]);
    expect(values(run(doc, (m) => sortRows(m, 0, "desc")))).toEqual(["1,000", "10", "9", "2%", ""]);
  });

  it("안정 정렬: 같은 값(b·B)은 원래 순서", () => {
    expect(values(run(col(["b", "a", "B"]), (m) => sortRows(m, 0, "asc")))).toEqual(["a", "b", "B"]);
    expect(values(run(col(["b", "a", "B"]), (m) => sortRows(m, 0, "desc")))).toEqual(["b", "B", "a"]);
  });

  it("머리 행·구분 줄은 그대로, 바뀐 줄은 본문 줄뿐", () => {
    const after = run(T, (m) => sortRows(m, 0, "desc"));
    expect(after.split("\n").slice(0, 2)).toEqual(T.split("\n").slice(0, 2));
    expect(changedLines(T, after)).toEqual([2, 4]);
  });

  it("칸이 모자란 행은 빈 칸으로 친다", () => {
    const doc = "| a | b |\n|---|---|\n| 1 | z |\n| 2 |";
    expect(
      run(doc, (m) => sortRows(m, 1, "asc"))
        .split("\n")
        .slice(2),
    ).toEqual(["| 1 | z |", "| 2 |"]);
  });

  it("보이는 글로 비교한다(**12** 는 12)", () => {
    expect(values(run(col(["**12**", "9"]), (m) => sortRows(m, 0, "asc")))).toEqual(["9", "**12**"]);
  });
});

describe("compareCells / visibleText", () => {
  it("숫자 비교", () => {
    expect(compareCells("1,000", "10")).toBeGreaterThan(0);
    expect(compareCells("-3", "2")).toBeLessThan(0);
    expect(compareCells("1.5", "1.25")).toBeGreaterThan(0);
    expect(compareCells("2%", "10%")).toBeLessThan(0);
    expect(compareCells(" +4 ", "4")).toBe(0);
  });
  it("숫자와 글이 섞이면 localeCompare numeric·base", () => {
    expect(compareCells("item 2", "item 10")).toBeLessThan(0);
    expect(compareCells("a", "A")).toBe(0);
    expect(compareCells("10", "abc")).toBe("10".localeCompare("abc", undefined, { numeric: true, sensitivity: "base" }));
  });
  it("visibleText 는 마크다운 기호를 뺀 글", () => {
    expect(visibleText("**12**")).toBe("12");
    expect(visibleText("[[노트|별칭]]")).toBe("별칭");
    expect(visibleText("[[노트]]")).toBe("노트");
    expect(visibleText("[글](u)")).toBe("글");
    expect(visibleText("`co` ~~x~~ ==m== *i*")).toBe("co x m i");
    expect(visibleText("a \\| b")).toBe("a | b");
  });
});
