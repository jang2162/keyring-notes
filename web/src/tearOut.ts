/**
 * 데스크톱 앱에서 탭을 창 밖으로 끌어 놓으면 새 창으로 떼어 낸다 — 그 판정.
 *
 * 놓을 자리가 받지 않았고(dropEffect "none") 창 밖에서 놓았을 때만 떼어 낸다. 창 안의 놓을 자리가 아닌 곳(사이드바 위 등)을
 * 새 창으로 잘못 보면 안 되므로 두 신호가 모두 창 밖이어야 한다:
 * - OS 가 아는 커서 자리(Tauri `cursorPosition`)와 창 테두리 — 웹뷰가 주는 좌표에 기대지 않는 주 판정
 * - dragend 의 screenX/screenY 와 window.screenX… — 놓은 순간의 자리. macOS 는 놓기에 실패하면 끌던 그림이 제자리로
 *   미끄러져 돌아간 뒤에야 dragend 가 오므로, 그사이 커서를 창 안으로 되돌렸으면 이쪽이 막는다. (0,0) 은 좌표를 안 주는
 *   웹뷰의 값으로 보고 쓰지 않는다
 */

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}

export interface TearOutProbe {
  /** dragend 의 dataTransfer.dropEffect */
  dropEffect: string;
  /** dragend 의 screenX/screenY 와, 같은 좌표계의 창 테두리(window.screenX/screenY/outerWidth/outerHeight) */
  event: Point;
  eventWindow: Rect;
  /** OS 의 커서 자리와 창 테두리(같은 단위로 맞춘 것). 못 물었으면 null */
  cursor: Point | null;
  window: Rect | null;
}

/** 테두리 위는 창 안으로 친다 */
const outside = (p: Point, r: Rect) => p.x < r.x || p.y < r.y || p.x >= r.x + r.w || p.y >= r.y + r.h;

/** 탭을 놓을 자리 없이 창 밖에 놓았는가 */
export function droppedOutside({ dropEffect, event, eventWindow, cursor, window }: TearOutProbe): boolean {
  if (dropEffect !== "none" || !cursor || !window) return false;
  if (!outside(cursor, window)) return false;
  return (event.x === 0 && event.y === 0) || outside(event, eventWindow);
}

/**
 * 탭의 dragend 가 창 밖에 놓은 것이면 그 자리(화면 논리 좌표 — 새 창을 둘 곳), 아니면 null. 데스크톱 앱에서만 부른다.
 * 이벤트 값은 기다리기 전에 읽는다(dragend 가 끝나면 dataTransfer 를 읽을 수 없다).
 * tao 는 macOS 에서 커서 자리를 주 모니터의 배율로, 창 자리는 그 창이 있는 모니터의 배율로 물리 픽셀로 바꿔 주므로
 * 각자의 배율로 나눠 논리 좌표로 맞춘다(다른 OS 는 둘 다 물리 픽셀이라 같은 배율로 나눈다)
 */
export async function tearOutAt(e: DragEvent): Promise<Point | null> {
  const dropEffect = e.dataTransfer?.dropEffect ?? "none";
  const event = { x: e.screenX, y: e.screenY };
  const eventWindow = { x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight };
  if (dropEffect !== "none") return null;
  try {
    const { cursorPosition, getCurrentWindow, primaryMonitor } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    const [cur, pos, size, scale, primary] = await Promise.all([cursorPosition(), w.outerPosition(), w.outerSize(), w.scaleFactor(), primaryMonitor()]);
    const cursorScale = /Mac/.test(navigator.userAgent) ? (primary?.scaleFactor ?? scale) : scale;
    const cursor = { x: cur.x / cursorScale, y: cur.y / cursorScale };
    const rect = { x: pos.x / scale, y: pos.y / scale, w: size.width / scale, h: size.height / scale };
    return droppedOutside({ dropEffect, event, eventWindow, cursor, window: rect }) ? cursor : null;
  } catch {
    return null;
  }
}
