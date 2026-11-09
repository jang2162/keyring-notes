import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { cellTransactionToMain, remapRef, selectedCell, shouldDefer } from "./cellEditor";
import { cellText, insertColumn, insertRow, parseTable } from "./tableModel";
import { editTableRaw, setVirtualCell, tableEditor, type CellRef } from "./tableWidget";
import { mirrored } from "./mirror";

const opts = { linkCandidates: () => [] };
function state(doc: string, anchor = 0, head = anchor) {
  const s = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [history(), markdown({ base: markdownLanguage }), tableEditor(() => null, opts)],
  });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}

/** 칸 편집기 상태(칸 글)와 그 위의 트랜잭션 하나 */
function cellTr(text: string, spec: TransactionSpec & { time?: number }) {
  const cs = EditorState.create({ doc: text });
  const { time, ...rest } = spec;
  return cs.update({ ...rest, annotations: time === undefined ? [] : [Transaction.time.of(time)] });
}

/** 본문 상태에서 칸 편집기의 입력 하나를 본문에 넣는다 */
function typeInCell(main: EditorState, insert: string, time: number) {
  const sel = selectedCell(main)!;
  const cs = EditorState.create({ doc: cellText(rawOf(main, sel)), selection: { anchor: sel.head } });
  const tr = cs.update({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + insert.length },
    userEvent: "input.type",
    annotations: [Transaction.time.of(time)],
  });
  return main.update(cellTransactionToMain(main, sel, tr)).state;
}

function rawOf(main: EditorState, sel: { table: number; row: number; col: number }) {
  const line = main.doc.lineAt(sel.table).number + (sel.row === 0 ? 0 : sel.row + 1);
  const text = main.doc.line(line).text;
  return (
    text
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      [sel.col]?.trim() ?? ""
  );
}

const DOC = "앞\n\n| a \\| b | c |\n|---|---|\n| 1 | 2 |\n\n뒤";
const T = DOC.indexOf("| a");

describe("selectedCell", () => {
  it("커서가 칸 '`a \\| b`' 의 | 뒤면 그 칸과 칸 글 좌표 3", () => {
    const at = DOC.indexOf("\\|") + 2;
    expect(selectedCell(state(DOC, at))).toEqual({ table: T, row: 0, col: 0, anchor: 3, head: 3 });
  });

  it("본문 행·열, 선택 범위", () => {
    const one = DOC.indexOf("| 2") + 2;
    expect(selectedCell(state(DOC, one, one + 1))).toEqual({ table: T, row: 1, col: 1, anchor: 0, head: 1 });
  });

  it("두 칸에 걸치거나 문서 전체면 null", () => {
    expect(selectedCell(state(DOC, DOC.indexOf("a "), DOC.indexOf(" c") + 2))).toBeNull();
    expect(selectedCell(state(DOC, 0, DOC.length))).toBeNull();
  });

  it("표 밖·| 위·구분 줄은 null", () => {
    expect(selectedCell(state(DOC, 0))).toBeNull();
    expect(selectedCell(state(DOC, T))).toBeNull();
    expect(selectedCell(state(DOC, DOC.indexOf("|---") + 2))).toBeNull();
  });

  it("읽기 전용이면 null(칸 편집기 없음)", () => {
    const s = EditorState.create({
      doc: DOC,
      selection: { anchor: DOC.indexOf("| 1") + 2 },
      extensions: [markdown({ base: markdownLanguage }), tableEditor(() => null, opts), EditorState.readOnly.of(true)],
    });
    ensureSyntaxTree(s, DOC.length, 5000);
    expect(selectedCell(s)).toBeNull();
  });

  it("원문으로 편집 중인 표는 null", () => {
    const at = DOC.indexOf("| 1") + 2;
    const s = state(DOC, at).update({ effects: editTableRaw.of(T), selection: { anchor: at } }).state;
    expect(selectedCell(s)).toBeNull();
  });

  it("칸이 모자란 행의 빈 자리: setVirtualCell 로 연 칸", () => {
    const doc = "| a | b |\n|---|---|\n| x |";
    const end = doc.length;
    let s = state(doc, 0);
    s = s.update({ effects: setVirtualCell.of({ table: 0, row: 1, col: 1 }), selection: { anchor: end } }).state;
    expect(selectedCell(s)).toEqual({ table: 0, row: 1, col: 1, anchor: 0, head: 0 });
    // 다른 곳으로 커서를 옮기면 풀린다
    s = s.update({ selection: { anchor: 0 } }).state;
    expect(selectedCell(s)).toBeNull();
  });

  it("다른 칸(미러링)이 표 앞에 글을 넣어도 같은 글자 자리", () => {
    const at = DOC.indexOf("| 2") + 3;
    let s = state(DOC, at);
    const before = selectedCell(s)!;
    s = s.update({ changes: { from: 0, insert: "새 글\n" }, annotations: [mirrored.of(true), Transaction.addToHistory.of(false)] }).state;
    const after = selectedCell(s)!;
    expect(after.anchor).toBe(before.anchor);
    expect([after.row, after.col]).toEqual([before.row, before.col]);
    expect(after.table).toBe(T + "새 글\n".length);
  });
});

