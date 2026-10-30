import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField, Transaction, type Extension, type Range, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { liveBlocks, type LiveRenderContext } from "./liveBlocks";
import { t } from "./i18n";
import { isAppField } from "./childSortUi";

/**
 * 편집 중 렌더링(Live Preview): 커서가 없는 줄에서는 마크업 기호를 숨기고 모양만 보인다.
 * 원문은 그대로이고(커서를 그 줄로 옮기면 기호가 다시 보인다), 숨기는 것은 표시뿐이다.
 *
 *   # 제목 → 제목(크게)        **굵게**·*기울임*·~~취소~~·==강조== → 기호 숨김
 *   `코드` → 백틱 숨김         [글자](주소) → 글자만     [[대상|별칭]] → 별칭(없으면 대상)
 *
 * 이미지·콜아웃·수식·주석·블록 ID·Mermaid·문서 임베드·각주는 liveBlocks.ts가 미리보기 렌더러로 그린다.
 * 코드 블록·표·HTML은 건드리지 않는다.
 */

const hide = Decoration.replace({});
const headingLine = (level: number) => Decoration.line({ class: `cm-lp-h cm-lp-h${level}` });
const markText = Decoration.mark({ class: "cm-lp-mark" });
const linkText = Decoration.mark({ class: "cm-lp-link" });

/** 선택(커서)이 걸친 줄 번호 */
function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

interface Item {
  from: number;
  to: number;
  deco: Decoration;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const items: Item[] = [];
  const lineOf = (pos: number) => state.doc.lineAt(pos).number;
  const visible = (pos: number) => !active.has(lineOf(pos));
  // 위키링크·하이라이트를 찾을 때 피할 범위(코드)
  const code: [number, number][] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (name === "FencedCode" || name === "CodeBlock" || name === "HTMLBlock" || name === "Table") {
          code.push([node.from, node.to]);
          return false;
        }
        if (name === "InlineCode") code.push([node.from, node.to]);
        const m = /^ATXHeading(\d)$/.exec(name);
        if (m) {
          const line = state.doc.lineAt(node.from);
          items.push({ from: line.from, to: line.from, deco: headingLine(Number(m[1])) });
          return;
        }
        if (name === "Image") return false; // 이미지 문법은 그대로
        if (!visible(node.from)) return;
        if (name === "HeaderMark") {
          // "# " 기호와 뒤 공백
          const after = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          if (node.node.parent?.name.startsWith("ATXHeading") && after > node.from) items.push({ from: node.from, to: after, deco: hide });
        } else if (name === "EmphasisMark" || name === "StrikethroughMark") {
          items.push({ from: node.from, to: node.to, deco: hide });
        } else if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
          items.push({ from: node.from, to: node.to, deco: hide });
        } else if (name === "Link") {
          // [글자](주소 "제목") → 글자만
          const marks: { from: number; to: number; name: string }[] = [];
          const c = node.node.cursor();
          if (c.firstChild()) {
            do marks.push({ from: c.from, to: c.to, name: c.name });
            while (c.nextSibling());
          }
          const open = marks.find((k) => k.name === "LinkMark" && state.sliceDoc(k.from, k.to) === "[");
          const close = marks.find((k) => k.name === "LinkMark" && state.sliceDoc(k.from, k.to) === "]");
          // 주소가 있는 링크만([글자](주소)). [^1]·[!note]·[참조] 같은 것은 그대로
          const hasUrl = marks.some((k) => k.name === "URL") && marks.some((k) => k.name === "LinkMark" && state.sliceDoc(k.from, k.to) === "(");
          if (hasUrl && open && close && lineOf(open.from) === lineOf(node.to)) {
            items.push({ from: open.from, to: open.to, deco: hide });
            if (close.to > open.to) items.push({ from: open.to, to: close.from, deco: linkText });
            items.push({ from: close.from, to: node.to, deco: hide });
          }
          return false;
        }
      },
    });

    // 위키링크 [[대상|별칭]]과 하이라이트 ==글자==(lezer 마크다운 문법에 없어 글자로 찾는다)
    const text = state.sliceDoc(from, to);
    const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos < b);
    for (const m of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
      const start = from + m.index!;
      if (m[1] || inCode(start) || !visible(start)) continue; // 임베드 ![[…]]는 그대로
      const inner = m[2];
      const bar = inner.indexOf("|");
      const shownFrom = start + 2 + (bar >= 0 ? bar + 1 : 0);
      const end = start + m[0].length;
      items.push({ from: start, to: shownFrom, deco: hide });
      items.push({ from: shownFrom, to: end - 2, deco: linkText });
      items.push({ from: end - 2, to: end, deco: hide });
    }
    for (const m of text.matchAll(/==(?=\S)([^=\n]+?)==/g)) {
      const start = from + m.index!;
      if (inCode(start) || !visible(start)) continue;
      const end = start + m[0].length;
      items.push({ from: start, to: start + 2, deco: hide });
      items.push({ from: start + 2, to: end - 2, deco: markText });
      items.push({ from: end - 2, to: end, deco: hide });
    }
  }

  // 겹치는 숨김은 바깥 것만(시작 순서대로 보며 앞 숨김 안에 든 것은 뺀다). 정렬은 Decoration.set이 한다.
  items.sort((a, b) => a.from - b.from || b.to - a.to);
  let hiddenUntil = -1;
  const ranges = [];
  for (const it of items) {
    if (it.deco === hide) {
      if (it.from < hiddenUntil) continue;
      hiddenUntil = it.to;
    }
    ranges.push(it.deco.range(it.from, it.to));
  }
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  ".cm-lp-h": { fontWeight: "700" },
  ".cm-lp-h1": { fontSize: "1.6em" },
  ".cm-lp-h2": { fontSize: "1.35em" },
  ".cm-lp-h3": { fontSize: "1.18em" },
  ".cm-lp-mark": { backgroundColor: "var(--mark-bg)", color: "var(--mark-fg)", borderRadius: "3px" },
  ".cm-lp-link": { color: "var(--accent)", textDecoration: "underline", textDecorationStyle: "dashed", textUnderlineOffset: "3px" },
});

