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

/** 그릴 표의 범위. 원문 모드 표는 뺀다 */
export function tableRanges(state: EditorState): { from: number; to: number }[] {
  const raw = state.field(rawField, false) ?? [];
  return topTables(state).filter((tb) => !raw.some((p) => tb.from <= p && p <= tb.to));
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
        openMenu({ x: r.right, y: r.bottom + 2 }, [
          {
            label: t("table.editRaw"),
            run: () => {
              const m = tableAtDOM(view, wrap);
              if (!m) return;
              view.dispatch({ effects: editTableRaw.of(m.from), selection: { anchor: m.from }, scrollIntoView: true });
              view.focus();
            },
          },
        ]);
      });
      wrap.append(menu);
    }
    wrap.addEventListener("mousedown", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wikilink], a[href]");
      const ctx = this.getCtx();
      if (a && ctx?.onLink && a.dataset.wikilink) {
        e.preventDefault();
        ctx.onLink(a, e.ctrlKey || e.metaKey);
      }
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
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.style.textAlign = ALIGN[m.align[c] ?? ""] ?? "";
        if (cell.classList.contains("cm-lp-cell-editing") || cell.dataset.raw === raw) continue;
        cell.dataset.raw = raw;
        if (ctx) cell.innerHTML = renderInlineMarkdown(cellText(raw), { resolver: ctx.resolver, docPath: ctx.docPath });
        else cell.textContent = cellText(raw);
        painted = true;
      }
    });
    const ctx2 = ctx;
    if (painted && ctx2) enhance(table, { resolver: ctx2.resolver, docPath: ctx2.docPath }, () => wrap.isConnected || !view.dom.isConnected);
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return (this.text.split("\n").length - 1) * 30;
  }
}

/** ui.tsx 의 Menu 를 document.body 에 띄운다(편집기 위젯은 React 밖이다) */
export function openMenu(at: { x: number; y: number }, items: MenuEntry[], label?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(createElement(Menu, { at, items, label, onClose: close }));
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
      tr.docChanged || tr.state.field(rawField) !== tr.startState.field(rawField) || syntaxTree(tr.state) !== syntaxTree(tr.startState)
        ? buildTables(tr.state, getCtx)
        : deco,
    provide: (f) => EditorView.decorations.from(f),
  });
}

const theme = EditorView.baseTheme({
  ".cm-lp-table": { position: "relative", padding: "4px 0", fontFamily: "var(--font-sans)", whiteSpace: "normal" },
  ".cm-lp-table-scroll": { overflowX: "auto" },
  ".cm-lp-table table": { margin: "0", borderCollapse: "collapse" },
  ".cm-lp-table th, .cm-lp-table td": { minWidth: "3em", cursor: "text", verticalAlign: "top" },
  ".cm-lp-table-menu": {
    position: "absolute",
    top: "0",
    right: "0",
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
  "@media (pointer: coarse)": { ".cm-lp-table-menu": { opacity: "1" } },
});

/** Live Preview 안에서만 켠다(livePreview 가 부른다) */
export function tableEditor(getCtx: GetCtx, opts: TableOptions): Extension {
  void opts;
  return [rawField, tableField(getCtx), theme];
}
