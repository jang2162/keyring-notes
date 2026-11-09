import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, Text, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { LinkCandidate } from "./Editor";
import { enhance } from "./enhance";
import { t } from "./i18n";
import type { LiveRenderContext } from "./liveBlocks";
import { frontmatterEnd } from "./liveSyntax";
import { renderInlineMarkdown } from "./markdown";
import { cellEditing } from "./cellEditor";
import { applyAction, colMenu, dropIndex, rowMenu, type MenuAction, type TableAction } from "./tableMenu";
import { cellText, parseTable, type TableModel } from "./tableModel";
import { Menu, type MenuEntry } from "./ui";

/**
 * Live Preview 의 표 편집기: 문서 최상위 GFM 표를 늘 그린다(커서가 표 안이어도 — 설계 6.2).
 * 표의 내용은 본문 문서에만 있고 이 위젯은 그 구간을 보여 주는 창이다(설계 6.1). 칸 편집은 cellEditor.ts.
 * 「원문으로 편집」 을 고른 표는 커서가 그 표 밖으로 나갈 때까지 원문 줄로 둔다.
 */

export interface TableOptions {
  linkCandidates: () => LinkCandidate[];
  onFiles?: (files: File[]) => Promise<string[]>;
  /** 칸 편집기 안의 Mod-s(본문 키맵은 칸 안의 키를 받지 않는다) */
  onSave?: () => void;
}

/** 표 from·행(0 = 머리)·열 */
export interface CellRef {
  table: number;
  row: number;
  col: number;
}

type GetCtx = () => LiveRenderContext | null;

/** 표 from(첫 줄 처음)을 원문 모드로 */
export const editTableRaw = StateEffect.define<number>({ map: (v, m) => m.mapPos(v) });

/** 문서 최상위(Document 바로 아래) 표의 줄 범위. 인용·목록 안의 표와 프런트매터 안은 뺀다 */
export function topTables(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const fm = frontmatterEnd(state);
  const fmTo = fm === null ? -1 : state.doc.line(fm).to;
  const c = syntaxTree(state).cursor();
  if (!c.firstChild()) return out;
  do {
    if (c.name !== "Table" || c.from <= fmTo) continue;
    out.push({ from: state.doc.lineAt(c.from).from, to: state.doc.lineAt(c.to).to });
  } while (c.nextSibling());
  return out;
}

const rawField = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged ? value.map((p) => tr.changes.mapPos(p)) : value;
    for (const e of tr.effects) if (e.is(editTableRaw) && !next.includes(e.value)) next = [...next, e.value];
    if (!next.length || !(tr.selection || tr.docChanged || next !== value)) return next;
    const tables = topTables(tr.state);
    const head = tr.state.selection.main.head;
    return next.filter((p) => {
      const tb = tables.find((x) => x.from <= p && p <= x.to);
      // 고치는 중에 잠깐 표가 깨지면(구분 줄을 지우는 중 등) 칠 동안은 원문 표시를 지킨다
      if (!tb) return tr.docChanged;
      return tb.from <= head && head <= tb.to;
    });
  },
});

/**
 * 칸이 모자란 행의 빈 자리 칸을 연다. 문서에 그 칸이 없어 본문 선택을 칸 안에 둘 수 없으므로,
 * 선택을 그 행 끝에 두고 이 표시로 「그 자리의 빈 칸」 임을 기억한다. 칸에 글을 치면 그때 행에 칸을 붙인다(설계 6.3)
 */
export const setVirtualCell = StateEffect.define<CellRef>({ map: (v, m) => ({ ...v, table: m.mapPos(v.table) }) });