/** ctx: 블록을 그릴 때 쓸 링크 해석·문서 경로(없으면 기호 숨기기만) */
export function livePreview(ctx: () => LiveRenderContext | null = () => null): Extension {
  return [plugin, theme, liveBlocks(ctx)];
}

/**
 * 코드만 고정폭: 본문 글꼴이 비례폭이어도 코드 블록 줄과 `인라인 코드`는 고정폭으로 보인다(Live Preview와 따로 늘 켠다).
 */
const codeLine = Decoration.line({ class: "cm-code-line" });
const inlineCode = Decoration.mark({ class: "cm-inline-code" });

function buildCode(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name === "FencedCode" || n.name === "CodeBlock") {
          const a = view.state.doc.lineAt(n.from).number;
          const b = view.state.doc.lineAt(n.to).number;
          for (let i = a; i <= b; i++) ranges.push(codeLine.range(view.state.doc.line(i).from));
          return false;
        }
        if (n.name === "InlineCode") {
          ranges.push(inlineCode.range(n.from, n.to));
          return false;
        }
        return undefined;
      },
    });
  }
  return Decoration.set(ranges, true);
}

const codePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCode(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = buildCode(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const codeTheme = EditorView.baseTheme({
  ".cm-code-line": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: "var(--bg-soft)" },
  ".cm-inline-code": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: "var(--bg-soft)", borderRadius: "3px", padding: "0 2px" },
});

export function codeFont(): Extension {
  return [codePlugin, codeTheme];
}

/**
 * 맨 앞 프런트매터(--- … ---)를 한 줄 표시로 접는다: "속성 N개 — 오른쪽 패널에서 보기 · 원문 보기".
 * 앞부분을 누르면 오른쪽 패널의 속성 탭을 열고, "원문 보기"를 누르거나 커서가 그 안에 들어가면 원문을 보인다.
 */
