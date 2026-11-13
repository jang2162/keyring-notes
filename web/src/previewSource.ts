import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { parseWidgetBlock } from "@keyring-notes/core";
import { nextWidgetBody, rewriteWidgetBlock, widgetBlockAtLine } from "./widgets/blockEdit";
import type { ViewMode } from "./panes";

/**
 * 칸의 미리보기를 어떻게 그릴까.
 * - skip: 미리보기가 안 보인다(편집만). 그리지 않는다 — 미리보기 칸은 CSS 로만 숨으므로 그리면 키마다 문서 전체를
 *   markdown-it·DOMPurify·innerHTML 로 다시 만든다(큰 문서에서 글자당 수백 ms).
 * - settle: 나란히 보기. 입력이 멈춘 뒤(PREVIEW_SETTLE_MS) 그린다. useDeferredValue 는 고르지 않았다 — 미뤄진 렌더도
 *   renderMarkdown 한 번(수백 ms)을 끊지 못하고 통째로 돌아서, 계속 치는 동안 매 글자가 그 렌더 뒤에 줄을 선다.
 * - now: 미리보기만·과거 판. 바뀌면 바로 그린다(이 칸에서 치는 글이 없다).
 */
export type PreviewPlan = "skip" | "settle" | "now";

/** 입력이 이만큼 멈추면 나란히 보기의 미리보기를 새로 그린다 */
export const PREVIEW_SETTLE_MS = 250;

export function previewPlan(shownMode: ViewMode, revision: boolean): PreviewPlan {
  if (revision || shownMode === "preview") return "now";
  return shownMode === "split" ? "settle" : "skip";
}

export interface PreviewState {
  plan: PreviewPlan;
  /** 그리는 문서(칸이 다른 문서·과거 판으로 바뀌면 기다리지 않는다) */
  key: string;
  /** settle 에서 마지막으로 그린 본문 */
  text: string;
  /**
   * 미리보기에서 시작한 쓰기(체크박스·위젯 상태)가 성공했다 — 그 쓰기가 낸 본문을 기다리지 않고 그린다.
   * 입력이 아니라 한 번의 쓰기라 미룰 까닭이 없고, 미루면 그사이 줄 수가 달라 다음 누름이 맞추느라 무시된다.
   * 쓰기 성공은 늘 본문을 바꾼다(같은 본문은 쓰지 않는다 — rewriteWidgetBlock) — 그러니 다음 본문 변화가 그 쓰기다.
   */
  flush?: boolean;
}

/**
 * 이번 렌더에 그릴 본문(null = 그리지 않는다)과 다음 상태.
 * 계획이나 문서가 바뀐 직후(편집 → 나란히·미리보기, 칸에 다른 노트)는 기다리지 않고 지금 본문을 그린다 —
 * 모드를 바꾸거나 노트를 열면 최신 본문이 바로 보여야 한다.
 */
export function previewStep(
  prev: PreviewState,
  plan: PreviewPlan,
  key: string,
  source: string,
): { text: string | null; state: PreviewState; settleLater: boolean } {
  if (plan === "skip") return { text: null, state: prev.plan === "skip" ? prev : { plan, key, text: "" }, settleLater: false };
  if (plan === "now") return { text: source, state: prev.plan === "now" ? prev : { plan, key, text: "" }, settleLater: false };
  if (prev.plan !== "settle" || prev.key !== key) return { text: source, state: { plan, key, text: source }, settleLater: false };
  if (prev.flush && prev.text !== source) return { text: source, state: { plan, key, text: source }, settleLater: false };
  return { text: prev.text, state: prev, settleLater: prev.text !== source };
}

/** 미리보기에서 시작한 쓰기가 성공한 뒤의 상태 — 나란히 보기에서만 뜻이 있다(다른 계획은 이미 바로 그린다) */
export function previewWrote(prev: PreviewState): PreviewState {
  return prev.plan === "settle" && !prev.flush ? { ...prev, flush: true } : prev;
}

/**
 * 낡은 미리보기의 줄 번호가 지금 본문에서도 그 줄을 가리킨다고 볼까 — 줄 수가 같으면 그렇다고 본다.
 * 체크 토글·한 줄 안 입력은 줄 수를 바꾸지 않으므로 맞추지 않고 누름을 살린다(맞추면 innerHTML 을 갈아 그 누름이 사라진다).
 * 위젯 상태 쓰기는 블록 JSON 을 여러 줄로 펴서 줄 수가 바뀔 수 있다 — 그래서 미리보기에서 시작한 쓰기는 성공하면 바로 맞춘다(previewWrote).
 * 그래도 그 누름 자체가 고치던 위젯을 적용하게 하면(포커스가 빠지며 mousedown 과 click 사이에 쓴다) 그 누름은 무시된다.
 * 「첫 다른 줄 뒤의 줄 수」까지 보지 않는 이유: 줄 수가 같은 채 줄이 밀리려면 250ms 안에 줄을 지우고 다른 곳에 더해야 하는데,
 * 그 드문 경우는 쓰는 쪽(sameTaskLine·sameWidgetBlock)이 그린 때의 글과 대조해 막는다.
 */
export function sameLineLayout(drawn: string, current: string): boolean {
  return lineCount(drawn) === lineCount(current);
}

