import type { ChangeSet, ChangeSpec, Text } from "@codemirror/state";

/**
 * 표 편집기의 표 모델: 문서 글 → 표 구조·칸 구간, 칸 편집 → 문서 변경. 화면 없이 순수 함수라 Node 에서 시험한다.
 * 문서가 유일한 원본이고 이 모델은 문서를 읽은 결과일 뿐이다(설계 6.1). 화면은 tableWidget.ts·cellEditor.ts.
 *
 * 칸 나누기는 이스케이프되지 않은 `|` 기준이다. GFM 은 인라인 코드 안의 `|` 도 `\|` 로 써야 하므로 따로 다루지 않는다.
 */

export type Align = "left" | "center" | "right" | null;

/** 칸의 문서 구간: 앞뒤 공백을 뺀 글. 빈 칸은 from === to(여는 | 다음 공백 하나 뒤, 공백이 없으면 | 바로 뒤) */
export interface TableCell {
  from: number;
  to: number;
  raw: string;
}

/** 표의 줄 하나 */
export interface TableRow {
  from: number;
  to: number;
  text: string;
  cells: TableCell[];
}

export interface TableModel {
  from: number;
  to: number;
  header: TableRow;
  delim: TableRow;
  body: TableRow[];
  align: Align[];
  /** 구분 줄의 칸 수 */
  columns: number;
  /** 첫 줄이 | 로 시작하는가 */
  outerPipes: boolean;
}

/** 줄 하나를 | 로 나눈 것. segs 는 | 사이 글(공백 포함), lead/trail 은 바깥 | 가 있는가 */
export interface RowParts {
  /** 맨 앞 | 앞의 공백(lead 일 때만. 아니면 첫 칸 글에 든다) */
  indent: string;
  lead: boolean;
  segs: string[];
  /** 각 segs 의 줄 안 시작 위치 */
  starts: number[];
  trail: boolean;
  /** 맨 끝 | 뒤의 공백(trail 일 때만) */
  tail: string;
}

/** 줄을 이스케이프되지 않은 | 로 나눈다. `\` 는 다음 한 글자를 이스케이프한다 */
export function splitRow(text: string): RowParts {
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") pipes.push(i);
  }
  const first = /^\s*/.exec(text)![0].length;
  const last = text.trimEnd().length - 1;
  const lead = pipes.length > 0 && pipes[0] === first;
  const trail = pipes.length > 0 && pipes[pipes.length - 1] === last && (!lead || pipes.length > 1);
  const bounds = [lead ? pipes[0] : -1, ...pipes.slice(lead ? 1 : 0, trail ? -1 : undefined), trail ? pipes[pipes.length - 1] : text.length];
  const segs: string[] = [];
  const starts: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    starts.push(bounds[i] + 1);
    segs.push(text.slice(bounds[i] + 1, bounds[i + 1]));
  }
  return {
    indent: lead ? text.slice(0, first) : "",
    lead,
    segs,
    starts,
    trail,
    tail: trail ? text.slice(last + 1) : "",
  };
}

/**
 * RowParts 를 줄 글로. 바깥 | 가 없는데 첫·끝 칸이 공백뿐이면 | 를 붙인다 —
 * GFM 은 줄 앞뒤 공백을 떼고 맨 앞·맨 끝 | 를 테두리로 보므로, 그대로 쓰면 그 빈 칸이 사라진다
 */
export function joinRow(p: Pick<RowParts, "indent" | "lead" | "segs" | "trail" | "tail">): string {
  const blank = (s: string | undefined) => s === undefined || s.trim() === "";
  const lead = p.lead || blank(p.segs[0]);
  const trail = p.trail || blank(p.segs[p.segs.length - 1]);
  return (lead ? p.indent + "|" : "") + p.segs.join("|") + (trail ? "|" + p.tail : "");
}

/** 칸 글(공백 포함)의 줄 안 시작에서 칸 구간을 정한다 */
function cellOf(seg: string, start: number, lineFrom: number): TableCell {
  const lead = seg.length - seg.trimStart().length;
  const raw = seg.trim();
  const from = lineFrom + start + (raw ? lead : Math.min(1, seg.length));
  return { from, to: from + raw.length, raw };
}

function rowOf(doc: Text, lineNo: number): TableRow {
  const line = doc.line(lineNo);
  const p = splitRow(line.text);
  return { from: line.from, to: line.to, text: line.text, cells: p.segs.map((s, i) => cellOf(s, p.starts[i], line.from)) };
}