class FrontmatterWidget extends WidgetType {
  constructor(readonly count: number) {
    super();
  }
  eq(other: FrontmatterWidget) {
    return other.count === this.count;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-fm-fold";
    const props = document.createElement("span");
    props.className = "cm-fm-props";
    props.textContent = this.count ? t("live.propsCount", { count: this.count }) : t("live.props");
    const raw = document.createElement("span");
    raw.className = "cm-fm-raw";
    raw.textContent = t("live.showRaw");
    el.append(props, " · ", raw);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function frontmatterEnd(state: EditorState): number | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return null;
  for (let i = 2; i <= Math.min(doc.lines, 300); i++) {
    const t = doc.line(i).text.trimEnd();
    if (t === "---" || t === "...") return i;
  }
  return null;
}

/** 프런트매터 맨 위 키 수(들여쓰지 않은 "키:" 줄). 앱이 적는 정렬·순서·수정 시각(sort·rank·edited)은 세지 않는다 */
function topKeys(state: EditorState, end: number): number {
  let n = 0;
  for (let i = 2; i < end; i++) {
    const key = /^([^\s#-][^:]*):/
      .exec(state.doc.line(i).text)?.[1]
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
    if (key !== undefined && !isAppField(key)) n++;
  }
  return n;
}

/**
 * 맨 앞 프런트매터 바로 뒤(본문이 시작하는 자리). 프런트매터가 없으면 null.
 * 닫는 줄이 문서 끝이면 그 줄 끝에 줄바꿈을 붙여 넣어야 하므로 prefix 로 알린다
 */
export function bodyStart(state: EditorState): { at: number; prefix: string } | null {
  const end = frontmatterEnd(state);
  if (end === null) return null;
  return end < state.doc.lines ? { at: state.doc.line(end + 1).from, prefix: "" } : { at: state.doc.length, prefix: "\n" };
}

/**
 * 커서가 맨 앞(0)일 때 넣는 글을 프런트매터 뒤로 옮긴다. 막 연 문서의 커서는 0 이고 그동안 프런트매터는 한 줄 표시로 접혀 있어,
 * 키보드로 편집기에 들어가 바로 치거나 붙여 넣으면 보이지 않는 `---` 앞에 들어가 프런트매터가 깨진다.
 * 앱으로 만든 노트는 처음부터 프런트매터(edited)가 있으므로 새 노트에서 늘 일어난다
 */
const keepFrontmatter = EditorState.transactionFilter.of((tr): Transaction | TransactionSpec => {
  if (!tr.docChanged || !tr.isUserEvent("input")) return tr;
  const sel = tr.startState.selection.main;
  if (!sel.empty || sel.head !== 0) return tr;
  const body = bodyStart(tr.startState);
  if (!body) return tr;
  let insert: string | null = null;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    insert = insert === null && fromA === 0 && toA === 0 ? text.toString() : "\u0000";
  });
  if (insert === null || insert === "\u0000") return tr;
  const text = body.prefix + (insert as string);
  return {
    changes: { from: body.at, insert: text },
    selection: { anchor: body.at + text.length },
    scrollIntoView: true,
    annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent) ?? "input"),
  };
});

function buildFold(state: EditorState): DecorationSet {
  const end = frontmatterEnd(state);
  if (end === null) return Decoration.none;
  const to = state.doc.line(end).to;
  const sel = state.selection.main;
  // 문서를 막 열었을 때의 커서(맨 앞, 선택 없음)는 안으로 치지 않는다
  if (sel.from <= to && !(sel.empty && sel.head === 0)) return Decoration.none;
  return Decoration.set([Decoration.replace({ widget: new FrontmatterWidget(topKeys(state, end)), block: true }).range(0, to)]);
}

const foldField = StateField.define<DecorationSet>({
  create: buildFold,
  update: (deco, tr) => (tr.docChanged || tr.selection ? buildFold(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

const foldTheme = EditorView.baseTheme({
  ".cm-fm-fold": { fontSize: "12px", color: "var(--muted)", padding: "2px 0 6px", fontFamily: "var(--font-sans)" },
  ".cm-fm-props, .cm-fm-raw": { cursor: "pointer", borderRadius: "3px", padding: "0 2px" },
  ".cm-fm-props:hover, .cm-fm-raw:hover": { color: "var(--accent)", textDecoration: "underline" },
});

export function frontmatterFold(onProps: () => void): Extension {
  const click = EditorView.domEventHandlers({
    mousedown(e, view) {
      const t = e.target as HTMLElement;
      if (!t.closest(".cm-fm-fold")) return false;
      e.preventDefault();
      if (t.closest(".cm-fm-raw")) {
        view.dispatch({ selection: { anchor: 3 } });
        view.focus();
      } else onProps();
      return true;
    },
  });
  return [foldField, foldTheme, click, keepFrontmatter];
}
