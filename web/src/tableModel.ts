import type { ChangeSet, ChangeSpec, Text } from "@codemirror/state";
import { diffChange } from "./mirror";

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
  // 칸이 하나뿐이면 | 가 하나는 있어야 표 줄로 읽힌다
  const trail = p.trail || blank(p.segs[p.segs.length - 1]) || (p.segs.length === 1 && !lead);
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
export function cellChangesToDoc(cell: TableCell, changes: ChangeSet): { from: number; to: number; insert: string }[] {
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

// ── 행·열 작업. 모두 본문 트랜잭션 하나에 넣을 ChangeSpec[] 를 돌려준다(원래 문서 좌표). 본문 행 번호 i 는 0부터 ──
// 파일에 쓰는 범위는 설계 6.5 「파일에 쓰는 범위」 그대로다 — 표 전체를 다시 써 | 사이 공백을 맞추지 않는다

/** 줄을 새 글로: 앞뒤 같은 부분을 빼고 달라진 곳만 */
function lineChange(row: TableRow, next: string): ChangeSpec[] {
  const d = diffChange(row.text, next);
  return d ? [{ from: row.from + d.from, to: row.from + d.to, insert: d.insert }] : [];
}

/** 표의 모든 줄(머리·구분·본문)을 칸 목록 고치기로 다시 쓴다. edit 이 null 을 돌려주면 그 줄은 그대로 */
function rewriteRows(m: TableModel, edit: (segs: string[], kind: "header" | "delim" | "body") => string[] | null): ChangeSpec[] {
  const out: ChangeSpec[] = [];
  const rows: [TableRow, "header" | "delim" | "body"][] = [[m.header, "header"], [m.delim, "delim"], ...m.body.map((r) => [r, "body"] as [TableRow, "body"])];
  for (const [row, kind] of rows) {
    const p = splitRow(row.text);
    const segs = edit([...p.segs], kind);
    if (segs) out.push(...lineChange(row, joinRow({ ...p, segs })));
  }
  return out;
}

const EMPTY = "  ";

function emptyRow(m: TableModel): string {
  const p = splitRow(m.header.text);
  return joinRow({ indent: p.indent, lead: p.lead, segs: Array<string>(m.columns).fill(EMPTY), trail: p.trail, tail: "" });
}

function lastLine(m: TableModel): TableRow {
  return m.body.length ? m.body[m.body.length - 1] : m.delim;
}

/** at: 0..body.length. 빈 칸은 "  " */
export function insertRow(m: TableModel, at: number): ChangeSpec[] {
  const line = emptyRow(m);
  if (at < m.body.length) return [{ from: m.body[at].from, insert: line + "\n" }];
  return [{ from: lastLine(m).to, insert: "\n" + line }];
}

export function deleteRow(m: TableModel, i: number): ChangeSpec[] {
  const r = m.body[i];
  // 앞 줄(구분 줄이나 앞 행)이 늘 있으므로 앞 줄바꿈과 함께 지운다 — 문서 끝 줄도 같은 방법으로 된다
  return [{ from: r.from - 1, to: r.to }];
}

/** 본문 행 from 을 to 자리(옮긴 뒤 번호)로. 옮긴 줄 하나를 지우고 넣는다 — 그 사이 줄은 글이 그대로다 */
export function moveRow(m: TableModel, from: number, to: number): ChangeSpec[] {
  if (from === to) return [];
  const r = m.body[from];
  const del = { from: r.from - 1, to: r.to };
  if (to < from) return [{ from: m.body[to].from, insert: r.text + "\n" }, del];
  return [del, { from: m.body[to].to, insert: "\n" + r.text }];
}

/** at: 0..columns. 칸이 모자란 행은 그 자리가 칸 수를 넘으면 그대로 둔다(없는 칸은 빈 칸이다) */
export function insertColumn(m: TableModel, at: number): ChangeSpec[] {
  return rewriteRows(m, (segs, kind) => {
    if (kind === "body" && at > segs.length) return null;
    segs.splice(Math.min(at, segs.length), 0, kind === "delim" ? " --- " : EMPTY);
    return segs;
  });
}

/** columns > 1 일 때만 부른다 */
export function deleteColumn(m: TableModel, col: number): ChangeSpec[] {
  return rewriteRows(m, (segs) => {
    if (col >= segs.length) return null;
    segs.splice(col, 1);
    return segs;
  });
}

/** 열 from 을 to 자리로. 칸 글과 양옆 공백을 통째로 옮긴다. 모자란 행은 빈 칸을 채워 옮긴다 */
export function moveColumn(m: TableModel, from: number, to: number): ChangeSpec[] {
  if (from === to) return [];
  const hi = Math.max(from, to);
  return rewriteRows(m, (segs) => {
    if (segs.length <= Math.min(from, to)) return null;
    while (segs.length <= hi) segs.push(EMPTY);
    const [moved] = segs.splice(from, 1);
    segs.splice(to, 0, moved);
    return segs;
  });
}

/** 구분 줄의 그 칸만 :---·:---:·---:·--- 로. 원래 - 개수를 지킨다(최소 3) */
export function setAlign(m: TableModel, col: number, align: Align): ChangeSpec[] {
  const p = splitRow(m.delim.text);
  const seg = p.segs[col];
  if (seg === undefined) return [];
  const ws = /^(\s*)(.*?)(\s*)$/.exec(seg)!;
  const dashes = "-".repeat(Math.max(3, (ws[2].match(/-/g) ?? []).length));
  const body = (align === "left" || align === "center" ? ":" : "") + dashes + (align === "right" || align === "center" ? ":" : "");
  p.segs[col] = ws[1] + body + ws[3];
  return lineChange(m.delim, joinRow(p));
}

/** 칸 원문 → 정렬에 쓸 보이는 글(마크다운 기호를 뺀 글) */
export function visibleText(raw: string): string {
  return raw
    .replace(/\\\|/g, "|")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/!?\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__|~~|==|`/g, "")
    .replace(/\*|(?<!\w)_|_(?!\w)/g, "")
    .replace(/\\(.)/g, "$1")
    .trim();
}

/** 앞뒤 공백, 쉼표 천 단위, 부호, 소수, 끝의 % 를 허용한 숫자. 아니면 null */
function asNumber(s: string): number | null {
  const m = /^\s*([+-]?)(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*%?\s*$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  return Number(m[1] + (m[2] ?? "0").replace(/,/g, "") + (m[3] ?? ""));
}

/** 둘 다 숫자로 읽히면 숫자로, 아니면 localeCompare(numeric·base) */
export function compareCells(a: string, b: string): number {
  const x = asNumber(a);
  const y = asNumber(b);
  if (x !== null && y !== null) return x - y;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** 본문 행만 안정 정렬. 빈 칸은 오름·내림 어느 쪽이든 맨 뒤. 순서가 바뀐 줄만 고친다 */
export function sortRows(m: TableModel, col: number, dir: "asc" | "desc"): ChangeSpec[] {
  const keyed = m.body.map((r) => ({ r, key: visibleText(r.cells[col]?.raw ?? "") }));
  const sign = dir === "asc" ? 1 : -1;
  const sorted = [...keyed].sort((a, b) => {
    if (!a.key || !b.key) return Number(!a.key) - Number(!b.key);
    return sign * compareCells(a.key, b.key);
  });
  return m.body.flatMap((r, i) => (sorted[i].r === r ? [] : [{ from: r.from, to: r.to, insert: sorted[i].r.text }]));
}
