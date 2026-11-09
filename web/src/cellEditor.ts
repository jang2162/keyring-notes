import { acceptCompletion, autocompletion, completionStatus } from "@codemirror/autocomplete";
import { defaultKeymap, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { Annotation, ChangeSet, EditorSelection, EditorState, Prec, Transaction, type Extension, type TransactionSpec } from "@codemirror/state";
import { drawSelection, EditorView, keymap, runScopeHandlers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { headingStyle, insertLink, wikilinkSource, wrapSelection } from "./editorCommands";
import { t } from "./i18n";
import type { LiveRenderContext } from "./liveBlocks";
import { codeFont } from "./livePreview";
import { diffChange } from "./mirror";
import {
  cellAt,
  cellText,
  ensureCell,
  escapeCellInput,
  parseTable,
  rawToTextPos,
  textToRawPos,
  type TableCell,
  type TableModel,
  type TableRow,
} from "./tableModel";
import { enterTableFrom, exitTarget, navigate, newRowSpec, type NavKey } from "./tableNav";
import {
  cellClick,
  paintCell,
  setVirtualCell,
  showHandles,
  tableAtDOM,
  tableRanges,
  topTables,
  virtualField,
  type CellRef,
  type TableOptions,
} from "./tableWidget";

/**
 * 표의 칸 편집기: 본문 선택이 표의 한 칸 안에 있으면 그 칸 자리에 CodeMirror 편집기 하나를 붙인다(설계 6.2·6.3).
 *
 * - 본문 문서가 유일한 원본이다. 칸에서 친 것은 cellTransactionToMain 으로 본문 트랜잭션이 되어 본문 뷰에 들어가고,
 *   그래서 저장·미러링·실행 취소가 본문 경로 그대로 돈다. 칸 편집기에는 자기 실행 취소 기록이 없다.
 * - 칸을 여는 길은 하나 — 본문 선택이 칸 안에 들어오는 것이다(칸 누르기·실행 취소·찾기·이동 모두).
 * - 고치는 칸은 원문이다(설계 6.3, 사용자): Live Preview 의 기호 숨기기·줄 안 장식을 붙이지 않는다.
 * - 한글 조합 중에는 칸 편집기를 떼거나 내용을 맞추지 않고, 조합이 끝난 뒤 본문에 맞춘다.
 */

type GetCtx = () => LiveRenderContext | null;
type CellClick = { x: number; y: number; edge: "start" | "end" | null };

/** 칸 편집기에서 온 본문 트랜잭션 */
const fromCell = Annotation.define<boolean>();
/** 본문 → 칸 편집기로 맞추는 트랜잭션(다시 본문으로 보내지 않는다) */
const syncAnn = Annotation.define<boolean>();

function rowOf(m: TableModel, row: number): TableRow | undefined {
  return row === 0 ? m.header : m.body[row - 1];
}

/** 표 from 으로 지금 문서의 표 모델 */
function modelAt(state: EditorState, table: number): TableModel | null {
  const tb = topTables(state).find((x) => x.from <= table && table <= x.to);
  return tb ? parseTable(state.doc, tb.from, tb.to) : null;
}

/** 본문 선택이 한 칸 안이면 그 칸(표 from, row, col)과 칸 글 좌표의 선택. 여러 칸·표 밖에 걸치면 null */
export function selectedCell(state: EditorState): (CellRef & { anchor: number; head: number }) | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  const { anchor, head } = state.selection.main;
  const v = state.field(virtualField, false);
  if (v && anchor === v.pos && head === v.pos) return { table: v.table, row: v.row, col: v.col, anchor: 0, head: 0 };
  const lo = Math.min(anchor, head);
  const hi = Math.max(anchor, head);
  const tb = tableRanges(state).find((x) => x.from <= lo && hi <= x.to);
  const m = tb && parseTable(state.doc, tb.from, tb.to);
  if (!m) return null;
  const a = cellAt(m, anchor);
  const h = cellAt(m, head);
  if (!a || !h || a.row !== h.row || a.col !== h.col || a.col >= m.columns) return null;
  const cell = rowOf(m, a.row)!.cells[a.col];
  return { table: m.from, row: a.row, col: a.col, anchor: rawToTextPos(cell.raw, anchor - cell.from), head: rawToTextPos(cell.raw, head - cell.from) };
}

/**
 * 칸 편집기 글의 위치 → 칸 원문 위치. 칸 편집기 글의 앞뒤 공백은 원문에 없으므로 그 안의 위치는 원문 처음·끝으로 붙인다.
 * 원문은 칸 글을 escapeCellInput 한 것이므로 그 위치 앞부분을 이스케이프한 길이가 곧 원문 위치다(줄바꿈 → <br> 도 따른다)
 */
export function cellPosToRaw(text: string, p: number): number {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return escapeCellInput(trimmed.slice(0, Math.min(Math.max(p - lead, 0), trimmed.length))).length;
}

/**
 * 칸 편집기 트랜잭션 → 본문 트랜잭션. 바뀐 자리만 바꾸고(칸 전체 바꾸기가 아니다) userEvent·시각을 그대로 옮겨,
 * 칸에서 친 글자도 본문 history() 의 같은 묶음 규칙으로 묶인다(설계 6.3 실행 취소).
 * 칸이 모자란 행의 빈 자리면 행에 칸을 붙이는 변경을 같은 트랜잭션 앞에 둔다
 */
export function cellTransactionToMain(main: EditorState, ref: CellRef, tr: Transaction): TransactionSpec {
  const m = modelAt(main, ref.table);
  const row = m && rowOf(m, ref.row);
  if (!m || !row) return {};
  let cell: TableCell | undefined = row.cells[ref.col];
  let pre: ChangeSet | null = null;
  if (!cell) {
    // 빈 자리는 글을 칠 때까지 문서에 없다 — 선택만 바뀐 것은 본문에 옮길 것이 없다
    if (!tr.docChanged) return {};
    const e = ensureCell(m, ref.row, ref.col);
    pre = ChangeSet.of(e.changes, main.doc.length);
    cell = { from: e.at, to: e.at, raw: "" };
  }
  const base = cell;
  // 칸 편집기의 새 글을 원문으로 바꿔 지금 칸 원문과의 차이만 보낸다. 바뀐 자리가 그대로 나오므로 연달아 친 글자는
  // 본문 history 의 묶음 규칙(이웃한 변경)대로 묶인다. 앞뒤 공백은 | 옆 여백이라 칸 글이 아니다 — 끝에 친 공백은
  // 다음 글자와 함께 들어간다(공백만으로는 문서를 바꾸지 않는다)
  const next = tr.state.doc.toString();
  const d = diffChange(base.raw, escapeCellInput(next.trim()));
  let changes = ChangeSet.of(d ? [{ from: base.from + d.from, to: base.from + d.to, insert: d.insert }] : [], pre ? pre.newLength : main.doc.length);
  if (pre) changes = pre.compose(changes);
  const pos = (p: number) => base.from + cellPosToRaw(next, p);
  const sel = tr.newSelection.main;
  const userEvent = tr.annotation(Transaction.userEvent);
  // 본문 선택이 이미 이 칸을 떠났으면(조합 중 다른 칸을 누른 뒤 조합이 확정된 경우) 바뀐 글만 보낸다 — 선택까지 보내면 누른 칸 대신 이 칸으로 되돌아온다
  const here = selectedCell(main);
  const mine = !!here && here.table === ref.table && here.row === ref.row && here.col === ref.col;
  return {
    changes,
    ...(mine ? { selection: EditorSelection.single(pos(sel.anchor), pos(sel.head)) } : {}),
    annotations: [
      fromCell.of(true),
      Transaction.time.of(tr.annotation(Transaction.time) ?? Date.now()),
      ...(userEvent ? [Transaction.userEvent.of(userEvent)] : []),
    ],
  };
}

const NAV_KEYS = new Set(["Tab", "Shift-Tab", "Enter", "Shift-Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]);

/** 조합 중이면 이동 키·다시 그리기를 미룬다(조합 중인 글자가 사라지거나 다른 칸으로 튀지 않게 — Review Focus 1) */
export function shouldDefer(composing: boolean, key: string): boolean {
  return composing && NAV_KEYS.has(key);
}

export interface ActiveCell {
  /** 칸 편집기의 커서 자리에 글을 넣는다(줄바꿈은 <br>, | 는 \| 로 들어간다) */
  insert(text: string): void;
  /** 칸 편집기를 닫고 본문 커서를 표 끝(마지막 줄 끝)에 둔다. 그 위치를 돌려준다 */
  exitAfterTable(): number;
}

const plugins = new WeakMap<EditorView, CellPlugin>();

/** 이 본문 뷰에 열린 칸 편집기. 없으면 null(Editor.tsx 의 insertText 가 칸으로 보낼지 정한다 — 설계 6.3.2) */
export function activeCell(view: EditorView): ActiveCell | null {
  const p = plugins.get(view);
  if (!p?.cell) return null;
  return { insert: (text) => p.insert(text), exitAfterTable: () => p.exitAfterTable() };
}

interface Open {
  ref: CellRef;
  view: EditorView;
  td: HTMLElement;
}

class CellPlugin {
  cell: Open | null = null;
  private queued = false;
  private destroyed = false;

  constructor(
    readonly main: EditorView,
    readonly getCtx: GetCtx,
    readonly opts: TableOptions,
  ) {
    plugins.set(main, this);
    this.schedule();
  }

  update(u: ViewUpdate) {
    if (this.cell && u.docChanged) this.cell.ref = { ...this.cell.ref, table: u.changes.mapPos(this.cell.ref.table) };
    let click: CellClick | undefined;
    for (const tr of u.transactions) for (const e of tr.effects) if (e.is(cellClick)) click = e.value;
    // 표가 화면 밖으로 나갔다 오거나 폭이 바뀌면 CodeMirror 가 표 위젯 DOM 을 새로 만든다 — 칸 편집기가 옛 DOM 에 남으면 다시 연다
    const lost = !!this.cell && !this.cell.td.isConnected;
    if (u.docChanged || u.selectionSet || click || u.viewportChanged || lost) this.schedule(click);
  }

  /** 본문 갱신이 DOM 에 반영된 뒤에 맞춘다(플러그인 update 때는 표 위젯 DOM 이 아직 옛것이다) */
  schedule(click?: CellClick) {
    if (click) this.click = click;
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const c = this.click;
      this.click = undefined;
      this.sync(c);
    });
  }
  private click: CellClick | undefined;
  /** 칸 편집기에 포커스가 있었는가(DOM 이 떼어지면 blur 없이 사라지므로 따로 기억한다) */
  private cellFocused = false;

  sync(click?: CellClick) {
    if (this.destroyed) return;
    // 조합 중에는 아무것도 바꾸지 않는다 — compositionend 뒤에 다시 맞춘다
    if (this.cell?.view.composing) return;
    const sel = selectedCell(this.main.state);
    if (!sel) return this.close();
    const c = this.cell;
    if (c && c.td.isConnected && c.ref.table === sel.table && c.ref.row === sel.row && c.ref.col === sel.col) {
      this.pull(sel);
      if (click) this.placeAt(click);
      return;
    }
    // 떨어져 나간 칸 편집기는 포커스를 잃었으므로 그 전에 포커스가 있었는지(cellFocused)로 정한다
    const focus = !!click || !!c?.view.hasFocus || this.main.hasFocus || (!!c && !c.td.isConnected && this.cellFocused);
    this.close(false);
    this.open(sel, focus, click);
  }

  /** 칸의 원문(빈 자리면 "") */
  private rawOf(ref: CellRef): string | null {
    const m = modelAt(this.main.state, ref.table);
    const row = m && rowOf(m, ref.row);
    if (!m || !row) return null;
    return row.cells[ref.col]?.raw ?? "";
  }

  /** 그 칸의 td. 표가 화면 밖이라 그려지지 않았으면 null */
  private findTd(ref: CellRef): HTMLElement | null {
    for (const wrap of this.main.contentDOM.querySelectorAll<HTMLElement>(".cm-lp-table")) {
      const pos = this.main.posAtDOM(wrap);
      const tb = topTables(this.main.state).find((x) => x.from <= pos && pos <= x.to);
      if (tb?.from !== ref.table) continue;
      return wrap.querySelector<HTMLElement>(`[data-row="${ref.row}"][data-col="${ref.col}"]`);
    }
    return null;
  }

  private open(sel: CellRef & { anchor: number; head: number }, focus: boolean, click?: CellClick) {
    const td = this.findTd(sel);
    const raw = this.rawOf(sel);
    if (!td || raw === null) return;
    td.classList.add("cm-lp-cell-editing");
    td.textContent = "";
    const ref = { table: sel.table, row: sel.row, col: sel.col };
    const view = new EditorView({
      parent: td,
      state: EditorState.create({ doc: cellText(raw), selection: { anchor: sel.anchor, head: sel.head }, extensions: this.extensions() }),
      dispatchTransactions: (trs, v) => this.fromCellEditor(trs, v),
    });
    this.cell = { ref, view, td };
    // 터치에서는 마우스를 올릴 수 없으므로 편집 중인 칸의 행·열에 손잡이를 둔다
    showHandles(td);
    if (click) this.placeAt(click);
    if (focus) view.focus();
  }

  private placeAt(click: CellClick) {
    const v = this.cell?.view;
    if (v && click.edge) {
      v.dispatch({ selection: { anchor: click.edge === "end" ? v.state.doc.length : 0 } });
      return;
    }
    // 칸 여백(글 위·아래)을 눌러도 가장 가까운 글자 자리로
    const p = v?.posAtCoords(click, false);
    if (v && p != null) v.dispatch({ selection: { anchor: p } });
  }

  /** 본문 → 칸: 칸 글과 선택을 본문에 맞춘다(같으면 아무것도 하지 않는다) */
  private pull(sel: { anchor: number; head: number }) {
    const c = this.cell!;
    const raw = this.rawOf(c.ref);
    if (raw === null) return;
    const cur = c.view.state.doc.toString();
    const text = cellText(raw);
    // 앞뒤 공백만 다르면 같은 글이다(칸 끝에 막 친 공백을 지우지 않는다)
    const target = cur.trim() === text ? cur : text;
    const d = diffChange(cur, target);
    const s = c.view.state.selection.main;
    const rawPos = (p: number) => textToRawPos(raw, p);
    // 칸 편집기의 선택이 본문 선택과 같은 원문 자리를 가리키면 그대로 둔다
    if (!d && cellPosToRaw(cur, s.anchor) === rawPos(sel.anchor) && cellPosToRaw(cur, s.head) === rawPos(sel.head)) return;
    const lead = target.length - target.trimStart().length;
    const clamp = (p: number) => Math.min(p + lead, target.length);
    c.view.dispatch({ changes: d ?? [], selection: { anchor: clamp(sel.anchor), head: clamp(sel.head) }, annotations: syncAnn.of(true) });
  }

  /** 칸 → 본문. 칸 편집기에도 바로 적용한다 — 조합(IME) 중인 글자를 본문에서 되받아 다시 그리면 조합이 끊긴다 */
  private fromCellEditor(trs: readonly Transaction[], v: EditorView) {
    v.update(trs);
    const c = this.cell;
    if (!c || c.view !== v) return;
    for (const tr of trs) {
      if (tr.annotation(syncAnn) || (!tr.docChanged && !tr.selection)) continue;
      const spec = cellTransactionToMain(this.main.state, c.ref, tr);
      if (spec.changes || spec.selection) this.main.dispatch(spec);
    }
  }

  /** 칸 편집기의 이동 키. false 면 칸 편집기의 기본 동작(커서 이동 등)에 맡긴다 */
  private nav(key: NavKey | "Shift-Enter" | "Escape", v: EditorView): boolean {
    if (shouldDefer(v.composing, key)) return false;
    const c = this.cell;
    if (!c || c.view !== v) return false;
    if (key === "Tab" && completionStatus(v.state) === "active") return acceptCompletion(v);
    // 칸에는 줄바꿈을 넣을 수 없다 — GFM 표 관례대로 <br>
    if (key === "Shift-Enter") {
      v.dispatch(v.state.replaceSelection("<br>"), { userEvent: "input", scrollIntoView: true });
      return true;
    }
    const m = modelAt(this.main.state, c.ref.table);
    if (!m) return false;
    if (key === "Escape") return this.exit(m, "after");
    const sel = v.state.selection.main;
    // 칸 글이 여러 줄로 감겼으면 ↑↓ 는 먼저 칸 안에서 움직인다
    if ((key === "ArrowUp" || key === "ArrowDown") && movesWithin(v, key === "ArrowDown")) return false;
    if ((key === "ArrowLeft" || key === "ArrowRight") && !sel.empty) return false;
    const r = navigate(m, c.ref.row, c.ref.col, key, sel.head === 0, sel.head === v.state.doc.length);
    if (r.kind === "stay") return key === "Tab" || key === "Shift-Tab" || key === "Enter";
    if (r.kind === "exit") return this.exit(m, r.where);
    if (r.kind === "newRow") {
      this.main.dispatch({ ...newRowSpec(m, key === "Tab" ? 0 : c.ref.col), userEvent: "input", scrollIntoView: true });
      return true;
    }
    const row = rowOf(m, r.row)!;
    const cell = row.cells[r.col];
    // → 로 오면 칸 처음, 나머지는 칸 끝
    if (cell) this.main.dispatch({ selection: { anchor: key === "ArrowRight" ? cell.from : cell.to }, scrollIntoView: true });
    else
      this.main.dispatch({
        selection: { anchor: row.from + row.text.trimEnd().length },
        effects: setVirtualCell.of({ table: m.from, row: r.row, col: r.col }),
        scrollIntoView: true,
      });
    return true;
  }

  /** 칸 편집을 끝내고 본문 커서를 표 앞 줄 끝 / 뒤 줄 처음에. 앞 줄이 없으면 그대로 */
  private exit(m: TableModel, where: "before" | "after"): boolean {
    const target = exitTarget(this.main.state, m, where);
    if (!target) return true;
    this.main.dispatch({ ...target, scrollIntoView: true });
    this.main.focus();
    return true;
  }

  close(focusMain = false) {
    const c = this.cell;
    if (!c) return;
    this.cell = null;
    const hadFocus = c.view.hasFocus;
    c.view.destroy();
    c.td.classList.remove("cm-lp-cell-editing");
    // 표 위치(ref.table)는 변경으로 옮긴 값이라 문서를 통째로 바꾼 뒤에는 어긋난다 — 그 칸이 든 표 위젯에서 지금 모델을 다시 읽는다
    const wrap = c.td.closest<HTMLElement>(".cm-lp-table");
    const m = wrap?.isConnected ? tableAtDOM(this.main, wrap) : null;
    const row = m && rowOf(m, c.ref.row);
    paintCell(c.td, row?.cells[c.ref.col]?.raw ?? "", this.getCtx());
    if (focusMain || hadFocus) this.main.focus();
  }

  insert(text: string) {
    const v = this.cell?.view;
    if (!v) return;
    v.dispatch(v.state.replaceSelection(text), { userEvent: "input", scrollIntoView: true });
    v.focus();
  }

  exitAfterTable(): number {
    const c = this.cell;
    const m = c && modelAt(this.main.state, c.ref.table);
    const end = m ? m.to : this.main.state.selection.main.head;
    this.main.dispatch({ selection: { anchor: end } });
    this.close(true);
    return end;
  }

  /** 붙여넣은·끌어 놓은 파일: 자리 표시(줄바꿈 없는 글)를 넣고, 올린 뒤 링크를 공백으로 이어 그 자리에 넣는다(설계 6.3.2) */
  private async insertFiles(files: File[]) {
    const placeholder = `<!-- ${t("editor.uploading")} -->`;
    this.insert(placeholder);
    let text = "";
    try {
      text = escapeCellInput((await this.opts.onFiles!(files)).join(" "));
    } finally {
      const at = this.main.state.doc.toString().indexOf(placeholder);
      if (at >= 0) this.main.dispatch({ changes: { from: at, to: at + placeholder.length, insert: text }, selection: { anchor: at + text.length } });
    }
  }

  private extensions(): Extension {
    const main = this.main;
    const ro = () => main.state.readOnly;
    return [
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(headingStyle),
      syntaxHighlighting(classHighlighter),
      autocompletion({ override: [wikilinkSource(() => this.opts.linkCandidates())], icons: false }),
      codeFont(),
      drawSelection(),
      EditorView.lineWrapping,
      keymap.of([
        { key: "Mod-z", preventDefault: true, run: () => undo(main) },
        { key: "Mod-Shift-z", preventDefault: true, run: () => redo(main) },
        { key: "Mod-y", preventDefault: true, run: () => redo(main) },
        { key: "Mod-s", preventDefault: true, run: () => (this.opts.onSave?.(), true) },
        { key: "Mod-b", preventDefault: true, run: (v) => !ro() && wrapSelection(v, "**") },
        { key: "Mod-i", preventDefault: true, run: (v) => !ro() && wrapSelection(v, "*") },
        { key: "Mod-k", preventDefault: true, run: (v) => !ro() && insertLink(v) },
        { key: "Mod-Shift-h", preventDefault: true, run: (v) => !ro() && wrapSelection(v, "==") },
        // 칸 이동(설계 6.4). 자동완성이 열려 있으면 그쪽 키맵(Prec.highest)이 Enter·↑↓·Esc 를 먼저 받는다
        ...(["Tab", "Shift-Tab", "Enter", "Shift-Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"] as const).map((key) => ({
          key,
          run: (v: EditorView) => this.nav(key, v),
        })),
        ...defaultKeymap,
      ]),
      EditorView.domEventHandlers({
        keydown: (e) => {
          // 찾기(Mod-f·Mod-g·F3)는 본문 키맵으로 — 본문 뷰는 칸 안에서 난 키를 받지 않는다
          if ((e.metaKey || e.ctrlKey) && /^[fg]$/i.test(e.key)) return runScopeHandlers(main, e, "editor");
          if (e.key === "F3") return runScopeHandlers(main, e, "editor");
          return false;
        },
        focus: () => {
          this.cellFocused = true;
          return false;
        },
        blur: (_e, v) => {
          // 칸을 떼어 내는 중의 blur 는 무시한다(다시 열 때 포커스를 되살린다)
          if (v.dom.isConnected) this.cellFocused = false;
          return false;
        },
        compositionend: () => {
          // 조합이 끝난 뒤의 마지막 입력이 들어간 다음에 본문과 맞춘다
          setTimeout(() => this.schedule(), 0);
          return false;
        },
        paste: (e) => {
          const files = [...(e.clipboardData?.files ?? [])];
          if (!files.length || !this.opts.onFiles || ro()) return false;
          e.preventDefault();
          void this.insertFiles(files);
          return true;
        },
        drop: (e) => {
          const files = [...(e.dataTransfer?.files ?? [])];
          if (!files.length || !this.opts.onFiles || ro()) return false;
          e.preventDefault();
          void this.insertFiles(files);
          return true;
        },
      }),
      cellTheme,
    ];
  }

  destroy() {
    this.destroyed = true;
    this.close(false);
    plugins.delete(this.main);
  }
}

const cellTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontFamily: "var(--font-sans)", fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "0", caretColor: "var(--fg)" },
  ".cm-line": { padding: "0" },
  ".cm-scroller": { overflow: "visible", lineHeight: "inherit", fontFamily: "inherit" },
});

