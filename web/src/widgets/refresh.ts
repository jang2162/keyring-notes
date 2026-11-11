import type { Resume } from "./mount";
import type { WidgetView } from "./registry";

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 레지스트리 바뀜(받은 위젯이 들어옴·판 교체·빠짐·판정기 답 바뀜)에 그려진 블록을 어떻게 할까.
 * 같은 위젯(같은 항목 객체·같은 display)이나 같은 오류면 "none", 그 밖은 수정 중이면 끝날 때까지 "defer", 아니면 "now"
 */
export function refreshAction(prev: WidgetView, next: WidgetView, s: { editing: boolean }): "none" | "now" | "defer" {
  if (prev.kind === "widget" && next.kind === "widget" && prev.entry === next.entry && prev.display === next.display) return "none";
  if (
    prev.kind === "error" &&
    next.kind === "error" &&
    prev.key === next.key &&
    sameJson(prev.vars, next.vars) &&
    sameJson(prev.action, next.action) &&
    sameJson(prev.error, next.error)
  )
    return "none";
  return s.editing ? "defer" : "now";
}

/** 다시 그리기 전에 데이터 파일을 비울까 — 자동 저장 끔이면 쓰지 않는다(release 가 남긴 바이트를 새 위젯이 읽는다) */
export function flushBeforeRefresh(o: { hasFile: boolean; autosave: boolean }): boolean {
  return o.hasFile && o.autosave;
}

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