export const virtualField = StateField.define<(CellRef & { pos: number }) | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setVirtualCell)) return { ...e.value, pos: tr.state.selection.main.head };
    if (!v) return v;
    const next = tr.docChanged ? { ...v, table: tr.changes.mapPos(v.table), pos: tr.changes.mapPos(v.pos) } : v;
    const sel = tr.state.selection;
    // 선택이 그 자리를 떠나면 풀린다(그 칸에 글을 쳐 진짜 칸이 생긴 때도 커서가 칸 안으로 옮겨 풀린다)
    return sel.ranges.length === 1 && sel.main.empty && sel.main.head === next.pos ? next : null;
  },
});

/** 칸을 눌러 열 때 그 화면 좌표(칸 편집기가 그 자리에 커서를 둔다) */
export const cellClick = StateEffect.define<{ x: number; y: number; edge: "start" | "end" | null }>();

/** 그릴 표의 범위. 원문 모드 표는 뺀다 */
export function tableRanges(state: EditorState): { from: number; to: number }[] {
  const raw = state.field(rawField, false) ?? [];
  return topTables(state).filter((tb) => !raw.some((p) => tb.from <= p && p <= tb.to));
}

/**
 * pos 가 그린 표 안인가. 표 편집기가 꺼져 있으면(Live Preview 끔) false.
 * 칸에서 친 글은 본문 트랜잭션(input.type)으로 들어오므로 본문의 자동완성도 함께 열린다 — 본문 쪽은 이것으로 끈다(Editor.tsx)
 */
export function inDrawnTable(state: EditorState, pos: number): boolean {
  if (state.field(rawField, false) === undefined) return false;
  return tableRanges(state).some((x) => x.from <= pos && pos <= x.to);
}

/** 위젯 안에서 쓰는, 표 글만으로 읽은 모델(위치는 표 처음 기준 0부터) */
export function modelOfText(text: string): TableModel | null {
  return parseTable(Text.of(text.split("\n")), 0, text.length);
}

/** 그린 표에서 지금 표의 본문 위치·모델. 위젯은 같은 글이면 다시 쓰이므로 만들 때의 위치를 믿지 않는다 */
export function tableAtDOM(view: EditorView, wrap: HTMLElement): TableModel | null {
  const pos = view.posAtDOM(wrap);
  const tb = topTables(view.state).find((x) => x.from <= pos && pos <= x.to);
  return tb ? parseTable(view.state.doc, tb.from, tb.to) : null;
}

/**
 * 표 위젯 DOM 이 사라질 때 할 정리: 열린 손잡이·⋯ 메뉴 내리기, 끌기 중 window 처리기 떼기(2차 리뷰 ⑨).
 * Live Preview 끄기·문서 바꾸기·편집기 다시 만들기로 위젯이 없어져도 document.body 의 메뉴는 남아,
 * 거기서 고르면 떨어져 나간 뷰에 dispatch 한다. CodeMirror 는 DOM 을 다시 쓰는 갱신(updateDOM)에서는 destroy 를 부르지 않는다
 */
const disposers = new WeakMap<object, Set<() => void>>();

/** wrap 이 사라질 때 fn 을 부른다. 돌려준 함수로 등록을 푼다 */
export function onDispose(wrap: object, fn: () => void): () => void {
  let set = disposers.get(wrap);
  if (!set) disposers.set(wrap, (set = new Set()));
  set.add(fn);
  return () => void set.delete(fn);
}

/** 표 위젯 DOM 이 사라질 때(TableWidget.destroy) */
export function disposeTable(wrap: object) {
  const set = disposers.get(wrap);
  if (!set) return;
  disposers.delete(wrap);
  for (const fn of set) fn();
}

const ALIGN: Record<string, string> = { left: "left", center: "center", right: "right" };

