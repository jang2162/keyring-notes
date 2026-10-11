import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { enhance } from "./enhance";
import { renderMarkdown, type LinkResolver } from "./markdown";
import { api } from "./api";
import { t } from "./i18n";

/**
 * Live Preview에서 8단계 형식을 그린다. 커서(선택)가 그 블록 밖에 있을 때만 그리고, 들어가면 원문을 보인다.
 * 렌더러는 미리보기와 같은 것(markdown.ts의 renderMarkdown, enhance.ts의 KaTeX·Mermaid·문서 임베드)을 쓴다.
 *
 *   블록(줄 전체를 바꾼다): 이미지·문서 임베드만 있는 줄, 콜아웃(> [!note]), 수식 블록($$…$$), Mermaid,
 *                          여러 줄 주석(%%…%%만 있는 줄들)
 *   줄 안: 이미지 임베드, 인라인 수식 $…$, 주석 %%…%% 숨기기, 블록 ID ^id 숨기기, 각주 [^1] → 위첨자, 각주 정의 줄
 */
export interface LiveRenderContext {
  resolver: LinkResolver;
  docPath: string;
  /** 그린 블록 안의 링크를 눌렀을 때(미리보기와 같은 처리). mod: Ctrl/Cmd를 같이 눌렀는지 */
  onLink?: (a: HTMLAnchorElement, mod: boolean) => void;
}

type GetCtx = () => LiveRenderContext | null;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

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

/** 미리보기 렌더러로 그린 블록. 같은 원문이면 다시 그리지 않는다 */
class BlockWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly kind: string,
    readonly from: number,
    readonly getCtx: GetCtx,
  ) {
    super();
  }
  eq(other: BlockWidget) {
    return other.src === this.src && other.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = `cm-lp-block cm-lp-${this.kind} markdown-body`;
    const ctx = this.getCtx();
    if (!ctx) {
      el.textContent = this.src;
      return el;
    }
    el.innerHTML = renderMarkdown(this.src, { resolver: ctx.resolver, docPath: ctx.docPath, hideFrontmatter: true, docId: "lp" }).html;
    // 위젯·할 일 체크는 원문을 고치는 것이라 여기서는 하지 않는다
    for (const box of el.querySelectorAll<HTMLInputElement>("input.task")) box.disabled = true;
    enhance(el, { resolver: ctx.resolver, docPath: ctx.docPath }, () => el.isConnected || !view.dom.isConnected);
    el.addEventListener("mousedown", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wikilink], a[href]");
      if (a && ctx.onLink && a.dataset.wikilink) {
        e.preventDefault();
        ctx.onLink(a, e.ctrlKey || e.metaKey);
        return;
      }
      if (a) return;
      // 누르면 원문으로(커서를 블록 처음에)
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return this.kind === "image" ? 200 : -1;
  }
}

