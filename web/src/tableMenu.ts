import type { ChangeSpec } from "@codemirror/state";
import { deleteColumn, deleteRow, insertColumn, insertRow, moveColumn, moveRow, setAlign, sortRows, type Align, type TableModel } from "./tableModel";

/**
 * 표의 행·열 손잡이 메뉴 항목(설계 6.5). 화면 글 키와 작업만 정하고, 메뉴를 띄우는 것은 tableWidget.ts 다.
 * row: 0 = 머리, 1.. = 본문. 작업(TableAction)의 행 번호는 본문 번호(0부터)다
 */

export type TableAction =
  | { op: "insertRow"; at: number }
  | { op: "deleteRow"; i: number }
  | { op: "moveRow"; from: number; to: number }
  | { op: "insertColumn"; at: number }
  | { op: "deleteColumn"; col: number }
  | { op: "moveColumn"; from: number; to: number }
  | { op: "setAlign"; col: number; align: Align }
  | { op: "sort"; col: number; dir: "asc" | "desc" };

export interface MenuAction {
  key: string;
  action: TableAction;
}

/** 머리 행이면 아래에 넣기만(GFM 표는 머리 행이 반드시 있어 옮기거나 지울 수 없다). 첫/끝 행이면 위로/아래로 옮기기 없음 */
export function rowMenu(m: TableModel, row: number): MenuAction[] {
  if (row === 0) return [{ key: "table.rowBelow", action: { op: "insertRow", at: 0 } }];
  const i = row - 1;
  const out: MenuAction[] = [
    { key: "table.rowAbove", action: { op: "insertRow", at: i } },
    { key: "table.rowBelow", action: { op: "insertRow", at: i + 1 } },
  ];
  if (i > 0) out.push({ key: "table.rowUp", action: { op: "moveRow", from: i, to: i - 1 } });
  if (i < m.body.length - 1) out.push({ key: "table.rowDown", action: { op: "moveRow", from: i, to: i + 1 } });
  out.push({ key: "table.rowDelete", action: { op: "deleteRow", i } });
  return out;
}

/** 열이 하나면 지우기 없음(표를 통째로 지우려면 원문으로), 첫/끝 열이면 왼쪽/오른쪽 옮기기 없음 */
export function colMenu(m: TableModel, col: number): MenuAction[] {
  const out: MenuAction[] = [
    { key: "table.colLeft", action: { op: "insertColumn", at: col } },
    { key: "table.colRight", action: { op: "insertColumn", at: col + 1 } },
  ];
  if (col > 0) out.push({ key: "table.colMoveLeft", action: { op: "moveColumn", from: col, to: col - 1 } });
  if (col < m.columns - 1) out.push({ key: "table.colMoveRight", action: { op: "moveColumn", from: col, to: col + 1 } });
  if (m.columns > 1) out.push({ key: "table.colDelete", action: { op: "deleteColumn", col } });
  out.push(
    { key: "table.alignLeft", action: { op: "setAlign", col, align: "left" } },
    { key: "table.alignCenter", action: { op: "setAlign", col, align: "center" } },
    { key: "table.alignRight", action: { op: "setAlign", col, align: "right" } },
    { key: "table.alignNone", action: { op: "setAlign", col, align: null } },
    { key: "table.sortAsc", action: { op: "sort", col, dir: "asc" } },
    { key: "table.sortDesc", action: { op: "sort", col, dir: "desc" } },
  );
  return out;
}

export function applyAction(m: TableModel, a: TableAction): ChangeSpec[] {
  switch (a.op) {
    case "insertRow":
      return insertRow(m, a.at);
    case "deleteRow":
      return deleteRow(m, a.i);
    case "moveRow":
      return moveRow(m, a.from, a.to);
    case "insertColumn":
      return insertColumn(m, a.at);
    case "deleteColumn":
      return deleteColumn(m, a.col);
    case "moveColumn":
      return moveColumn(m, a.from, a.to);
    case "setAlign":
      return setAlign(m, a.col, a.align);
    case "sort":
      return sortRows(m, a.col, a.dir);
  }
}

/** 끌어 옮기기: 항목들의 가운데 좌표(mids)와 놓은 좌표로, 끌던 항목(from)이 옮겨 갈 번호. 다른 항목 중 가운데가 놓은 자리보다 앞인 것의 수 */
export function dropIndex(mids: number[], from: number, at: number): number {
  return mids.filter((mid, i) => i !== from && mid < at).length;
}