class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly getCtx: GetCtx,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.text === this.text;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table markdown-body";
    const scroll = document.createElement("div");
    scroll.className = "cm-lp-table-scroll";
    scroll.append(document.createElement("table"));
    wrap.append(scroll);
    if (!view.state.readOnly) {
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "cm-lp-table-menu";
      menu.textContent = "⋯";
      menu.title = t("table.menu");
      menu.setAttribute("aria-label", t("table.menu"));
      menu.addEventListener("mousedown", (e) => e.preventDefault());
      menu.addEventListener("click", (e) => {
        e.preventDefault();
        const r = menu.getBoundingClientRect();
        openMenu(
          { x: r.right, y: r.bottom + 2 },
          [
            {
              label: t("table.editRaw"),
              run: () => {
                const m = tableAtDOM(view, wrap);
                if (!m) return;
                view.dispatch({ effects: editTableRaw.of(m.from), selection: { anchor: m.from }, scrollIntoView: true });
                view.focus();
              },
            },
          ],
          t("table.menu"),
          () => refocus(view, wrap),
          wrap,
        );
      });
      wrap.append(menu);
      attachHandles(view, wrap);
    }
    wrap.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      const a = target.closest<HTMLAnchorElement>("a[data-wikilink], a[href]");
      const ctx = this.getCtx();
      if (a && ctx?.onLink && a.dataset.wikilink) {
        e.preventDefault();
        ctx.onLink(a, e.ctrlKey || e.metaKey);
        return;
      }
      if (a || e.button !== 0 || view.state.readOnly) return;
      const td = target.closest<HTMLElement>("td, th");
      if (!td || td.classList.contains("cm-lp-cell-editing")) return;
      // 칸 열기는 본문 선택을 그 칸으로 옮기는 것 하나뿐이다 — 칸 편집기(cellEditor.ts)는 선택을 보고 열린다
      e.preventDefault();
      selectCellAt(view, wrap, td, e.clientX, e.clientY);
    });
    this.render(wrap, view);
    return wrap;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    this.render(dom, view);
    return true;
  }
  /** 같은 DOM 을 지키며 칸만 맞춘다 — 열린 칸 편집기(.cm-lp-cell-editing)는 건드리지 않는다 */
  render(wrap: HTMLElement, view: EditorView) {
    const table = wrap.querySelector("table")!;
    const m = modelOfText(this.text);
    if (!m) return;
    const ctx = this.getCtx();
    const rows = [m.header, ...m.body];
    let thead = table.tHead;
    if (!thead) thead = table.createTHead();
    let tbody = table.tBodies[0];
    if (!tbody) tbody = table.createTBody();
    const want = (sect: HTMLTableSectionElement, n: number) => {
      while (sect.rows.length > n) sect.deleteRow(-1);
      while (sect.rows.length < n) sect.insertRow();
    };
    want(thead, 1);
    want(tbody, m.body.length);
    let painted = false;
    rows.forEach((row, r) => {
      const tr = r === 0 ? thead.rows[0] : tbody.rows[r - 1];
      while (tr.cells.length > m.columns) tr.deleteCell(-1);
      while (tr.cells.length < m.columns) tr.append(document.createElement(r === 0 ? "th" : "td"));
      for (let c = 0; c < m.columns; c++) {
        const cell = tr.cells[c];
        const raw = row.cells[c]?.raw ?? "";
        // 바뀐 것만 쓴다 — 칸마다 매번 쓰면 수백 칸 표에서 타이핑마다 스타일 계산이 다시 돈다
        const align = ALIGN[m.align[c] ?? ""] ?? "";
        if (cell.dataset.row !== String(r)) cell.dataset.row = String(r);
        if (cell.dataset.col !== String(c)) cell.dataset.col = String(c);
        if (cell.style.textAlign !== align) cell.style.textAlign = align;
        if (cell.classList.contains("cm-lp-cell-editing") || cell.dataset.raw === raw) continue;
        paintCell(cell, raw, ctx);
        painted = true;
      }
    });
    const ctx2 = ctx;
    if (painted && ctx2) enhance(table, { resolver: ctx2.resolver, docPath: ctx2.docPath }, () => wrap.isConnected || !view.dom.isConnected);
  }
  ignoreEvent() {
    return true;
  }
  destroy(dom: HTMLElement) {
    disposeTable(dom);
  }
  get estimatedHeight() {
    return (this.text.split("\n").length - 1) * 30;
  }
}

