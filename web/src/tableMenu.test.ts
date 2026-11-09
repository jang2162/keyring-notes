import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { deleteColumn, deleteRow, insertColumn, insertRow, moveColumn, moveRow, parseTable, setAlign, sortRows } from "./tableModel";
import { applyAction, colMenu, dropIndex, rowMenu } from "./tableMenu";

const model = (doc: string) => parseTable(Text.of(doc.split("\n")), 0, doc.length)!;
const T = model("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |");
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe("rowMenu", () => {
  it("머리 행은 아래에 넣기만", () => {
    expect(keys(rowMenu(T, 0))).toEqual(["table.rowBelow"]);
  });
  it("본문 첫 행에는 위로 옮기기가 없고, 끝 행에는 아래로 옮기기가 없다", () => {
    expect(keys(rowMenu(T, 1))).toEqual(["table.rowAbove", "table.rowBelow", "table.rowDown", "table.rowDelete"]);
    expect(keys(rowMenu(T, 2))).toEqual(["table.rowAbove", "table.rowBelow", "table.rowUp", "table.rowDown", "table.rowDelete"]);
    expect(keys(rowMenu(T, 3))).toEqual(["table.rowAbove", "table.rowBelow", "table.rowUp", "table.rowDelete"]);
  });
  it("행 번호를 본문 번호(0부터)로 바꿔 작업한다", () => {
    const m = rowMenu(T, 2);
    expect(m.find((i) => i.key === "table.rowAbove")!.action).toEqual({ op: "insertRow", at: 1 });
    expect(m.find((i) => i.key === "table.rowBelow")!.action).toEqual({ op: "insertRow", at: 2 });
    expect(m.find((i) => i.key === "table.rowUp")!.action).toEqual({ op: "moveRow", from: 1, to: 0 });
    expect(m.find((i) => i.key === "table.rowDown")!.action).toEqual({ op: "moveRow", from: 1, to: 2 });
    expect(m.find((i) => i.key === "table.rowDelete")!.action).toEqual({ op: "deleteRow", i: 1 });
    expect(rowMenu(T, 0)[0].action).toEqual({ op: "insertRow", at: 0 });
  });
});

describe("colMenu", () => {
  it("첫 열에는 왼쪽으로 옮기기가 없고, 정렬 4개·sort 2개", () => {
    const k = keys(colMenu(T, 0));
    expect(k).not.toContain("table.colMoveLeft");
    expect(k).toContain("table.colMoveRight");
    expect(k).toContain("table.colDelete");
    for (const a of ["table.alignLeft", "table.alignCenter", "table.alignRight", "table.alignNone", "table.sortAsc", "table.sortDesc"]) expect(k).toContain(a);
  });
  it("끝 열에는 오른쪽으로 옮기기가 없다", () => {
    expect(keys(colMenu(T, 2))).not.toContain("table.colMoveRight");
  });
  it("열이 하나면 지우기가 없다", () => {
    const one = model("| a |\n|---|\n| 1 |");
    expect(keys(colMenu(one, 0))).not.toContain("table.colDelete");
    expect(keys(colMenu(one, 0))).not.toContain("table.colMoveLeft");
    expect(keys(colMenu(one, 0))).not.toContain("table.colMoveRight");
  });
});

describe("applyAction", () => {
  it("Task 5 함수와 같은 결과", () => {
    expect(applyAction(T, { op: "insertRow", at: 1 })).toEqual(insertRow(T, 1));
    expect(applyAction(T, { op: "deleteRow", i: 2 })).toEqual(deleteRow(T, 2));
    expect(applyAction(T, { op: "moveRow", from: 0, to: 2 })).toEqual(moveRow(T, 0, 2));
    expect(applyAction(T, { op: "insertColumn", at: 3 })).toEqual(insertColumn(T, 3));
    expect(applyAction(T, { op: "deleteColumn", col: 1 })).toEqual(deleteColumn(T, 1));
    expect(applyAction(T, { op: "moveColumn", from: 2, to: 0 })).toEqual(moveColumn(T, 2, 0));
    expect(applyAction(T, { op: "setAlign", col: 1, align: "center" })).toEqual(setAlign(T, 1, "center"));
    expect(applyAction(T, { op: "sort", col: 0, dir: "desc" })).toEqual(sortRows(T, 0, "desc"));
  });
});

describe("dropIndex: 끌어 놓은 자리 → 옮긴 뒤 번호", () => {
  // 행 3개의 가운데 y: 10, 30, 50(높이 20). 경계 0·20·40·60
  const mids = [10, 30, 50];
  it("자기 자리 근처면 그대로", () => {
    expect(dropIndex(mids, 1, 28)).toBe(1);
    expect(dropIndex(mids, 1, 35)).toBe(1);
  });
  it("위·아래로", () => {
    expect(dropIndex(mids, 2, 5)).toBe(0);
    expect(dropIndex(mids, 2, 25)).toBe(1);
    expect(dropIndex(mids, 0, 45)).toBe(1);
    expect(dropIndex(mids, 0, 55)).toBe(2);
    expect(dropIndex(mids, 0, 999)).toBe(2);
    expect(dropIndex(mids, 2, -50)).toBe(0);
  });
});