function lineCount(s: string): number {
  let n = 1;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

/** 그린 때의 할 일 줄과 지금 줄이 체크 상태만 빼고 같은가(낡은 미리보기의 체크박스가 엉뚱한 줄을 고치지 않게) */
export function sameTaskLine(drawn: string, current: string): boolean {
  const norm = (s: string) => s.replace(/\[[ xX]\]/, "[ ]");
  return norm(drawn) === norm(current);
}

/**
 * 그린 때의 위젯 블록과 지금 블록이 같은 위젯인가 — 위젯 id 와 데이터 파일(state.file)이 같은가.
 * 본문 전체는 견주지 않는다: 위젯이 자기 상태를 쓰면 본문이 바뀌고, 미리보기가 다시 그려질 때까지 그린 본문은 낡은 채다.
 */
export function sameWidgetBlock(drawn: string, current: string): boolean {
  const a = parseWidgetBlock(drawn);
  const b = parseWidgetBlock(current);
  return a.ok && b.ok && a.block.widget.id === b.block.widget.id && fileOf(a.block.state) === fileOf(b.block.state);
}

function fileOf(state: unknown): unknown {
  return state && typeof state === "object" ? (state as { file?: unknown }).file : undefined;
}

/**
 * 미리보기 접기·체크박스가 줄 번호를 풀 본문: 그린 본문(낡았을 수 있다). 미리보기를 안 그리는 칸이면 초안.
 * 낡은 DOM 에 지금 초안의 줄 번호로 접기를 적용하면 엉뚱한 블록이 접힌다.
 */
export function previewFoldSource(drawn: string | null, draft: string): string {
  return drawn ?? draft;
}

/** 미리보기 체크박스: 그 줄(1부터)의 체크를 바꾸는 변경. drawn(그린 때의 줄 글)과 지금 줄이 다르면 null — 쓰지 않는다 */
export function previewTaskToggle(state: EditorState, lineNo: number, done: boolean, drawn?: string): TransactionSpec | null {
  if (lineNo < 1 || lineNo > state.doc.lines) return null;
  const line = state.doc.line(lineNo);
  if (drawn !== undefined && !sameTaskLine(drawn, line.text)) return null;
  const m = /\[([ xX])\]/.exec(line.text);
  if (!m) return null;
  const at = line.from + m.index + 1;
  return { changes: { from: at, to: at + 1, insert: done ? "x" : " " } };
}

/** 미리보기 위젯: 그 줄(여는 펜스)의 위젯 블록을 다시 쓰는 변경. 블록이 없거나 drawn(그린 때의 본문)과 다른 위젯이면 null */
export function previewWidgetWrite(state: EditorState, lineNo: number, widgetState: unknown, version: number, drawn?: string): TransactionSpec | null {
  const b = widgetBlockAtLine(state, lineNo);
  if (!b || (drawn !== undefined && !sameWidgetBlock(drawn, b.body))) return null;
  const next = nextWidgetBody(b.body, widgetState, version);
  return next === null ? null : rewriteWidgetBlock(state, b, next);
}

/**
 * previewStep 을 React 상태로 돌린다. 계획이 바뀐 렌더에서 상태를 바로 맞춘다(렌더 중 setState — 이전 값과 다를 때만).
 *
 * ⚠ settle 의 미리보기는 잠깐 낡는다. 미리보기의 할 일 체크박스·위젯은 그린 때의 줄 번호로 편집기를 고치므로(toggleTask·writeWidget),
 * 그 사이 위에서 줄이 늘거나 줄면 다른 줄을 고친다. 그래서 미리보기를 누르거나 포커스가 들어갈 때 줄 수가 달라졌으면(sameLineLayout)
 * 그 자리에서 settleNow 로 맞춘다 — 그 누름은 바뀐 DOM 에 떨어져 무시되고(다시 누르면 된다) 엉뚱한 줄은 고치지 않는다.
 */
export function usePreviewSource(plan: PreviewPlan, key: string, source: string): { text: string | null; settleNow: () => void; wrote: () => void } {
  const [state, setState] = useState<PreviewState>(() => ({ plan, key, text: plan === "settle" ? source : "" }));
  const step = previewStep(state, plan, key, source);
  if (step.state !== state) setState(step.state);
  const { settleLater } = step;
  const latest = useRef({ settleLater, key, source, drawn: state.text });
  latest.current = { settleLater, key, source, drawn: step.state.text };
  useEffect(() => {
    if (!settleLater) return;
    const id = setTimeout(() => setState({ plan: "settle", key, text: source }), PREVIEW_SETTLE_MS);
    return () => clearTimeout(id);
  }, [settleLater, key, source]);
  const settleNow = useCallback(() => {
    const l = latest.current;
    if (l.settleLater && !sameLineLayout(l.drawn, l.source)) setState({ plan: "settle", key: l.key, text: l.source });
  }, []);
  // 쓰기를 부른 쪽이 성공한 직후에 부른다 — 쓰기가 낸 초안과 같은 렌더에 묶여 그 본문을 바로 그린다(previewStep)
  const wrote = useCallback(() => setState(previewWrote), []);
  return { text: step.text, settleNow, wrote };
}