/** 그 td 의 셀을 연다: 본문 선택을 그 셀로 옮기고 누른 좌표를 함께 넘긴다(셀 편집기는 선택을 보고 열린다) */
function selectCellAt(view: EditorView, wrap: HTMLElement, td: HTMLElement, x: number, y: number) {
  const m = tableAtDOM(view, wrap);
  if (!m) return;
  const row = Number(td.dataset.row);
  const col = Number(td.dataset.col);
  const r = row === 0 ? m.header : m.body[row - 1];
  const cell = r?.cells[col];
  // 칸 편집기는 원문(`**굵게**`)을 보이므로 그린 글의 x 좌표는 원문의 다른 글자에 떨어진다 —
  // 그린 글 끝보다 오른쪽(흔한 「이어 쓰기」)이면 칸 끝, 왼쪽 바깥이면 칸 처음에 둔다. 글 위를 누른 것만 좌표로 잡는다
  const range = document.createRange();
  range.selectNodeContents(td);
  const box = range.getBoundingClientRect();
  const edge = !box.width || x >= box.right ? "end" : x <= box.left ? "start" : null;
  const click = cellClick.of({ x, y, edge });
  if (cell) view.dispatch({ selection: { anchor: cell.to }, effects: click });
  else if (r) view.dispatch({ selection: { anchor: r.from + r.text.trimEnd().length }, effects: [setVirtualCell.of({ table: m.from, row, col }), click] });
}

/**
 * 표 옆 빈 곳(표 폭이 fit-content 라 줄 오른쪽이 비어 있다)을 누르면 그 높이 행의 끝 셀(왼쪽이면 첫 셀)을 연다.
 * 그대로 두면 CodeMirror 가 블록 위젯의 앞·끝 자리를 주어, 위쪽 반이면 머리 첫 셀이 열린다
 */
const besideTable = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || view.state.readOnly || e.target !== view.contentDOM) return false;
    for (const wrap of view.contentDOM.querySelectorAll<HTMLElement>(".cm-lp-table")) {
      const w = wrap.getBoundingClientRect();
      if (e.clientY < w.top || e.clientY > w.bottom || (e.clientX >= w.left && e.clientX <= w.right)) continue;
      const rows = [...wrap.querySelectorAll<HTMLTableRowElement>("tr")];
      if (!rows.length) return false;
      const dist = (tr: HTMLElement) => {
        const r = tr.getBoundingClientRect();
        return e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
      };
      const tr = rows.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      const td = e.clientX > w.right ? tr.cells[tr.cells.length - 1] : tr.cells[0];
      if (!td) return false;
      e.preventDefault();
      const r = td.getBoundingClientRect();
      selectCellAt(view, wrap, td, e.clientX > w.right ? r.right : r.left, r.top + r.height / 2);
      return true;
    }
    return false;
  },
});

// ── 행·열 손잡이(설계 6.5): 누르면 메뉴, 끌면 옮기기. 마우스를 올린 행·열에 하나씩 둔다(칸마다 두지 않는다 — 수백 칸 표) ──

function handleButton(cls: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `cm-lp-handle ${cls}`;
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}

