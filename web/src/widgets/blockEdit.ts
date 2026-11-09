import { StateEffect, StateField, type EditorState, type StateEffectType, type Transaction, type TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { KEYRING_WIDGET_LANG, parseWidgetBlock, serializeWidgetBlock, withWidgetState } from "@keyring-notes/core";
import { frontmatterEnd } from "../liveSyntax";

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolve"]>;

/**
 * ```keyring-widget 블록을 편집기 상태 위에서 찾고 다시 쓰는 순수 함수와, 칸마다 수정 중인 위젯 하나를 따라가는 필드.
 * 「상태가 바뀌는 길」의 정본은 docs/superpowers/specs/2026-11-09-keyring-widget-design.md 「실행」.
 */

export interface WidgetBlockRange {
  /** 여는 펜스 줄 처음 ~ 닫는 펜스 줄 끝 */
  from: number;
  to: number;
  /** 펜스 사이 글(첫 본문 줄 처음 ~ 마지막 본문 줄 끝). 본문 줄이 없으면 둘 다 닫는 펜스 줄 처음 */
  bodyFrom: number;
  bodyTo: number;
  body: string;
  /** 여는 펜스 줄 번호(1부터) */
  line: number;
}

/**
 * 위젯 블록은 문서 최상위(Document 바로 아래)이고 닫힌 펜스만이다 — 인용·목록 안 줄은 접두가 붙어 있어 본문을 통째로 다시 쓸 수 없다.
 * 표 편집기의 topTables 와 같은 범위.
 */
export function widgetBlockOfNode(state: EditorState, node: SyntaxNode): WidgetBlockRange | null {
  if (node.name !== "FencedCode" || node.parent?.name !== "Document") return null;
  const info = node.getChild("CodeInfo");
  if (!info || state.sliceDoc(info.from, info.to).split(/\s/, 1)[0] !== KEYRING_WIDGET_LANG) return null;
  if (node.getChildren("CodeMark").length < 2) return null;
  const doc = state.doc;
  const fm = frontmatterEnd(state);
  if (fm !== null && node.from <= doc.line(fm).to) return null;
  const open = doc.lineAt(node.from);
  const close = doc.lineAt(node.to);
  if (close.number <= open.number) return null;
  const bodyFrom = close.number === open.number + 1 ? close.from : doc.line(open.number + 1).from;
  const bodyTo = close.number === open.number + 1 ? close.from : doc.line(close.number - 1).to;
  return { from: open.from, to: close.to, bodyFrom, bodyTo, body: state.sliceDoc(bodyFrom, bodyTo), line: open.number };
}

/** 문서 최상위·닫힌 ```keyring-widget 펜스(정보 문자열 첫 낱말이 keyring-widget) */
export function widgetBlocks(state: EditorState): WidgetBlockRange[] {
  const out: WidgetBlockRange[] = [];
  const c = syntaxTree(state).cursor();
  if (!c.firstChild()) return out;
  do {
    if (c.name !== "FencedCode") continue;
    const b = widgetBlockOfNode(state, c.node);
    if (b) out.push(b);
  } while (c.nextSibling());
  return out;
}

/**
 * 그 자리 노드만 본다 — 큰 문서에서 펜스마다 전체를 훑지 않게.
 * 줄 처음이 아니라 첫 공백 아닌 글자(펜스 시작 문자)에서 resolve 한다: 1~3칸 들여쓴 최상위 펜스는 줄 처음에서 Document 만 나온다.
 */
export function widgetBlockAt(state: EditorState, from: number): WidgetBlockRange | null {
  if (from < 0 || from > state.doc.length) return null;
  const line = state.doc.lineAt(from);
  const pos = line.from + (line.text.length - line.text.trimStart().length);
  if (pos >= line.to) return null;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== "FencedCode") continue;
    if (n.from < line.from) return null;
    return widgetBlockOfNode(state, n);
  }
  return null;
}

export function widgetBlockAtLine(state: EditorState, line: number): WidgetBlockRange | null {
  if (line < 1 || line > state.doc.lines) return null;
  const b = widgetBlockAt(state, state.doc.line(line).from);
  return b && b.line === line ? b : null;
}

/** 지금 블록 본문 위에 상태를 얹은 새 본문. 본문이 깨졌으면 null */
export function nextWidgetBody(body: string, state: unknown, version: number): string | null {
  const r = parseWidgetBlock(body);
  return r.ok ? serializeWidgetBlock(withWidgetState(r.block, state, version)) : null;
}

/**
 * 본문을 body 로 바꾸는 트랜잭션. 같으면·읽기 전용이면 null.
 * isolateHistory 로 앞뒤 입력과 history 묶음을 가른다 — 본문 Mod+Z 한 번이 위젯 변경 하나만 되돌리게.
 */
