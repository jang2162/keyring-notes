import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { enhance } from "./enhance";
import { encodeSource, renderMarkdown, vaultRelative, type LinkResolver } from "./markdown";
import { api } from "./api";
import { t } from "./i18n";
import { CALLOUT_LINE } from "./liveSyntax";
import { inlineImageUrl, isCommentBlock } from "./liveImage";
import { widgetBlockAt, widgetBlockOfNode, widgetEditField } from "./widgets/blockEdit";
import { KeyringBlockWidget } from "./widgets/liveWidget";

/**
 * Live Preview에서 8단계 형식을 그린다. 커서(선택)가 그 블록 밖에 있을 때만 그리고, 들어가면 원문을 보인다.
 * 렌더러는 미리보기와 같은 것(markdown.ts의 renderMarkdown, enhance.ts의 KaTeX·Mermaid·문서 임베드)을 쓴다.
 *
 *   블록(줄 전체를 바꾼다): 이미지·문서 임베드만 있는 줄, 콜아웃(> [!note]), 수식 블록($$…$$), Mermaid,
 *                          여러 줄 주석(%%…%%만 있는 줄들), HTML 블록(<!-- … --> 주석 하나뿐인 것은 빼고)
 *   줄 안: 이미지 임베드·![글](주소), 인라인 수식 $…$, 주석 %%…%% 숨기기, 블록 ID ^id 숨기기, 각주 [^1] → 위첨자, 각주 정의 줄
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

/**
 * 블록 위젯의 DOM 을 미리보기 렌더러로 채운다. 렌더러가 던지면 원문 글자로 떨어지고 예외는 콘솔에 남긴다.
 * 위젯의 toDOM 이 던지면 편집기가 그리다 멈추고, 예외가 편집기를 만든 React effect 를 타고 루트까지 올라가 화면이 통째로 내려간다.
 * 그 노트의 탭이 배치에 남아 새로 고쳐도 다시 죽는다 — 표 칸(tableWidget.ts 의 paintCell)과 줄 안 수식도 같은 이유로 막는다
 */
export function paintBlock(el: HTMLElement, src: string, ctx: LiveRenderContext, alive: () => boolean) {
  try {
    el.innerHTML = renderMarkdown(src, { resolver: ctx.resolver, docPath: ctx.docPath, hideFrontmatter: true, docId: "lp" }).html;
    // 위젯·할 일 체크는 원문을 고치는 것이라 여기서는 하지 않는다
    for (const box of el.querySelectorAll<HTMLInputElement>("input.task")) box.disabled = true;
    enhance(el, { resolver: ctx.resolver, docPath: ctx.docPath }, alive);
  } catch (e) {
    console.error("keyring: live preview block failed", e);
    el.textContent = src;
    el.classList.add("cm-lp-failed");
  }
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
    paintBlock(el, this.src, ctx, () => el.isConnected || !view.dom.isConnected);
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

/** 문서 순서·비중첩 범위들에 대해, 늘기만 하는 위치가 어느 범위 안(양 끝 포함)인가 */
function sweep(ranges: readonly { from: number; to: number }[]): (pos: number) => boolean {
  let i = 0;
  return (pos) => {
    while (i < ranges.length && ranges[i]!.to < pos) i++;
    return i < ranges.length && pos >= ranges[i]!.from;
  };
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
        else if (widgetBlockOfNode(state, n.node)) out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "keyring-widget" });
        return false;
      }
      if (n.name === "HTMLBlock") {
        code.push([n.from, n.to]);
        // 붙여넣기 업로드 자리 표시(<!-- uploading… -->)가 주석 블록이다 — 그리면 업로드 중인 줄이 사라져 보인다
        if (!isCommentBlock(doc.sliceString(n.from, n.to))) out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "html" });
        return false;
      }
      if (n.name === "CodeBlock") {
        code.push([n.from, n.to]);
        return false;
      }
      if (n.name === "Blockquote") {
        const first = doc.lineAt(n.from);
        if (CALLOUT_LINE.test(first.text)) out.push({ from: first.from, to: doc.lineAt(n.to).to, kind: "callout" });
        return false;
      }
      return undefined;
    },
  });
  // 아래 줄 루프는 위치가 늘기만 하므로 포인터로 훑는다. 줄마다 목록 전체를 보면 줄 × 블록이라 펜스가 많은 큰 문서에서 키마다 수십 ms 다.
  // 둘 다 문서 순서이고 겹치지 않는다(트리 순회가 위 블록에서 return false 로 안을 보지 않는다). 루프가 out 에 더하는 블록은
  // 그 줄 뒤로 i 를 넘기므로 taken 이 볼 필요가 없다 — 그래서 트리에서 찾은 것만 본다
  const inCode = sweep(code.map(([from, to]) => ({ from, to })));
  const taken = sweep(out.slice());
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