/** 그 칸의 행·열에 손잡이를 옮긴다(마우스를 올렸을 때, 터치에서는 칸 편집기를 열 때 — cellEditor.ts) */
export function showHandles(td: HTMLElement) {
  const wrap = td.closest<HTMLElement>(".cm-lp-table");
  const table = wrap?.querySelector("table");
  const row = wrap?.querySelector<HTMLElement>(".cm-lp-row-handle");
  const col = wrap?.querySelector<HTMLElement>(".cm-lp-col-handle");
  if (!wrap || !table || !row || !col) return;
  const w = wrap.getBoundingClientRect();
  const t = table.getBoundingClientRect();
  const c = td.getBoundingClientRect();
  const tr = (td.parentElement as HTMLElement).getBoundingClientRect();
  row.dataset.row = td.dataset.row;
  col.dataset.col = td.dataset.col;
  row.style.top = `${tr.top - w.top + tr.height / 2}px`;
  row.style.left = `${t.left - w.left}px`;
  col.style.left = `${c.left - w.left + c.width / 2}px`;
  col.style.top = `${t.top - w.top}px`;
  wrap.classList.add("cm-lp-handles-on");
}

function act(view: EditorView, wrap: HTMLElement, a: TableAction) {
  const m = tableAtDOM(view, wrap);
  if (!m) return;
  view.dispatch({ changes: applyAction(m, a), userEvent: "input" });
}

function menuOf(view: EditorView, wrap: HTMLElement, items: MenuAction[], label: string, at: { x: number; y: number }) {
  const groups: Record<string, number> = { insert: 0, move: 1, delete: 2, align: 3, sort: 4 };
  const group = (k: string) =>
    /(Above|Below|Left|Right)$/.test(k) && !/Move|align/.test(k)
      ? "insert"
      : /Up$|Down$|Move/.test(k)
        ? "move"
        : /Delete/.test(k)
          ? "delete"
          : /align/.test(k)
            ? "align"
            : "sort";
  const entries: MenuEntry[] = [];
  let last = -1;
  for (const it of items) {
    const g = groups[group(it.key)];
    if (last >= 0 && g !== last) entries.push("-");
    last = g;
    entries.push({ label: t(it.key), danger: /Delete/.test(it.key), run: () => act(view, wrap, it.action) });
  }
  openMenu(at, entries, label, () => refocus(view, wrap), wrap);
}

/** 메뉴가 가져간 포커스를 돌려준다: 칸 편집기가 열려 있으면 그 칸, 아니면 본문(안 그러면 이어서 친 글이 사라진다) */
function refocus(view: EditorView, wrap: HTMLElement) {
  const cell = wrap.querySelector<HTMLElement>(".cm-lp-cell-editing .cm-content");
  if (cell) cell.focus();
  else view.focus();
}

/**
 * 손잡이 누르기·끌기. 포인터 이벤트라 마우스와 터치가 같다. 4px 넘게 움직이면 끌기 — 놓을 자리에 선을 보이고,
 * 놓으면 moveRow/moveColumn(트랜잭션 하나), 끄는 중 Esc 는 취소. 머리 행은 옮길 수 없어 메뉴만
 */
