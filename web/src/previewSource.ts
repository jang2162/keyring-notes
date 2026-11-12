import { useCallback, useEffect, useRef, useState } from "react";
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
  return { text: prev.text, state: prev, settleLater: prev.text !== source };
}

/**
 * previewStep 을 React 상태로 돌린다. 계획이 바뀐 렌더에서 상태를 바로 맞춘다(렌더 중 setState — 이전 값과 다를 때만).
 *
 * ⚠ settle 의 미리보기는 잠깐 낡는다. 미리보기의 할 일 체크박스·위젯은 그린 때의 줄 번호로 편집기를 고치므로(toggleTask·writeWidget),
 * 그 사이 위에서 줄이 늘거나 줄면 다른 줄을 고친다. 그래서 미리보기를 누르거나 포커스가 들어가면 그 자리에서 settleNow 로 맞춘다 —
 * 그 누름은 바뀐 DOM 에 떨어져 무시되고(다시 누르면 된다) 엉뚱한 줄은 고치지 않는다.
 */
export function usePreviewSource(plan: PreviewPlan, key: string, source: string): { text: string | null; settleNow: () => void } {
  const [state, setState] = useState<PreviewState>(() => ({ plan, key, text: plan === "settle" ? source : "" }));
  const step = previewStep(state, plan, key, source);
  if (step.state !== state) setState(step.state);
  const { settleLater } = step;
  const latest = useRef({ settleLater, key, source });
  latest.current = { settleLater, key, source };
  useEffect(() => {
    if (!settleLater) return;
    const id = setTimeout(() => setState({ plan: "settle", key, text: source }), PREVIEW_SETTLE_MS);
    return () => clearTimeout(id);
  }, [settleLater, key, source]);
  const settleNow = useCallback(() => {
    const l = latest.current;
    if (l.settleLater) setState({ plan: "settle", key: l.key, text: l.source });
  }, []);
  return { text: step.text, settleNow };
}
