import type { Resume } from "./mount";

/**
 * 그려진 위젯 블록의 다시 그리기 판정(DOM 없음). 정본은 마켓 3단계 계획
 * docs/superpowers/plans/2026-11-10-marketplace-phase3.md 「다시 붙는 위젯의 이어받기」·「판이 바뀌면 열려 있는 iframe」.
 */

/**
 * 다시 붙는 위젯이 편집기 필드의 수정을 이어받는가. 지금 판정이 위젯이고 그 판이 초안의 판 이상이면 이어받는다(항목 키는 보지 않는다 —
 * 판 교체로 인스턴스가 바뀐 경우 포함). 그 밖은 "hold": 필드의 수정을 쓰지도 끝내지도 않고 오류 블록만 그린다(사용자 결정 2026-11-11 —
 * 항목이 다시 쓸 수 있게 되면 그때 이어받고, 앱을 닫으면 사라진다)
 */
export function resumePlan(resume: Resume | null, view: { kind: "widget"; version: number } | { kind: "error" }): "resume" | "hold" | "none" {
  if (!resume) return "none";
  return view.kind === "widget" && view.version >= resume.stateFrom ? "resume" : "hold";
}