function attachHandles(view: EditorView, wrap: HTMLElement) {
  const row = handleButton("cm-lp-row-handle", t("table.rowHandle"));
  const col = handleButton("cm-lp-col-handle", t("table.colHandle"));
  const line = document.createElement("div");
  line.className = "cm-lp-drop-line";
  wrap.append(row, col, line);
  wrap.addEventListener("mousemove", (e) => {
    const td = (e.target as HTMLElement).closest<HTMLElement>("td, th");
    if (td && !(e.target as HTMLElement).closest(".cm-lp-handle")) showHandles(td);
  });
  for (const h of [row, col]) {
    const isRow = h === row;
    h.addEventListener("mousedown", (e) => e.preventDefault());
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const index = Number(isRow ? h.dataset.row : h.dataset.col);
      if (Number.isNaN(index)) return;
      const start = isRow ? e.clientY : e.clientX;
      const table = wrap.querySelector("table")!;
      // 끌 수 있는 항목: 행은 본문 행(머리 빼고), 열은 머리 칸
      const items = isRow ? [...table.tBodies[0].rows] : [...table.tHead!.rows[0].cells];
      const from = isRow ? index - 1 : index;
      const canDrag = from >= 0 && items.length > 1;
      let dragging = false;
      let target = from;
      try {
        h.setPointerCapture(e.pointerId);
      } catch {
        // 이미 끝난 포인터(빠른 탭 등)면 잡지 못한다 — 손잡이 위에서 난 이벤트만으로도 된다
      }
      const mids = () =>
        items.map((el) => {
          const r = el.getBoundingClientRect();
          return isRow ? r.top + r.height / 2 : r.left + r.width / 2;
        });
      const showLine = () => {
        const w = wrap.getBoundingClientRect();
        const others = items.filter((_, i) => i !== from);
        const edge = target < others.length ? others[target].getBoundingClientRect() : others[others.length - 1].getBoundingClientRect();
        const before = target < others.length;
        const tr = table.getBoundingClientRect();
        if (isRow)
          Object.assign(line.style, {
            top: `${(before ? edge.top : edge.bottom) - w.top}px`,
            left: `${tr.left - w.left}px`,
            width: `${tr.width}px`,
            height: "2px",
          });
        else
          Object.assign(line.style, {
            left: `${(before ? edge.left : edge.right) - w.left}px`,
            top: `${tr.top - w.top}px`,
            height: `${tr.height}px`,
            width: "2px",
          });
        line.classList.add("on");
      };
      const cancel = () => {
        dragging = false;
        line.classList.remove("on");
        cleanup();
      };
      const onKey = (k: KeyboardEvent) => {
        if (k.key === "Escape" && dragging) {
          k.preventDefault();
          k.stopPropagation();
          cancel();
        }
      };
      const move = (m: PointerEvent) => {
        const at = isRow ? m.clientY : m.clientX;
        if (!dragging && canDrag && Math.abs(at - start) > 4) dragging = true;
        if (!dragging) return;
        target = dropIndex(mids(), from, at);
        showLine();
      };
      const up = (u: PointerEvent) => {
        const was = dragging;
        cleanup();
        line.classList.remove("on");
        if (was) {
          if (target !== from) act(view, wrap, isRow ? { op: "moveRow", from, to: target } : { op: "moveColumn", from, to: target });
          return;
        }
        if (u.type === "pointercancel") return;
        const m = tableAtDOM(view, wrap);
        if (!m) return;
        const r = h.getBoundingClientRect();
        menuOf(view, wrap, isRow ? rowMenu(m, index) : colMenu(m, index), h.title, { x: r.left, y: r.bottom + 2 });
      };
      const cleanup = () => {
        offDispose();
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        window.removeEventListener("keydown", onKey, true);
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
      window.addEventListener("keydown", onKey, true);
      // 끄는 중에 표가 사라지면(편집기 다시 만들기 등) 처리기를 뗀다
      const offDispose = onDispose(wrap, cancel);
    });
  }
}

/** 칸을 그린 HTML 로(칸 원문은 data-raw 에 두어 같으면 다시 그리지 않는다) */
export function paintCell(td: HTMLElement, raw: string, ctx: LiveRenderContext | null) {
  td.dataset.raw = raw;
  if (ctx) td.innerHTML = renderInlineMarkdown(cellText(raw), { resolver: ctx.resolver, docPath: ctx.docPath });
  else td.textContent = cellText(raw);
}

/**
 * ui.tsx 의 Menu 를 document.body 에 띄운다(편집기 위젯은 React 밖이다).
 * owner(표 위젯 DOM)가 사라지면 메뉴도 내린다 — 이때는 포커스를 돌려주지 않는다(돌려줄 뷰가 없어졌다)
 */
export function openMenu(at: { x: number; y: number }, items: MenuEntry[], label?: string, onClosed?: () => void, owner?: HTMLElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let closed = false;
  const off = owner ? onDispose(owner, () => close(false)) : () => {};
  function close(refocus = true) {
    if (closed) return;
    closed = true;
    off();
    host.remove();
    if (refocus) {
      root.unmount();
      onClosed?.();
    } else {
      // 위젯 destroy 는 React 커밋(편집기 다시 만들기) 안에서 올 수 있다 — 그 자리에서 다른 root 를 동기로 내리면 React 가 경고한다
      queueMicrotask(() => root.unmount());
    }
  }
  root.render(createElement(Menu, { at, items, label, onClose: () => close() }));
}

