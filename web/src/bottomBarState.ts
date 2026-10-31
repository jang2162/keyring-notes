/**
 * 좁은 화면 하단 바의 판단: 「더 보기」 칸의 배지, 화면 키보드가 올라왔는지, ＋ 를 길게 눌렀는지.
 * 화면(BottomBar.tsx·Workspace.tsx)과 떼어 두어 DOM 없이 시험한다.
 */

/** 「더 보기」 칸에 모아 보일 상태(좁은 화면에는 상태 표시줄·레일이 없다) */
export interface MoreStatus {
  offline: boolean;
  /** 서버로 보낼 변경 수 */
  outbox: number;
  /** 저장 실패·충돌 */
  saveIssue: boolean;
  /** 로컬 모드 동기화 오류 */
  syncError: boolean;
  /** 검토 대기 수 */
  reviewWaiting: number;
  /** 앱 새 버전 */
  update: boolean;
}

/** 수가 있으면 그 수(보낼 변경 + 검토 대기), 없고 알아야 할 상태만 있으면 점, 평소에는 null */
export function moreBadge(s: MoreStatus): number | "dot" | null {
  const n = s.outbox + s.reviewWaiting;
  if (n > 0) return n;
  return s.offline || s.saveIssue || s.syncError || s.update ? "dot" : null;
}

/** 화면 키보드로 볼 높이 차이(px). 주소창이 접히고 펴지는 정도(대개 100px 아래)는 넘는다 */
export const KEYBOARD_GAP = 150;

/**
 * 입력 중이고 보이는 높이가 지금까지 본 가장 큰 높이보다 KEYBOARD_GAP 넘게 줄었으면 키보드가 올라와 있다.
 * 창 높이(innerHeight)와 견주지 않는다 — 안드로이드는 키보드가 레이아웃 뷰포트까지 줄여 둘이 함께 작아진다.
 */
export function keyboardUp(viewport: number, tallest: number, editing: boolean): boolean {
  return editing && tallest - viewport > KEYBOARD_GAP;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** 지금까지 본 가장 큰 보이는 높이. 가로 폭이 바뀌면(회전) 처음부터 다시 잰다 */
export function nextTallest(prev: ViewportSize | null, now: ViewportSize): ViewportSize {
  if (!prev || prev.width !== now.width) return now;
  return now.height > prev.height ? now : prev;
}

/** ＋ 를 이만큼 누르고 있으면 길게 누르기(오늘 노트) */
export const LONG_PRESS_MS = 500;

/** 누른 시간으로 가른다. 길게 누르기가 없으면(데일리를 끈 워크스페이스) 늘 짧은 누르기 */
export function pressOutcome(heldMs: number, canHold: boolean): "tap" | "hold" {
  return canHold && heldMs >= LONG_PRESS_MS ? "hold" : "tap";
}
