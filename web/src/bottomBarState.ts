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
  /** 자동 저장이 꺼진 채 저장 안 한 변경 */
  unsaved: boolean;
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
  return s.offline || s.saveIssue || s.unsaved || s.syncError || s.update ? "dot" : null;
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

/** 화면 키보드 판단의 상태: 지금까지 본 가장 큰 보이는 높이와 그때의 가로 폭 */
export interface KeyboardState {
  tallest: number;
  width: number;
  up: boolean;
  /** 키보드가 올라온 채 회전해 tallest 를 믿을 수 없다 — 입력이 끝난 첫 측정에서 다시 잰다 */
  remeasure: boolean;
}

/**
 * 측정 하나로 키보드 상태를 잇는다. 같은 폭에서는 가장 큰 높이를 지키고 keyboardUp 으로 가른다.
 * 가로 폭이 바뀌면(회전) 다시 재되, 입력 중이고 직전에 키보드가 올라와 있었으면 up 을 지킨다 —
 * 그때 잰 높이는 키보드에 줄어든 높이라 가장 큰 높이로 삼으면 키보드를 놓친다(바가 키보드 위에 뜬다).
 * 그런 회전 뒤에는 입력이 끝난 첫 측정에서 가장 큰 높이를 다시 잰다.
 */
export function keyboardState(prev: KeyboardState | null, now: { width: number; height: number; editing: boolean }): KeyboardState {
  const fresh = { tallest: now.height, width: now.width, up: false, remeasure: false };
  if (!prev) return fresh;
  if (prev.width !== now.width) return now.editing && prev.up ? { ...prev, width: now.width, up: true, remeasure: true } : fresh;
  if (prev.remeasure) return now.editing ? prev : fresh;
  const tallest = Math.max(prev.tallest, now.height);
  return { tallest, width: now.width, up: keyboardUp(now.height, tallest, now.editing), remeasure: false };
}

/** ＋ 를 이만큼 누르고 있으면 길게 누르기(오늘 노트) */
export const LONG_PRESS_MS = 500;

/** 누른 시간으로 가른다. 길게 누르기가 없으면(데일리를 끈 워크스페이스) 늘 짧은 누르기 */
export function pressOutcome(heldMs: number, canHold: boolean): "tap" | "hold" {
  return canHold && heldMs >= LONG_PRESS_MS ? "hold" : "tap";
}