export function rewriteWidgetBlock(state: EditorState, block: WidgetBlockRange, body: string): TransactionSpec | null {
  if (state.readOnly || body === block.body) return null;
  // 본문 줄이 없는 블록(여는 펜스 바로 다음이 닫는 펜스)은 닫는 펜스 앞에 줄을 하나 만든다
  const noBodyLine = block.bodyFrom === state.doc.lineAt(block.to).from;
  const insert = noBodyLine ? body + "\n" : body;
  return { changes: { from: block.bodyFrom, to: block.bodyTo, insert }, userEvent: "input.widget", annotations: isolateHistory.of("full") };
}

/**
 * focus: 위젯 안 포커스 자리(순번) — 다시 붙은 위젯이 이어받는다.
 * base: 수정을 시작한 때 상태. 수정이 이어지는 동안 한 번만 정해진다 — 이어받는 위젯이 지금 블록 상태로 다시 잡으면
 * 바꾸지 않은 초안이 그사이 들어온 바깥 변경을 되돌린다.
 * owner: 수정을 시작한 호스트("live"·"preview"). 나란히 보기에서 같은 블록을 그리는 다른 호스트가 남의 수정을 이어받지 않게.
 */
export interface WidgetEdit {
  from: number;
  draft: unknown;
  base: unknown;
  owner: string;
  gone: boolean;
  focus: number | null;
}

/** draft 는 시작 때 상태와 같으므로 base 가 된다 */
export interface WidgetEditStart {
  from: number;
  draft: unknown;
  owner?: string;
}

export const startWidgetEdit: StateEffectType<WidgetEditStart> = StateEffect.define<WidgetEditStart>({
  map: (v, m) => ({ ...v, from: m.mapPos(v.from, 1) }),
});
export const setWidgetDraft: StateEffectType<unknown> = StateEffect.define<unknown>();
export const setWidgetFocus: StateEffectType<number | null> = StateEffect.define<number | null>();
export const endWidgetEdit: StateEffectType<null> = StateEffect.define<null>();

/**
 * 칸마다 수정 중인 위젯 하나. from 은 mapPos(from, 1) 로 그 자리 바로 앞에 넣은 글 뒤로 따라간다.
 * 바뀐 것이 없으면 받은 객체를 그대로 돌려준다 — liveBlocks 의 장식 갱신 판정이 참조 비교에 기댄다.
 */
export const widgetEditField: StateField<WidgetEdit | null> = StateField.define<WidgetEdit | null>({
  create: () => null,
  update(value, tr) {
    let v = value;
    // 트리가 바뀐 것도 본다: 문서 변경 때 덜 파싱돼 미뤄 둔 판정을 파싱이 따라온 뒤에 한다
    if (v && (tr.docChanged || (!v.gone && syntaxTree(tr.startState) !== syntaxTree(tr.state)))) {
      const from = tr.docChanged ? tr.changes.mapPos(v.from, 1) : v.from;
      // 효과보다 먼저 옮긴다: 같은 트랜잭션의 효과 자리는 바뀐 뒤 문서 기준이다.
      // 한 번 gone 이면 되살아나도 그대로 — 알림·초안 버림은 한 번뿐이다.
      // 트리가 문서 끝까지 파싱되지 않았으면 null 은 「아직 모름」이라 gone 으로 치지 않는다(큰 노트·미리보기만 보는 칸의 숨은 편집기)
      const gone = v.gone || (widgetBlockAt(tr.state, from) === null && syntaxTreeAvailable(tr.state));
      if (from !== v.from || gone !== v.gone) v = { ...v, from, gone };
    }
    for (const e of tr.effects) {
      if (e.is(startWidgetEdit)) v = { from: e.value.from, draft: e.value.draft, base: e.value.draft, owner: e.value.owner ?? "", gone: false, focus: null };
      else if (e.is(endWidgetEdit)) v = null;
      else if (v && e.is(setWidgetDraft)) v = { ...v, draft: e.value };
      else if (v && e.is(setWidgetFocus) && v.focus !== e.value) v = { ...v, focus: e.value };
    }
    return v;
  },
});

/**
 * 다시 붙는 위젯(편집기가 화면 밖으로 치웠다 다시 만든 것, 다시 그려진 미리보기)이 이어받을 것.
 * 그 호스트가 시작한 수정이고(owner) 이 블록이며(here) 블록이 남아 있을 때만 — 나란히 보기에서 다른 호스트가 남의 수정을 열지 않게
 */
export function widgetResume(
  edit: Pick<WidgetEdit, "draft" | "base" | "owner" | "gone" | "focus"> | null | undefined,
  owner: string,
  here: boolean,
): { draft: unknown; base: unknown; focus: number | null } | null {
  return edit && !edit.gone && edit.owner === owner && here ? { draft: edit.draft, base: edit.base, focus: edit.focus } : null;
}

/** 이 트랜잭션에서 gone 이 false → true 로 바뀌었는가 */
export function widgetGoneNow(tr: Transaction): boolean {
  const before = tr.startState.field(widgetEditField, false);
  const after = tr.state.field(widgetEditField, false);
  return !!after?.gone && !before?.gone;
}