/** 시험용: 블록으로 그릴 범위 */
export function liveBlockRanges(state: EditorState): { from: number; to: number; kind: string }[] {
  return findBlocks(state);
}

/** 커서가 블록 줄에 걸치면 원문. 단 수정 중인 위젯 블록은 커서가 걸쳐도 그린다(수정 모드가 원문으로 바뀌지 않게) */
export function shouldDrawBlock(lines: [number, number], active: Set<number>, editing: boolean): boolean {
  if (editing) return true;
  for (let n = lines[0]; n <= lines[1]; n++) if (active.has(n)) return false;
  return true;
}

function buildBlocks(state: EditorState, getCtx: GetCtx): DecorationSet {
  if (!getCtx()) return Decoration.none;
  const active = activeLines(state);
  const edit = state.field(widgetEditField, false);
  const ranges: Range<Decoration>[] = [];
  for (const b of findBlocks(state)) {
    const a = state.doc.lineAt(b.from).number;
    const z = state.doc.lineAt(b.to).number;
    const editing = b.kind === "keyring-widget" && !!edit && !edit.gone && edit.from === b.from;
    if (!shouldDrawBlock([a, z], active, editing)) continue;
    const widget =
      b.kind === "comment"
        ? new HiddenBlock(z - a + 1)
        : b.kind === "keyring-widget"
          ? new KeyringBlockWidget(widgetBlockAt(state, b.from)?.body ?? "", b.from, () => getCtx()?.docPath ?? "")
          : new BlockWidget(state.sliceDoc(b.from, b.to), b.kind, b.from, getCtx);
    ranges.push(Decoration.replace({ widget, block: true }).range(b.from, b.to));
  }
  return Decoration.set(ranges, true);
}

/**
 * 장식을 다시 계산할 트랜잭션. 위젯 수정 시작·끝은 효과만 있는 트랜잭션이라 문서·선택·트리 조건만으로는 놓친다 —
 * 필드가 바뀌지 않으면 같은 객체를 돌려주므로(blockEdit.ts) 참조 비교로 충분하다
 */
export function blockFieldNeedsUpdate(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    !!tr.selection ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
    tr.startState.field(widgetEditField, false) !== tr.state.field(widgetEditField, false)
  );
}

function blockField(getCtx: GetCtx) {
  return StateField.define<DecorationSet>({
    create: (state) => buildBlocks(state, getCtx),
    update: (deco, tr) => (blockFieldNeedsUpdate(tr) ? buildBlocks(tr.state, getCtx) : deco),
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
    el.dataset.tex = encodeSource(this.tex);
    el.textContent = this.tex;
    wrap.append(el);
    const ctx = this.getCtx();
    try {
      if (ctx) enhance(wrap, { resolver: ctx.resolver, docPath: ctx.docPath });
    } catch (e) {
      // 원문은 이미 글자로 들어 있다(paintBlock 의 이유)
      console.error("keyring: live preview math failed", e);
    }
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
  const images: { from: number; to: number; alt: string; url: string }[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        // 표는 표 편집기(tableWidget.ts)가 칸마다 그린다
        if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode" || n.name === "HTMLBlock" || n.name === "Table") {
          code.push([n.from, n.to]);
          return false;
        }
        if (n.name === "Image") {
          const marks = n.node.getChildren("LinkMark");
          const url = n.node.getChild("URL");
          if (url && marks.length >= 2)
            images.push({ from: n.from, to: n.to, alt: state.sliceDoc(marks[0].to, marks[1].from), url: state.sliceDoc(url.from, url.to) });
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
      if (!alone) {
        for (const img of images) {
          if (img.from < line.from || img.to > line.to) continue;
          const src = inlineImageUrl(img.url, (target) => ctx.resolver.resolve(vaultRelative(ctx.docPath, target), ctx.docPath), api.rawUrl);
          if (src) items.push(Decoration.replace({ widget: new InlineImage(src, img.alt, null) }).range(img.from, img.to));
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
  // 그리지 못해 원문 글자로 떨어진 블록(paintBlock): 줄바꿈을 지킨다
  ".cm-lp-block.cm-lp-failed": { whiteSpace: "pre-wrap" },
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
