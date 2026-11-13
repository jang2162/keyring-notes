import { syntaxTree } from "@codemirror/language";
import { StateField, type ChangeDesc, type EditorState, type Extension, type Range, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { enhance } from "./enhance";
import { encodeSource, renderMarkdown, vaultRelative, type LinkResolver } from "./markdown";
import { api } from "./api";
import { t } from "./i18n";
import { CALLOUT_LINE, frontmatterEnd } from "./liveSyntax";
import { matchChunks, topChunks, type TopChunk } from "./treeChunks";
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

interface Span {
  from: number;
  to: number;
}

interface Block extends Span {
  kind: string;
}

/** 트리에서 찾는 것. 문서 순서이고 겹치지 않는다(아래 블록을 찾으면 그 안을 보지 않는다) */
interface TreeScan {
  /** 줄 루프가 보지 않을 범위(코드·HTML 블록) */
  code: Span[];
  /** 트리 노드로 정해지는 블록(mermaid·위젯·HTML·콜아웃) */
  blocks: Block[];
  /** blocks 마다 그 노드의 시작 — 블록 from 은 줄 처음이라 노드보다 앞일 수 있다. 덩어리별로 옛 결과를 옮길 때 쓴다 */
  blockAt: number[];
}

/**
 * 블록 찾기 결과와, 다음 트랜잭션에서 바뀐 범위만 다시 보는 데 쓰는 중간 결과.
 * lines 는 줄 루프가 찾은 블록(수식·주석·임베드), blocks 는 트리 블록과 합쳐 from 순으로 늘어놓은 것.
 * doc·chunks·frontmatter 는 그때의 문서·최상위 덩어리·프런트매터 닫는 줄 — 다음 갱신이 옛 트리와 맞대 본다
 */
export interface BlockScan {
  tree: TreeScan;
  lines: Block[];
  blocks: Block[];
  doc: Text;
  chunks: TopChunk[];
  frontmatter: number | null;
}

/** pos 이상인 to 를 가진 첫 범위의 순번 */
function firstEndingAtOrAfter(ranges: readonly Span[], pos: number): number {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid]!.to < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 문서 순서·비중첩 범위들에 대해, start 부터 늘기만 하는 위치가 어느 범위 안(양 끝 포함)인가 */
function sweep(ranges: readonly Span[], start: number): (pos: number) => boolean {
  let i = firstEndingAtOrAfter(ranges, start);
  return (pos) => {
    while (i < ranges.length && ranges[i]!.to < pos) i++;
    return i < ranges.length && pos >= ranges[i]!.from;
  };
}

/**
 * visitNode 가 찾는 넷(펜스·HTML·들여쓴 코드·인용)이 올 수 있는 노드만 들어간다. 마크다운에서 블록을 품는 것은 문서·목록 항목·인용뿐이고
 * 인용은 들어가지 않는다 — 문단·제목·표 안은 줄 안 노드뿐이라 들어가도 찾을 것이 없는데, 큰 문서에서 그 노드를 다 훑는 값이 든다.
 * 모든 노드에 들어가는 기준 구현과 결과가 같은지는 liveBlocks.test.ts 의 퍼즈가 맞대 본다
 */
const BLOCK_CONTAINERS = new Set(["Document", "BulletList", "OrderedList", "ListItem"]);

type Cursor = ReturnType<ReturnType<typeof syntaxTree>["cursor"]>;

/** 커서 자리 노드에서(블록을 품는 노드면 그 안까지) 찾아 out 에 더한다. 커서는 그 노드로 돌아온다 */
function visitNode(state: EditorState, c: Cursor, out: TreeScan) {
  const doc = state.doc;
  const name = c.name;
  let kind: string | null = null;
  if (name === "FencedCode") {
    out.code.push({ from: c.from, to: c.to });
    const info = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(doc.lineAt(c.from).text)?.[2];
    kind = info === "mermaid" ? "mermaid" : widgetBlockOfNode(state, c.node) ? "keyring-widget" : null;
  } else if (name === "HTMLBlock") {
    out.code.push({ from: c.from, to: c.to });
    // 붙여넣기 업로드 자리 표시(<!-- uploading… -->)가 주석 블록이다 — 그리면 업로드 중인 줄이 사라져 보인다
    kind = isCommentBlock(doc.sliceString(c.from, c.to)) ? null : "html";
  } else if (name === "CodeBlock") {
    out.code.push({ from: c.from, to: c.to });
    return;
  } else if (name === "Blockquote") {
    kind = CALLOUT_LINE.test(doc.lineAt(c.from).text) ? "callout" : null;
  }
  if (name === "FencedCode" || name === "HTMLBlock" || name === "Blockquote") {
    if (kind) {
      out.blocks.push({ from: doc.lineAt(c.from).from, to: doc.lineAt(c.to).to, kind });
      out.blockAt.push(c.from);
    }
    return;
  }
  if (!BLOCK_CONTAINERS.has(name) || !c.firstChild()) return;
  do visitNode(state, c, out);
  while (c.nextSibling());
  c.parent();
}

/** 최상위 노드 중 시작이 from 이상 to 미만인 것만 본다 */
function scanTopRange(state: EditorState, from: number, to: number, out: TreeScan) {
  const c = syntaxTree(state).cursor();
  if (!c.childAfter(from)) return;
  do {
    if (c.from >= to) break;
    visitNode(state, c, out);
  } while (c.nextSibling());
}

/**
 * 트리 결과를 옛것에서 옮긴다. 옛 트리의 같은 덩어리 객체를 다시 쓴 자리(treeChunks.ts matchChunks)는 옛 결과를 옮기고,
 * 나머지 덩어리만 다시 본다. 트리는 바뀐 곳에서 먼 데까지 달라질 수 있지만(닫히지 않은 펜스 등) 그런 덩어리는 다시 쓰이지 않는다.
 * 덩어리 밖에서 오는 것은 위젯 블록 판정의 프런트매터뿐이라(widgetBlockOfNode) 그것이 달라질 수 있으면 다 다시 본다
 */
function updateTreeScan(prev: BlockScan, state: EditorState, changes: ChangeDesc, chunks: TopChunk[], frontmatter: number | null): TreeScan {
  const out: TreeScan = { code: [], blocks: [], blockAt: [] };
  let firstChange = Infinity;
  changes.iterChangedRanges((fromA) => (firstChange = Math.min(firstChange, fromA)));
  if (frontmatter !== prev.frontmatter || (frontmatter !== null && firstChange <= prev.doc.line(frontmatter).to)) {
    visitNode(state, syntaxTree(state).cursor(), out);
    return out;
  }
  const match = matchChunks(prev.chunks, chunks, changes, prev.doc);
  const old = prev.tree;
  let ci = 0;
  let bi = 0;
  for (let j = 0; j < chunks.length;) {
    const m = match[j]!;
    if (m < 0) {
      let k = j;
      while (k < chunks.length && match[k]! < 0) k++;
      scanTopRange(state, chunks[j]!.from, chunks[k - 1]!.to, out);
      j = k;
      continue;
    }
    const o = prev.chunks[m]!;
    const shift = chunks[j]!.from - o.from;
    while (ci < old.code.length && old.code[ci]!.from < o.from) ci++;
    for (; ci < old.code.length && old.code[ci]!.from < o.to; ci++) {
      const r = old.code[ci]!;
      out.code.push(shift ? { from: r.from + shift, to: r.to + shift } : r);
    }
    while (bi < old.blockAt.length && old.blockAt[bi]! < o.from) bi++;
    for (; bi < old.blockAt.length && old.blockAt[bi]! < o.to; bi++) {
      const b = old.blocks[bi]!;
      out.blocks.push(shift ? { from: b.from + shift, to: b.to + shift, kind: b.kind } : b);
      out.blockAt.push(old.blockAt[bi]! + shift);
    }
    j++;
  }
  return out;
}

/** 여는 줄을 포함해 닫는 줄을 찾는 줄 수: $$ 수식은 199줄 뒤까지, %% 주석은 499줄 뒤까지 */
const MATH_LOOKAHEAD = 200;
const COMMENT_LOOKAHEAD = 500;

/**
 * 줄 루프가 한 줄을 정할 때 그 줄과 그 뒤로 보는 줄 수(그 줄 포함). 증분 갱신이 바뀐 줄보다 이만큼 앞에서 다시 훑기 시작하는 근거라
 * 찾는 거리 둘에서 정한다 — 거리를 늘리면 다시 훑는 창도 따라 는다
 */
const LOOKAHEAD = Math.max(MATH_LOOKAHEAD, COMMENT_LOOKAHEAD);

/**
 * 줄 단위로: $$ 수식 블록, 여러 줄 주석, 임베드만 있는 줄. first 줄을 앞 블록에 걸치지 않은 줄로 보고 훑어 out 에 더한다.
 * 새로 정하는 줄(앞 블록 안이 아닌 줄)마다 stop 을 묻고 참이면 그 줄 번호를, 끝까지 가면 lines + 1 을 돌려준다.
 * 위치가 늘기만 하므로 코드·트리 블록 안인지는 포인터로 훑는다 — 줄마다 목록 전체를 보면 줄 × 블록이라 펜스가 많은 큰 문서에서 키마다 수십 ms 다.
 * 루프가 더하는 블록은 그 줄 뒤로 i 를 넘기므로 taken 은 트리 블록만 본다
 */
function scanLines(doc: Text, tree: TreeScan, first: number, out: Block[], stop?: (line: number) => boolean): number {
  const start = first <= doc.lines ? doc.line(first).from : doc.length;
  const inCode = sweep(tree.code, start);
  const taken = sweep(tree.blocks, start);
  for (let i = first; i <= doc.lines; i++) {
    if (stop?.(i)) return i;
    const line = doc.line(i);
    if (inCode(line.from) || taken(line.from)) continue;
    const t = line.text.trim();
    if (t.startsWith("$$")) {
      if (t.length > 4 && t.endsWith("$$")) {
        out.push({ from: line.from, to: line.to, kind: "math" });
        continue;
      }
      for (let j = i + 1; j <= doc.lines && j < i + MATH_LOOKAHEAD; j++) {
        if (doc.line(j).text.includes("$$")) {
          out.push({ from: line.from, to: doc.line(j).to, kind: "math" });
          i = j;
          break;
        }
      }
      continue;
    }
    if (t.startsWith("%%") && !(t.length > 2 && t.slice(2).includes("%%"))) {
      for (let j = i + 1; j <= doc.lines && j < i + COMMENT_LOOKAHEAD; j++) {
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
  return doc.lines + 1;
}

/** 둘 다 from 순. 같은 from 이면 트리 블록이 앞(한 목록에 모아 안정 정렬하던 순서) */
function mergeBlocks(tree: readonly Block[], lines: readonly Block[]): Block[] {
  const out: Block[] = [];
  let a = 0;
  let b = 0;
  while (a < tree.length || b < lines.length) {
    if (b >= lines.length || (a < tree.length && tree[a]!.from <= lines[b]!.from)) out.push(tree[a++]!);
    else out.push(lines[b++]!);
  }
  return out;
}

/** 블록으로 그릴 범위를 문서 전체에서 찾는다(코드 블록 안은 보지 않는다) */
export function liveBlockScan(state: EditorState): BlockScan {
  const tree: TreeScan = { code: [], blocks: [], blockAt: [] };
  visitNode(state, syntaxTree(state).cursor(), tree);
  const lines: Block[] = [];
  scanLines(state.doc, tree, 1, lines);
  return { tree, lines, blocks: mergeBlocks(tree.blocks, lines), doc: state.doc, chunks: topChunks(syntaxTree(state)), frontmatter: frontmatterEnd(state) };
}

/**
 * 트리 결과의 옛것(바뀐 뒤 위치로 옮긴 것)과 새것이 갈리는 범위(바뀐 뒤 위치). 같으면 null.
 * 앞·뒤에서 위치가 같은 짝을 걷어 내고 남은 가운데의 자리를 합친다. 짝이 맞은 범위 밖의 자리에서는
 * 「코드 안인가·트리 블록 안인가」 의 답이 옛 문서의 같은 자리와 같다
 */
function treeDiff<T extends Span>(prev: readonly T[], next: readonly T[], changes: ChangeDesc, same: (a: T, b: T) => boolean): Span | null {
  const mapped = (r: T): T => ({ ...r, from: changes.mapPos(r.from, -1), to: changes.mapPos(r.to, 1) });
  const eq = (a: T, b: T) => {
    const m = mapped(a);
    return m.from === b.from && m.to === b.to && same(a, b);
  };
  let head = 0;
  while (head < prev.length && head < next.length && eq(prev[head]!, next[head]!)) head++;
  let tail = 0;
  while (tail < prev.length - head && tail < next.length - head && eq(prev[prev.length - 1 - tail]!, next[next.length - 1 - tail]!)) tail++;
  let from = Infinity;
  let to = -Infinity;
  for (let i = head; i < prev.length - tail; i++) {
    const m = mapped(prev[i]!);
    from = Math.min(from, m.from);
    to = Math.max(to, m.to);
  }
  for (let i = head; i < next.length - tail; i++) {
    from = Math.min(from, next[i]!.from);
    to = Math.max(to, next[i]!.to);
  }
  return from <= to ? { from, to } : null;
}

/**
 * prev(바뀌기 전 상태의 결과)를 state 로 옮긴다. 결과는 liveBlockScan(state) 와 늘 같다 — 퍼즈 시험(liveBlocks.test.ts)이 맞대 본다.
 *
 * 트리 결과는 다시 쓰이지 않은 덩어리만 다시 본다(updateTreeScan). 줄 루프는 이렇게 좁힌다:
 * - 더러운 범위 = 바뀐 글 + 트리 결과가 옛것과 갈리는 범위. 그 밖의 줄은 글도, 코드·블록 안인지도 옛것과 같다.
 * - 한 줄의 판정은 그 줄부터 LOOKAHEAD 줄까지만 본다. 그래서 더러운 첫 줄보다 LOOKAHEAD - 1 줄 넘게 앞인 줄의 판정은 그대로이고,
 *   거기서부터 다시 훑는다(그 줄이 옛 블록 안이면 그 블록 다음 줄부터 — 그 블록도 그대로다).
 * - 더러운 끝 줄 뒤에서, 새로 정하는 줄이 옛 결과에서도 새로 정하던 줄이면 거기부터는 옛 결과를 옮겨 붙인다.
 *   맞지 않으면(수식 $$ 짝이 하나씩 밀렸을 때 등) 맞을 때까지, 끝까지라도 훑는다.
 * 더러운 범위는 하나로 합친다 — 덜 파싱된 트리가 편집과 같은 트랜잭션에서 멀리까지 자라면 그 사이를 다 훑는다(틀리지는 않고 느릴 뿐)
 */
export function updateLiveBlockScan(prev: BlockScan, state: EditorState, changes: ChangeDesc): BlockScan {
  const doc = state.doc;
  const chunks = topChunks(syntaxTree(state));
  const frontmatter = frontmatterEnd(state);
  const tree = updateTreeScan(prev, state, changes, chunks, frontmatter);
  const done = (lines: Block[]): BlockScan => ({ tree, lines, blocks: mergeBlocks(tree.blocks, lines), doc, chunks, frontmatter });
  let dFrom = Infinity;
  let dTo = -Infinity;
  changes.iterChangedRanges((_fA, _tA, fromB, toB) => {
    dFrom = Math.min(dFrom, fromB);
    dTo = Math.max(dTo, toB);
  });
  for (const d of [treeDiff(prev.tree.code, tree.code, changes, () => true), treeDiff(prev.tree.blocks, tree.blocks, changes, (a, b) => a.kind === b.kind)]) {
    if (!d) continue;
    dFrom = Math.min(dFrom, d.from);
    dTo = Math.max(dTo, d.to);
  }
  if (dFrom > dTo) {
    // 글도 트리 결과도 그대로다(위치만 옮길 것이 없다 — 문서가 바뀌었으면 위에서 범위가 생긴다)
    return done(prev.lines);
  }
  dFrom = Math.max(0, Math.min(dFrom, doc.length));
  dTo = Math.max(0, Math.min(dTo, doc.length));
  const firstDirty = doc.lineAt(dFrom).number;
  const lastDirty = doc.lineAt(dTo).number;

  // 다시 훑기 시작할 줄. 그 앞의 옛 블록은 위치가 그대로다(바뀐 글보다 앞)
  let first = Math.max(1, firstDirty - (LOOKAHEAD - 1));
  const firstPos = doc.line(first).from;
  let keep = 0;
  while (keep < prev.lines.length && prev.lines[keep]!.from < firstPos) keep++;
  const straddle = prev.lines[keep - 1];
  if (straddle && straddle.to >= firstPos) first = doc.lineAt(straddle.to).number + 1;
  const lines = prev.lines.slice(0, keep);

  // 바뀐 글 뒤에서는 옛 위치 = 새 위치 - delta
  const delta = changes.newLength - changes.length;
  let k = 0;
  let resume = -1;
  const stop = (i: number) => {
    if (i <= lastDirty) return false;
    const old = doc.line(i).from - delta;
    while (k < prev.lines.length && prev.lines[k]!.to < old) k++;
    // 옛 결과에서 이 줄이 블록 안(블록 첫 줄 뒤)이었으면 옛 판정을 이어 쓸 수 없다
    if (k < prev.lines.length && prev.lines[k]!.from < old) return false;
    resume = old;
    return true;
  };
  scanLines(doc, tree, first, lines, stop);
  if (resume >= 0) {
    for (let i = firstEndingAtOrAfter(prev.lines, resume); i < prev.lines.length; i++) {
      const b = prev.lines[i]!;
      if (b.from >= resume) lines.push(delta ? { from: b.from + delta, to: b.to + delta, kind: b.kind } : b);
    }
  }
  return done(lines);
}

/** 시험용: 블록으로 그릴 범위 */
export function liveBlockRanges(state: EditorState): { from: number; to: number; kind: string }[] {
  return liveBlockScan(state).blocks;
}

/** 커서가 블록 줄에 걸치면 원문. 단 수정 중인 위젯 블록은 커서가 걸쳐도 그린다(수정 모드가 원문으로 바뀌지 않게) */
export function shouldDrawBlock(lines: [number, number], active: Set<number>, editing: boolean): boolean {
  if (editing) return true;
  for (let n = lines[0]; n <= lines[1]; n++) if (active.has(n)) return false;
  return true;
}

function buildBlocks(state: EditorState, blocks: readonly Block[], getCtx: GetCtx): DecorationSet {
  const active = activeLines(state);
  const edit = state.field(widgetEditField, false);
  const ranges: Range<Decoration>[] = [];
  for (const b of blocks) {
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

/** scan 은 그린 상태의 블록 찾기 결과. 그릴 맥락이 없으면 null — 다음에 맥락이 생기면 처음부터 찾는다 */
interface BlockField {
  scan: BlockScan | null;
  deco: DecorationSet;
}

const NO_BLOCKS: BlockField = { scan: null, deco: Decoration.none };

function blockField(getCtx: GetCtx) {
  const draw = (state: EditorState, scan: BlockScan): BlockField => ({ scan, deco: buildBlocks(state, scan.blocks, getCtx) });
  return StateField.define<BlockField>({
    create: (state) => (getCtx() ? draw(state, liveBlockScan(state)) : NO_BLOCKS),
    update: (v, tr) => {
      if (!blockFieldNeedsUpdate(tr)) return v;
      if (!getCtx()) return NO_BLOCKS;
      // 선택·위젯 수정만 바뀌었으면 찾은 블록은 그대로이고 그릴지(커서가 걸쳤는지)만 다시 정한다
      const moved = tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState);
      const scan = !v.scan ? liveBlockScan(tr.state) : moved ? updateLiveBlockScan(v.scan, tr.state, tr.changes) : v.scan;
      return draw(tr.state, scan);
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
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