function buildTables(state: EditorState, getCtx: GetCtx): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const tb of tableRanges(state)) {
    const widget = new TableWidget(state.sliceDoc(tb.from, tb.to), getCtx);
    ranges.push(Decoration.replace({ widget, block: true }).range(tb.from, tb.to));
  }
  return Decoration.set(ranges);
}

function tableField(getCtx: GetCtx) {
  return StateField.define<DecorationSet>({
    create: (state) => buildTables(state, getCtx),
    update: (deco, tr) =>
      tr.docChanged || tr.state.field(rawField) !== tr.startState.field(rawField, false) || syntaxTree(tr.state) !== syntaxTree(tr.startState)
        ? buildTables(tr.state, getCtx)
        : deco,
    provide: (f) => EditorView.decorations.from(f),
  });
}

const theme = EditorView.baseTheme({
  // 폭은 표만큼(⋯ 메뉴 단추가 줄 끝이 아니라 표 오른쪽 위에 붙게)
  ".cm-lp-table": { position: "relative", width: "fit-content", maxWidth: "100%", padding: "8px 0 4px", fontFamily: "var(--font-sans)", whiteSpace: "normal" },
  ".cm-lp-table-scroll": { overflowX: "auto" },
  ".cm-lp-table table": { margin: "0", borderCollapse: "collapse" },
  ".cm-lp-table th, .cm-lp-table td": { minWidth: "3em", cursor: "text", verticalAlign: "top" },
  ".cm-lp-table-menu": {
    position: "absolute",
    top: "0",
    right: "-28px",
    font: "13px var(--font-sans)",
    lineHeight: "1",
    color: "var(--muted)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "2px 6px",
    cursor: "pointer",
    opacity: "0",
  },
  ".cm-lp-table:hover .cm-lp-table-menu, .cm-lp-table-menu:focus-visible": { opacity: "1" },
  ".cm-lp-handle": {
    position: "absolute",
    zIndex: "1",
    padding: "0",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    background: "var(--bg)",
    color: "var(--muted)",
    cursor: "grab",
    opacity: "0",
    touchAction: "none",
    font: "10px/1 var(--font-sans)",
  },
  ".cm-lp-handle:hover": { color: "var(--accent)", borderColor: "var(--accent)" },
  // 행 손잡이는 표 왼쪽 바깥, 열 손잡이는 표 위쪽 테두리에 걸친다
  ".cm-lp-row-handle": { width: "12px", height: "20px", transform: "translate(-15px, -50%)" },
  ".cm-lp-row-handle::before": { content: '"⋮"' },
  ".cm-lp-col-handle": { width: "20px", height: "12px", transform: "translate(-50%, -6px)" },
  ".cm-lp-col-handle::before": { content: '"⋯"' },
  ".cm-lp-table.cm-lp-handles-on:hover .cm-lp-handle, .cm-lp-handle:focus-visible": { opacity: "1" },
  ".cm-lp-drop-line": { position: "absolute", display: "none", background: "var(--accent)", pointerEvents: "none", zIndex: "2" },
  ".cm-lp-drop-line.on": { display: "block" },
  "@media (pointer: coarse)": { ".cm-lp-table-menu": { opacity: "1" }, ".cm-lp-table.cm-lp-handles-on .cm-lp-handle": { opacity: "1" } },
});

/** Live Preview 안에서만 켠다(livePreview 가 부른다) */
export function tableEditor(getCtx: GetCtx, opts: TableOptions): Extension {
  return [rawField, virtualField, tableField(getCtx), theme, besideTable, cellEditing(getCtx, opts)];
}