describe("cellTransactionToMain", () => {
  it("칸 글 좌표의 변경을 본문 위치로, 선택도 함께", () => {
    const at = DOC.indexOf("\\|") + 2;
    const main = state(DOC, at);
    const sel = selectedCell(main)!;
    const tr = cellTr("a | b", { changes: { from: 3, insert: "Q" }, selection: { anchor: 4 }, userEvent: "input.type" });
    const next = main.update(cellTransactionToMain(main, sel, tr));
    expect(next.state.doc.toString()).toBe(DOC.replace("a \\| b", "a \\|Q b"));
    expect(next.state.selection.main.head).toBe(at + 1);
    expect(next.isUserEvent("input.type")).toBe(true);
  });

  it("본문 변경은 친 글자 하나만큼이다(칸 전체 바꾸기가 아니다 — 설계 6.3)", () => {
    const at = DOC.indexOf("| 2") + 3;
    const main = state(DOC, at);
    const sel = selectedCell(main)!;
    const tr = cellTr("2", { changes: { from: 1, insert: "Q" }, selection: { anchor: 2 }, userEvent: "input.type" });
    const changes = main.update(cellTransactionToMain(main, sel, tr)).changes;
    const got: [number, number, string][] = [];
    changes.iterChanges((fromA, toA, _fromB, _toB, ins) => got.push([fromA, toA, ins.toString()]));
    expect(got).toEqual([[at, at, "Q"]]);
  });

  it("| 를 치면 \\| 로, 선택은 그 뒤", () => {
    const at = DOC.indexOf("| 1") + 3;
    const main = state(DOC, at);
    const sel = selectedCell(main)!;
    const tr = cellTr("1", { changes: { from: 1, insert: "|" }, selection: { anchor: 2 }, userEvent: "input.type" });
    const next = main.update(cellTransactionToMain(main, sel, tr)).state;
    expect(next.doc.toString()).toContain("| 1\\| | 2 |");
    expect(next.selection.main.head).toBe(at + 2);
    expect(selectedCell(next)).toMatchObject({ row: 1, col: 0, head: 2 });
  });

  it("여러 줄을 붙여 넣으면 <br> 로 들어가고 선택은 마지막 글자 뒤(<br> 가운데가 아니다)", () => {
    const at = DOC.indexOf("| 1") + 3;
    const main = state(DOC, at);
    const sel = selectedCell(main)!;
    const tr = cellTr("1", { changes: { from: 1, insert: "x\ny" }, selection: { anchor: 4 }, userEvent: "input.paste" });
    const next = main.update(cellTransactionToMain(main, sel, tr)).state;
    const doc = next.doc.toString();
    expect(doc).toContain("| 1x<br>y | 2 |");
    expect(next.selection.main.head).toBe(doc.indexOf("y | 2") + 1);
    expect(selectedCell(next)).toMatchObject({ row: 1, col: 0, head: 7 });
  });

  it("\\ 다음에 | 를 치면(사람이 \\| 를 직접 침) \\ 를 더하지 않는다 — 셀이 나뉘지 않는다(설계 6.3)", () => {
    const at = DOC.indexOf("| 1") + 3;
    let s = state(DOC, at);
    const ref = selectedCell(s)!;
    let cs = EditorState.create({ doc: "1", selection: { anchor: 1 } });
    for (const ch of ["\\", "|"]) {
      const tr = cs.update({
        changes: { from: cs.selection.main.head, insert: ch },
        selection: { anchor: cs.selection.main.head + 1 },
        userEvent: "input.type",
      });
      s = s.update(cellTransactionToMain(s, ref, tr)).state;
      cs = tr.state;
    }
    expect(s.doc.toString()).toContain("| 1\\| | 2 |");
    const line = s.doc.line(5).text;
    expect(line).toBe("| 1\\| | 2 |");
    expect(selectedCell(s)).toMatchObject({ row: 1, col: 0, head: 2 });
  });

  it("칸 끝에 친 공백은 다음 글자와 함께 들어간다(칸 앞뒤 공백은 | 옆 여백이라 공백만으로는 칸 글이 아니다)", () => {
    const at = DOC.indexOf("| 1") + 3;
    let s = state(DOC, at);
    const ref = selectedCell(s)!;
    let cs = EditorState.create({ doc: "1", selection: { anchor: 1 } });
    for (const ch of [" ", "b"]) {
      const tr = cs.update({
        changes: { from: cs.selection.main.head, insert: ch },
        selection: { anchor: cs.selection.main.head + 1 },
        userEvent: "input.type",
      });
      s = s.update(cellTransactionToMain(s, ref, tr)).state;
      cs = tr.state;
    }
    expect(s.doc.toString()).toContain("| 1 b | 2 |");
    expect(selectedCell(s)).toMatchObject({ row: 1, col: 0, head: 3 });
    let undone = s;
    undo({ state: s, dispatch: (t) => (undone = t.state) });
    expect(undone.doc.toString()).toBe(DOC);
  });

  it("선택만 바뀐 것도 본문 선택으로", () => {
    const at = DOC.indexOf("\\|") + 2;
    const main = state(DOC, at);
    const sel = selectedCell(main)!;
    const tr = cellTr("a | b", { selection: { anchor: 5 } });
    const next = main.update(cellTransactionToMain(main, sel, tr)).state;
    expect(next.doc.toString()).toBe(DOC);
    expect(selectedCell(next)).toMatchObject({ row: 0, col: 0, head: 5 });
  });

  it("본문 선택이 이미 다른 칸으로 갔으면(조합 중 다른 칸을 누름) 바뀐 글만 보내고 선택은 건드리지 않는다", () => {
    // 조합 중 글자(가)는 이미 본문에 들어가 있다 — 조합 단계마다 칸 편집기가 본문으로 보낸다
    const doc = DOC.replace("| 1 |", "| 1가 |");
    const at = doc.indexOf("| 1가") + 4;
    const main = state(doc, at);
    const ref = selectedCell(main)!;
    const elsewhere = doc.indexOf("| 2") + 3;
    const moved = main.update({ selection: { anchor: elsewhere } }).state;
    const tr = cellTr("1가", { changes: { from: 1, to: 2, insert: "각" }, selection: { anchor: 2 }, userEvent: "input.type.compose" });
    const next = moved.update(cellTransactionToMain(moved, ref, tr)).state;
    expect(next.doc.toString()).toContain("| 1각 | 2 |");
    expect(selectedCell(next)).toMatchObject({ row: 1, col: 1 });
  });

  it("모자란 칸에 치면 행에 칸을 붙이고 그 안에 넣는다(트랜잭션 하나)", () => {
    const doc = "| a | b |\n|---|---|\n| x |";
    let s = state(doc, 0);
    s = s.update({ effects: setVirtualCell.of({ table: 0, row: 1, col: 1 }), selection: { anchor: doc.length } }).state;
    const sel = selectedCell(s)!;
    const tr = cellTr("", { changes: { from: 0, insert: "가" }, selection: { anchor: 1 }, userEvent: "input.type" });
    const next = s.update(cellTransactionToMain(s, sel, tr)).state;
    expect(next.doc.toString()).toBe("| a | b |\n|---|---|\n| x | 가 |");
    expect(selectedCell(next)).toMatchObject({ row: 1, col: 1, anchor: 1, head: 1 });
    expect(undo({ state: next, dispatch: () => {} })).toBe(true);
  });

  it("칸에서 친 글자 여러 개는 한 번에 되돌아가고, 그 앞에 본문에서 친 것은 남는다", () => {
    let s = state(DOC, 1);
    s = s.update({ changes: { from: 1, insert: "X" }, selection: { anchor: 2 }, userEvent: "input.type", annotations: [Transaction.time.of(1000)] }).state;
    const into = s.doc.toString().indexOf("| 2") + 3;
    s = s.update({ selection: { anchor: into }, annotations: [Transaction.time.of(5000)] }).state;
    s = typeInCell(s, "가", 6000);
    s = typeInCell(s, "나", 6050);
    s = typeInCell(s, "다", 6100);
    expect(s.doc.toString()).toContain("| 2가나다 |");
    let after = s;
    undo({ state: s, dispatch: (tr) => (after = tr.state) });
    expect(after.doc.toString()).toBe("앞X" + DOC.slice(1));
  });
});

