/** 터치 환경(손가락이 주 포인터) 판정. 트리 누르기·편집기 자동 포커스·뒤로가기 닫기가 같이 쓴다 — 마우스 환경은 창 폭과 상관없이 그대로 */
export function isTouch(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}