function alignOf(raw: string): Align {
  const l = raw.startsWith(":");
  const r = raw.endsWith(":");
  return l && r ? "center" : l ? "left" : r ? "right" : null;
}

/** from/to = lezer Table 노드. 줄이 셋 미만이어도(머리 + 구분 줄) 된다 */
export function parseTable(doc: Text, from: number, to: number): TableModel | null {
  const a = doc.lineAt(from).number;
  const z = doc.lineAt(to).number;
  if (z - a < 1) return null;
  const header = rowOf(doc, a);
  const delim = rowOf(doc, a + 1);
  const body: TableRow[] = [];
  for (let n = a + 2; n <= z; n++) body.push(rowOf(doc, n));
  return {
    from: header.from,
    to: doc.line(z).to,
    header,
    delim,
    body,
    align: delim.cells.map((c) => alignOf(c.raw)),
    columns: delim.cells.length,
    outerPipes: header.text.trimStart().startsWith("|"),
  };
}

/** 칸 원문 → 칸 편집기에 보일 글: `\|` → `|` */
export function cellText(raw: string): string {
  return raw.replace(/\\\|/g, "|");
}

/** 칸 글 위치 → 칸 원문 위치(`\|` 는 글 한 자, 원문 두 자) */
export function textToRawPos(raw: string, textPos: number): number {
  let t = 0;
  let r = 0;
  while (t < textPos && r < raw.length) {
    r += raw[r] === "\\" && raw[r + 1] === "|" ? 2 : 1;
    t++;
  }
  return r;
}

/** 칸 원문 위치 → 칸 글 위치. `\|` 가운데면 그 | 앞 */
export function rawToTextPos(raw: string, rawPos: number): number {
  let t = 0;
  let r = 0;
  while (r < rawPos && r < raw.length) {
    const step = raw[r] === "\\" && raw[r + 1] === "|" ? 2 : 1;
    if (r + step > rawPos) break;
    r += step;
    t++;
  }
  return t;
}

/** 칸에 넣을 글: `|` → `\|`, 줄바꿈 → `<br>`(칸에는 줄바꿈을 넣을 수 없다 — GFM 표 관례) */
export function escapeCellInput(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** 칸 편집기의 변경(칸 글 좌표)을 본문 변경으로. 이스케이프에 맞춰 위치를 옮긴다 */
export function cellChangesToDoc(cell: TableCell, changes: ChangeSet): ChangeSpec[] {
  const out: { from: number; to: number; insert: string }[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out.push({
      from: cell.from + textToRawPos(cell.raw, fromA),
      to: cell.from + textToRawPos(cell.raw, toA),
      insert: escapeCellInput(inserted.toString()),
    });
  });
  return out;
}

function rowAt(m: TableModel, row: number): TableRow {
  return row === 0 ? m.header : m.body[row - 1];
}

/**
 * row: 0 = 머리, 1.. = 본문. 칸이 모자란 행이면 칸을 붙이는 변경과 붙인 뒤 문서에서의 칸 위치.
 * 행 끝 공백 뒤가 아니라 글이 끝나는 자리에 붙인다(그 뒤 공백은 그대로 남는다)
 */
export function ensureCell(m: TableModel, row: number, col: number): { changes: ChangeSpec[]; at: number } {
  const r = rowAt(m, row);
  if (col < r.cells.length) return { changes: [], at: r.cells[col].from };
  const missing = col - r.cells.length + 1;
  const end = r.from + r.text.trimEnd().length;
  const p = splitRow(r.text);
  if (p.trail) {
    // "| x |" + "  |" … — 새 칸은 붙인 마지막 "  |" 의 첫 공백 뒤
    return { changes: [{ from: end, insert: "  |".repeat(missing) }], at: end + 3 * (missing - 1) + 1 };
  }
  // 바깥 | 가 없으면 "1" + " | " … — 끝 칸은 글이 들어가야 칸으로 읽힌다(공백뿐인 끝은 GFM 이 버린다)
  return { changes: [{ from: end, insert: " | ".repeat(missing) }], at: end + 3 * missing };
}

/** pos 가 한 칸 구간 안(양끝 포함)인가. 구분 줄과 | 위는 null */
export function cellAt(m: TableModel, pos: number): { row: number; col: number } | null {
  const rows = [m.header, ...m.body];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (pos < r.from || pos > r.to) continue;
    const col = r.cells.findIndex((c) => pos >= c.from && pos <= c.to);
    return col >= 0 ? { row: i, col } : null;
  }
  return null;
}
