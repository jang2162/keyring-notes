import type { EditorState } from "@codemirror/state";
import { cellAt, insertRow, parseTable, splitRow, type TableCell, type TableModel } from "./tableModel";
import { tableRanges } from "./tableWidget";

/**
 * 표 편집기의 키보드 이동 판정(설계 6.4). 화면 없이 정하는 순수 함수이고, 키맵에 붙이는 것은 cellEditor.ts 다.
 * row: 0 = 머리, 1.. = 본문
 */

export type NavKey = "Tab" | "Shift-Tab" | "Enter" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
export type NavResult = { kind: "cell"; row: number; col: number } | { kind: "newRow" } | { kind: "exit"; where: "before" | "after" } | { kind: "stay" };

/** atStart/atEnd: 칸 글의 처음/끝에 커서가 있는가(← → 에만 쓴다) */
export function navigate(m: TableModel, row: number, col: number, key: NavKey, atStart: boolean, atEnd: boolean): NavResult {
  const last = m.body.length;
  const lastCol = m.columns - 1;
  const cell = (r: number, c: number): NavResult => ({ kind: "cell", row: r, col: c });
  switch (key) {
    case "Tab":
      if (col < lastCol) return cell(row, col + 1);
      return row < last ? cell(row + 1, 0) : { kind: "newRow" };
    case "Shift-Tab":
      if (col > 0) return cell(row, col - 1);
      return row > 0 ? cell(row - 1, lastCol) : { kind: "stay" };
    case "Enter":
      return row < last ? cell(row + 1, col) : { kind: "newRow" };
    case "ArrowUp":
      return row > 0 ? cell(row - 1, col) : { kind: "exit", where: "before" };
    case "ArrowDown":
      return row < last ? cell(row + 1, col) : { kind: "exit", where: "after" };
    case "ArrowLeft":
      return atStart && col > 0 ? cell(row, col - 1) : { kind: "stay" };
    case "ArrowRight":
      return atEnd && col < lastCol ? cell(row, col + 1) : { kind: "stay" };
  }
}

/** 표 끝에 빈 행을 넣고 그 행의 col 칸에 커서를 두는 본문 트랜잭션(실행 취소 한 번) */
export function newRowSpec(m: TableModel, col: number): { changes: { from: number; insert: string }; selection: { anchor: number } } {
  const [change] = insertRow(m, m.body.length) as { from: number; insert: string }[];
  // insert = "\n" + 새 줄. 새 줄의 칸은 모두 빈 칸이라 자리는 여는 | 뒤 공백 하나 다음이다(tableModel 의 빈 칸 규칙)
  const p = splitRow(change.insert.slice(1));
  const i = Math.min(col, p.segs.length - 1);
  return { changes: change, selection: { anchor: change.from + 1 + p.starts[i] + Math.min(1, p.segs[i].length) } };
}

/**
 * 표 밖으로 나갈 자리: 앞 줄 끝 / 뒤 줄 처음. 표가 문서 끝이면 뒤에 빈 줄을 하나 만든다(빈 줄은 표를 끝낸다).
 * 표가 문서 맨 앞이라 앞 줄이 없으면 null
 */
export function exitTarget(
  state: EditorState,
  m: TableModel,
  where: "before" | "after",
): { selection: { anchor: number }; changes?: { from: number; insert: string } } | null {
  if (where === "before") return m.from > 0 ? { selection: { anchor: m.from - 1 } } : null;
  if (m.to < state.doc.length) return { selection: { anchor: m.to + 1 } };
  return { changes: { from: m.to, insert: "\n" }, selection: { anchor: m.to + 1 } };
}

/** 본문 줄 lineNo(1부터)에서 ↓/↑ 를 눌렀을 때 들어갈 칸 자리: 바로 아래 표의 머리 첫 칸 / 바로 위 표의 마지막 행 첫 칸. 아니면 null */
export function enterTableFrom(state: EditorState, lineNo: number, dir: "up" | "down"): number | null {
  const line = state.doc.line(lineNo);
  const tb = tableRanges(state).find((x) => (dir === "down" ? x.from === line.to + 1 : x.to + 1 === line.from));
  const m = tb && parseTable(state.doc, tb.from, tb.to);
  if (!m) return null;
  const row = dir === "down" ? m.header : (m.body[m.body.length - 1] ?? m.header);
  return row.cells[0]?.from ?? null;
}

/** cells 가운데 pos 에 가장 가까운 것의 번호(같으면 앞) */
function nearest(cells: TableCell[], pos: number): number {
  let best = 0;
  let dist = Infinity;
  cells.forEach((c, i) => {
    const d = pos < c.from ? c.from - pos : pos > c.to ? pos - c.to : 0;
    if (d < dist) [best, dist] = [i, d];
  });
  return best;
}

/**
 * 본문 커서가 그린 표 안이면서 어느 셀에도 들지 않는 자리(| 위·뒤, 구분 줄)면 옮길 셀 자리. 셀 안이면 null(설계 6.2).
 * 같은 행의 가장 가까운 셀로 — 셀 앞이면 셀 처음, 뒤면 셀 끝. 구분 줄은 머리 행의 같은 열 셀 끝.
 * 그래서 앞 줄 끝에서 →(표 처음)는 머리 첫 셀 처음, 뒤 줄 처음에서 ←(표 끝)는 마지막 행 마지막 셀 끝이 된다(↑↓ 와 같은 진입)
 */
export function snapToCell(m: TableModel, pos: number): number | null {
  if (pos < m.from || pos > m.to || cellAt(m, pos)) return null;
  if (pos >= m.delim.from && pos <= m.delim.to) {
    const cells = m.header.cells;
    return cells[Math.min(nearest(m.delim.cells, pos), cells.length - 1)].to;
  }
  const row = [m.header, ...m.body].find((r) => pos >= r.from && pos <= r.to);
  if (!row?.cells.length) return null;
  const c = row.cells[nearest(row.cells, pos)];
  return pos < c.from ? c.from : c.to;
}