describe("칸 입력의 실행 취소 묶음은 칸 편집기의 시각을 따른다", () => {
  it("입력 사이가 묶음 간격보다 길면 따로 되돌아간다", () => {
    let s = state(DOC, DOC.indexOf("| 2") + 3);
    s = typeInCell(s, "가", 10_000);
    s = typeInCell(s, "나", 20_000);
    let after = s;
    undo({ state: s, dispatch: (tr) => (after = tr.state) });
    expect(after.doc.toString()).toContain("| 2가 |");
  });
});

describe("remapRef(바깥 변경이 표 구조를 바꿀 때 — 조합 중에는 본문 선택으로 다시 구하지 않는다)", () => {
  const model = (s: EditorState) => parseTable(s.doc, T, s.doc.length - "\n\n뒤".length)!;

  it("같은 표 앞에 행이 들어오면 행 번호를 따라간다", () => {
    const s = state(DOC, DOC.indexOf("| 2") + 3);
    const ref = selectedCell(s)!;
    const tr = s.update({ changes: insertRow(model(s), 0), annotations: [mirrored.of(true)] });
    expect(remapRef(s, tr.state, tr.changes, ref)).toEqual({ table: T, row: 2, col: 1 });
  });

  it("앞에 열이 들어오면 열 번호를, 표 앞에 글이 들어오면 표 위치를 따라간다", () => {
    const s = state(DOC, DOC.indexOf("| 2") + 3);
    const ref = selectedCell(s)!;
    const col = s.update({ changes: insertColumn(model(s), 0) });
    expect(remapRef(s, col.state, col.changes, ref)).toMatchObject({ row: 1, col: 2 });
    const before = s.update({ changes: { from: 0, insert: "새 글\n" } });
    expect(remapRef(s, before.state, before.changes, ref)).toEqual({ table: T + 4, row: 1, col: 1 });
  });

  it("다시 구한 ref 로 보낸 조합 글은 원래 셀에 들어간다(다른 행의 셀을 덮지 않는다)", () => {
    const s = state(DOC, DOC.indexOf("| 2") + 3);
    let ref: CellRef = selectedCell(s)!;
    const tr = s.update({ changes: insertRow(model(s), 0), annotations: [mirrored.of(true)] });
    ref = remapRef(s, tr.state, tr.changes, ref);
    const typed = cellTr("2", { changes: { from: 1, insert: "가" }, selection: { anchor: 2 }, userEvent: "input.type.compose" });
    const next = tr.state.update(cellTransactionToMain(tr.state, ref, typed)).state;
    expect(next.doc.toString()).toContain("| 1 | 2가 |");
    expect(next.doc.line(5).text).toBe("|  |  |");
  });

  it("셀이 사라지면(행 지움) 표 위치만 옮긴다", () => {
    const s = state(DOC, DOC.indexOf("| 2") + 3);
    const ref = selectedCell(s)!;
    const m = model(s);
    const tr = s.update({ changes: { from: m.body[0].from - 1, to: m.body[0].to } });
    expect(remapRef(s, tr.state, tr.changes, ref)).toEqual(ref);
  });
});

describe("shouldDefer", () => {
  it("조합 중이면 이동 키를 미룬다", () => {
    expect(shouldDefer(true, "Tab")).toBe(true);
    expect(shouldDefer(true, "Enter")).toBe(true);
    expect(shouldDefer(true, "ArrowDown")).toBe(true);
    expect(shouldDefer(true, "Escape")).toBe(true);
    expect(shouldDefer(false, "Tab")).toBe(false);
    expect(shouldDefer(true, "a")).toBe(false);
  });
});
