import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, lineNumbers, type BlockInfo } from "@codemirror/view";

/** 줄 번호로 고르는 한 덩어리의 문서 위치 */
export interface Span {
  from: number;
  to: number;
}

/**
 * 줄 번호 하나가 가리키는 범위: 화면의 한 줄 블록(접혀 있으면 접힌 내용까지) 맨 앞~맨 끝.
 * 끝의 줄바꿈은 넣지 않는다 — 복사했을 때 줄바꿈이 딸려 오지 않게.
 */
export function lineSpan(block: Pick<BlockInfo, "from" | "to">): Span {
  return { from: block.from, to: block.to };
}

/**
 * base 에서 cur 까지 줄 단위로 고른다(둘을 합친 범위).
 * cur 가 base 보다 위에서 시작하면 방향만 뒤집는다(head 가 위) — 범위는 같다.
 * base 가 한 점(Shift+누르기의 기준점)이고 cur 가 그 점이 든 줄이면 기준점은 지키고 줄 끝까지만 고른다.
 */
export function spanSelection(base: Span, cur: Span): EditorSelection {
  if (base.from === base.to && cur.from <= base.from && base.from <= cur.to) return EditorSelection.single(base.from, cur.to);
  const from = Math.min(base.from, cur.from);
  const to = Math.max(base.to, cur.to);
  return cur.from < base.from ? EditorSelection.single(to, from) : EditorSelection.single(from, to);
}

/**
 * Shift+누르기의 기준. 지금 선택이 줄 번호로 고른 그대로면 그때 처음 누른 줄 전체,
 * 아니면 지금 선택의 기준점(anchor) 한 점.
 */
export function shiftBase(selection: EditorSelection, last: { base: Span; sel: EditorSelection } | undefined): Span {
  if (last && last.sel.eq(selection)) return last.base;
  const { anchor } = selection.main;
  return { from: anchor, to: anchor };
}

/** 뷰마다 줄 번호로 마지막에 고른 것(Shift+누르기가 처음 누른 줄을 기준으로 넓히게) */
const lastPick = new WeakMap<EditorView, { base: Span; sel: EditorSelection }>();

/** 뷰마다 진행 중인 끌기를 끝내는 함수 */
const activeDrag = new WeakMap<EditorView, () => void>();

/**
 * 끌기 중 문서가 바뀌거나 뷰가 사라지면 그 끌기를 끝낸다.
 * 끌기의 기준 줄은 누를 때의 문서 위치라, 바뀐 문서에 쓰면 문서 밖을 고르거나(RangeError) 엉뚱한 줄을 고른다.
 */
const endDragOnChange = ViewPlugin.define((view) => ({
  update: (update) => {
    if (update.docChanged) activeDrag.get(view)?.();
  },
  destroy: () => activeDrag.get(view)?.(),
}));

// 끌다가 가장자리에 닿으면 굴리는 기준. CodeMirror 본문 끌기(MouseSelection)와 같은 값이다.
const DRAG_SCROLL_MARGIN = 6;
const dragScrollSpeed = (dist: number) => Math.max(0, dist) * 0.7 + 8;

/** 세로로 굴러가는 가장 가까운 조상(없으면 창이 구른다) */
function scrollParent(view: EditorView): HTMLElement | null {
  for (let cur = view.contentDOM.parentElement; cur && cur !== view.dom.ownerDocument.body; cur = cur.parentElement) {
    if (cur.scrollHeight > cur.clientHeight) return cur;
  }
  return null;
}

/**
 * 줄 번호 칸에서 시작한 누르기·끌기를 직접 처리한다.
 * CodeMirror 는 본문(contentDOM)의 마우스만 처리하고 줄 번호 칸은 브라우저에 맡겨,
 * 누르면 아무것도 안 골라지고 끌면 줄 번호 글자가 골라진다.
 */
function pickLines(view: EditorView, block: BlockInfo, event: MouseEvent): boolean {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return false;
  const base = event.shiftKey ? shiftBase(view.state.selection, lastPick.get(view)) : lineSpan(block);
  const select = (cur: Span) => {
    const sel = spanSelection(base, cur);
    lastPick.set(view, { base, sel });
    if (!sel.eq(view.state.selection)) view.dispatch({ selection: sel, userEvent: "select.pointer" });
  };
  select(lineSpan(block));
  if (!view.hasFocus) view.focus();

  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  const scroller = scrollParent(view);
  let y = event.clientY;
  let speed = 0;
  let timer = -1;
  const atPointer = () => select(lineSpan(view.lineBlockAtHeight(y - view.documentTop)));
  const scroll = () => {
    if (scroller) scroller.scrollTop += speed;
    else win.scrollBy(0, speed);
    atPointer();
  };
  const move = (e: MouseEvent) => {
    if (!e.buttons) return done();
    y = e.clientY;
    atPointer();
    const { top, bottom } = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: win.innerHeight };
    speed = y <= top + DRAG_SCROLL_MARGIN ? -dragScrollSpeed(top - y) : y >= bottom - DRAG_SCROLL_MARGIN ? dragScrollSpeed(y - bottom) : 0;
    if (speed && timer < 0) timer = win.setInterval(scroll, 50);
    else if (!speed && timer >= 0) {
      clearInterval(timer);
      timer = -1;
    }
  };
  const done = () => {
    clearInterval(timer);
    doc.removeEventListener("mousemove", move);
    doc.removeEventListener("mouseup", done);
    if (activeDrag.get(view) === done) activeDrag.delete(view);
  };
  activeDrag.get(view)?.();
  activeDrag.set(view, done);
  doc.addEventListener("mousemove", move);
  doc.addEventListener("mouseup", done);
  // 기본 동작(포커스 이동, 줄 번호 글자 고르기)을 막는다
  return true;
}

/** 줄 번호 칸. 누르기·끌기·Shift+누르기로 줄을 고르되 마지막 줄의 줄바꿈은 넣지 않는다 */
export function lineNumberGutter(): Extension {
  return [lineNumbers({ domEventHandlers: { mousedown: (view, block, event) => pickLines(view, block, event as MouseEvent) } }), endDragOnChange];
}