/** 칸 편집기 안에서 위/아래로 한 줄 움직일 자리가 있는가(감긴 칸 글) */
function movesWithin(v: EditorView, down: boolean): boolean {
  const r = v.state.selection.main;
  const next = v.moveVertically(r, down);
  if (next.head === r.head) return false;
  const a = v.coordsAtPos(r.head);
  const b = v.coordsAtPos(next.head);
  return !!a && !!b && Math.abs(a.top - b.top) > 1;
}

/** 본문 커서가 표 바로 위 줄에서 ↓, 바로 아래 줄에서 ↑ 이면 그 표의 첫 칸으로(설계 6.4) */
function enterFromBody(dir: "up" | "down") {
  return (view: EditorView): boolean => {
    const sel = view.state.selection;
    if (sel.ranges.length !== 1 || !sel.main.empty) return false;
    const line = view.state.doc.lineAt(sel.main.head);
    // 감긴 긴 줄은 그 줄의 끝(↓)·처음(↑) 화면 줄에서만
    const next = view.moveVertically(sel.main, dir === "down");
    if (next.head !== sel.main.head && next.head >= line.from && next.head <= line.to) return false;
    const pos = enterTableFrom(view.state, line.number, dir);
    if (pos === null) return false;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    return true;
  };
}

/** 표 편집기(tableWidget.ts 의 tableEditor)가 함께 켠다 */
export function cellEditing(getCtx: GetCtx, opts: TableOptions): Extension {
  return [
    ViewPlugin.define((view) => new CellPlugin(view, getCtx, opts)),
    Prec.high(
      keymap.of([
        { key: "ArrowDown", run: enterFromBody("down") },
        { key: "ArrowUp", run: enterFromBody("up") },
      ]),
    ),
    EditorView.baseTheme({
      ".cm-lp-table .cm-lp-cell-editing": { outline: "2px solid var(--accent)", outlineOffset: "-2px", cursor: "text" },
    }),
  ];
}