/** 여러 줄 주석은 자리만(접힌 표시) */
class HiddenBlock extends WidgetType {
  constructor(readonly lines: number) {
    super();
  }
  eq(o: HiddenBlock) {
    return o.lines === this.lines;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-lp-hidden-comment";
    el.textContent = `%% ${t("live.comment", { count: this.lines })} %%`;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

interface Block {
  from: number;
  to: number;
  kind: string;
}

/** 블록으로 그릴 범위를 찾는다(코드 블록 안은 보지 않는다) */
function findBlocks(state: EditorState): Block[] {
  const out: Block[] = [];
  const doc = state.doc;
  const code: [number, number][] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter: (n) => {
      if (n.name === "FencedCode") {
        code.push([n.from, n.to]);
        const info = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(doc.lineAt(n.from).text)?.[2];
        if (info === "mermaid") out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "mermaid" });
        return false;
      }
      if (n.name === "CodeBlock" || n.name === "HTMLBlock") {
        code.push([n.from, n.to]);
        return false;
      }
      if (n.name === "Blockquote") {
        const first = doc.lineAt(n.from);
        if (/^\s*>\s*\[![A-Za-z][\w-]*\][+-]?/.test(first.text)) out.push({ from: first.from, to: doc.lineAt(n.to).to, kind: "callout" });
        return false;
      }
      return undefined;
    },
  });
  const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos <= b);
  const taken = (pos: number) => out.some((b) => pos >= b.from && pos <= b.to);
  // 줄 단위로: $$ 수식 블록, 여러 줄 주석, 임베드만 있는 줄
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (inCode(line.from) || taken(line.from)) continue;
    const t = line.text.trim();
    if (t.startsWith("$$")) {
      if (t.length > 4 && t.endsWith("$$")) {
        out.push({ from: line.from, to: line.to, kind: "math" });
        continue;
      }
      for (let j = i + 1; j <= doc.lines && j < i + 200; j++) {
        if (doc.line(j).text.includes("$$")) {
          out.push({ from: line.from, to: doc.line(j).to, kind: "math" });
          i = j;
          break;
        }
      }
      continue;
    }
    if (t.startsWith("%%") && !(t.length > 2 && t.slice(2).includes("%%"))) {
      for (let j = i + 1; j <= doc.lines && j < i + 500; j++) {
        if (doc.line(j).text.trimEnd().endsWith("%%")) {
          out.push({ from: line.from, to: doc.line(j).to, kind: "comment" });
          i = j;
          break;
        }
      }
      continue;
    }
    // 임베드만 있는 줄: ![[이미지·문서]] 또는 ![](이미지)
    if (/^!\[\[[^\]\n]+\]\]$/.test(t) || /^!\[[^\]\n]*\]\([^)\n]+\)$/.test(t)) {
      const target = /^!\[\[([^\]|#\n]*)/.exec(t)?.[1]?.trim();
      out.push({ from: line.from, to: line.to, kind: target === undefined || IMAGE_EXT.test(target) ? "image" : "embed" });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

function buildBlocks(state: EditorState, getCtx: GetCtx): DecorationSet {
  if (!getCtx()) return Decoration.none;
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  for (const b of findBlocks(state)) {
    const a = state.doc.lineAt(b.from).number;
    const z = state.doc.lineAt(b.to).number;
    let hit = false;
    for (let n = a; n <= z && !hit; n++) hit = active.has(n);
    if (hit) continue;
    const widget = b.kind === "comment" ? new HiddenBlock(z - a + 1) : new BlockWidget(state.sliceDoc(b.from, b.to), b.kind, b.from, getCtx);
    ranges.push(Decoration.replace({ widget, block: true }).range(b.from, b.to));
  }
  return Decoration.set(ranges, true);
}

function blockField(getCtx: GetCtx) {
  return StateField.define<DecorationSet>({
    create: (state) => buildBlocks(state, getCtx),
    update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? buildBlocks(tr.state, getCtx) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}

// ── 줄 안 ──

class InlineImage extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly width: string | null,
  ) {
    super();
  }
  eq(o: InlineImage) {
    return o.url === this.url && o.width === this.width;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-inline-img";
    img.src = this.url;
    img.alt = this.alt;
    if (this.width) img.width = Number(this.width);
    return img;
  }
}

class InlineMath extends WidgetType {
  constructor(
    readonly tex: string,
    readonly getCtx: GetCtx,
  ) {
    super();
  }
  eq(o: InlineMath) {
    return o.tex === this.tex;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-math";
    const el = document.createElement("span");
    el.className = "math";
    el.dataset.tex = encodeURIComponent(this.tex);
    el.textContent = this.tex;
    wrap.append(el);
    const ctx = this.getCtx();
    if (ctx) enhance(wrap, { resolver: ctx.resolver, docPath: ctx.docPath });
    return wrap;
  }
}

class FootnoteRef extends WidgetType {
  constructor(readonly id: string) {
    super();
  }
  eq(o: FootnoteRef) {
    return o.id === this.id;
  }
  toDOM() {
    const el = document.createElement("sup");
    el.className = "cm-lp-fnref";
    el.textContent = `[${this.id}]`;
    return el;
  }
}

const hide = Decoration.replace({});
const footnoteLine = Decoration.line({ class: "cm-lp-footnote" });

function buildInline(view: EditorView, getCtx: GetCtx): DecorationSet {
  const ctx = getCtx();
  if (!ctx) return Decoration.none;
  const { state } = view;
  const active = activeLines(state);
  const items: Range<Decoration>[] = [];
  const code: [number, number][] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode" || n.name === "HTMLBlock") {
          code.push([n.from, n.to]);
          return false;
        }
        return undefined;
      },
    });
  }
  const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos < b);
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (active.has(line.number) || inCode(line.from)) continue;
      const text = line.text;
      const at = (i: number) => line.from + i;
      // 이미지 임베드(줄 안에 다른 글이 있을 때만: 혼자면 블록으로 그린다)
      const alone = /^\s*!\[(\[[^\]\n]+\]|[^\]\n]*\]\([^)\n]+\))\]?\s*$/.test(text);
      if (!alone) {
        for (const m of text.matchAll(/!\[\[([^\]|#\n]+)(?:\|(\d+))?[^\]\n]*\]\]/g)) {
          const target = m[1].trim();
          const resolved = ctx.resolver.resolve(target, ctx.docPath);
          if (!resolved || !IMAGE_EXT.test(resolved) || inCode(at(m.index!))) continue;
          items.push(
            Decoration.replace({ widget: new InlineImage(api.rawUrl(resolved), target, m[2] ?? null) }).range(at(m.index!), at(m.index! + m[0].length)),
          );
        }
      }
      // 인라인 수식 $…$(여는 $ 뒤·닫는 $ 앞이 공백이 아니고, 닫는 $ 뒤가 숫자가 아님)
      for (const m of text.matchAll(/(?<![\\$])\$(?=\S)([^$\n]*?\S)\$(?![\d$])/g)) {
        const s = at(m.index!);
        if (inCode(s) || text.trim().startsWith("$$")) continue;
        items.push(Decoration.replace({ widget: new InlineMath(m[1], getCtx) }).range(s, s + m[0].length));
      }
      // 주석 %%…%%(한 줄 안)
      for (const m of text.matchAll(/%%[^\n]*?%%/g)) {
        const s = at(m.index!);
        if (!inCode(s)) items.push(hide.range(s, s + m[0].length));
      }
      // 블록 ID: 줄 끝 ^id
      const bid = /\s\^[A-Za-z0-9-]+\s*$/.exec(text) ?? /^\^[A-Za-z0-9-]+\s*$/.exec(text);
      if (bid) items.push(hide.range(at(bid.index), line.to));
      // 각주 정의 줄과 참조
      const def = /^\[\^([^\]\s]+)\]:\s?/.exec(text);
      if (def) {
        items.push(footnoteLine.range(line.from));
        items.push(Decoration.replace({ widget: new FootnoteRef(def[1]) }).range(line.from, at(def[0].length)));
      }
      for (const m of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
        const s = at(m.index!);
        if (def && m.index === 0) continue;
        if (!inCode(s)) items.push(Decoration.replace({ widget: new FootnoteRef(m[1]) }).range(s, s + m[0].length));
      }
    }
  }
  // 겹치는 바꾸기는 앞의 것만
  items.sort((a, b) => a.from - b.from || b.to - a.to);
  const out: Range<Decoration>[] = [];
  let until = -1;
  for (const r of items) {
    const replace = r.value.spec.widget !== undefined || r.value === hide;
    if (replace) {
      if (r.from < until) continue;
      until = r.to;
    }
    out.push(r);
  }
  return Decoration.set(out, true);
}

function inlinePlugin(getCtx: GetCtx) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInline(view, getCtx);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState))
          this.decorations = buildInline(u.view, getCtx);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const theme = EditorView.baseTheme({
  ".cm-lp-block": { padding: "4px 0", cursor: "pointer", fontFamily: "var(--font-sans)", whiteSpace: "normal" },
  ".cm-lp-block > :first-child": { marginTop: "0" },
  ".cm-lp-block > :last-child": { marginBottom: "0" },
  ".cm-lp-block img": { maxWidth: "100%" },
  ".cm-lp-image p": { margin: "0" },
  ".cm-lp-hidden-comment": { fontSize: "12px", color: "var(--muted)", fontFamily: "var(--font-sans)", padding: "2px 0" },
  ".cm-lp-inline-img": { maxWidth: "100%", verticalAlign: "middle", maxHeight: "12em" },
  ".cm-lp-fnref": { color: "var(--accent)", fontSize: "0.75em", lineHeight: "0" },
  ".cm-lp-footnote": { fontSize: "0.9em", color: "var(--muted)" },
});

export function liveBlocks(getCtx: GetCtx): Extension {
  return [blockField(getCtx), inlinePlugin(getCtx), theme];
}
