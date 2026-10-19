import { afterEach, describe, expect, it, vi } from "vitest";
import { droppedOutside, type TearOutProbe, tearOutAt } from "./tearOut";

/** 화면 (100,100) 에 1200×800 인 창. 커서와 dragend 는 같은 자리 */
const win = { x: 100, y: 100, w: 1200, h: 800 };
const probe = (at: { x: number; y: number }, over: Partial<TearOutProbe> = {}): TearOutProbe => ({
  dropEffect: "none",
  event: at,
  eventWindow: win,
  cursor: at,
  window: win,
  ...over,
});

describe("droppedOutside", () => {
  it("창 오른쪽 바깥에 놓을 자리 없이 놓으면 떼어 낸다", () => {
    expect(droppedOutside(probe({ x: 1500, y: 400 }))).toBe(true);
  });

  it("창 위·왼쪽·아래 바깥도 떼어 낸다", () => {
    expect(droppedOutside(probe({ x: 600, y: 40 }))).toBe(true);
    expect(droppedOutside(probe({ x: 20, y: 400 }))).toBe(true);
    expect(droppedOutside(probe({ x: 600, y: 950 }))).toBe(true);
  });

  it("창 안(사이드바 위처럼 놓을 자리가 아닌 곳)에 놓으면 떼어 내지 않는다", () => {
    expect(droppedOutside(probe({ x: 180, y: 400 }))).toBe(false);
  });

  it("창 테두리 위는 창 안으로 친다", () => {
    expect(droppedOutside(probe({ x: 100, y: 100 }))).toBe(false);
    expect(droppedOutside(probe({ x: 1299, y: 899 }))).toBe(false);
    expect(droppedOutside(probe({ x: 1300, y: 400 }))).toBe(true);
  });

  it("놓을 자리가 받았으면(dropEffect 가 none 이 아니면) 창 밖이어도 떼어 내지 않는다", () => {
    expect(droppedOutside(probe({ x: 1500, y: 400 }, { dropEffect: "move" }))).toBe(false);
    expect(droppedOutside(probe({ x: 1500, y: 400 }, { dropEffect: "copy" }))).toBe(false);
  });

  it("커서 자리를 못 물었으면 떼어 내지 않는다", () => {
    expect(droppedOutside(probe({ x: 1500, y: 400 }, { cursor: null }))).toBe(false);
    expect(droppedOutside(probe({ x: 1500, y: 400 }, { window: null }))).toBe(false);
  });

  it("커서가 창 안이면 dragend 좌표가 창 밖이어도 떼어 내지 않는다", () => {
    expect(droppedOutside(probe({ x: 1500, y: 400 }, { cursor: { x: 180, y: 400 } }))).toBe(false);
  });

  it("dragend 좌표가 창 안이면 커서가 창 밖이어도 떼어 내지 않는다(놓은 뒤 커서를 옮긴 경우)", () => {
    expect(droppedOutside(probe({ x: 180, y: 400 }, { cursor: { x: 1500, y: 400 } }))).toBe(false);
  });

  it("dragend 좌표가 (0,0) 이면 모르는 값으로 보고 커서만으로 가린다", () => {
    expect(droppedOutside(probe({ x: 1500, y: 400 }, { event: { x: 0, y: 0 } }))).toBe(true);
    expect(droppedOutside(probe({ x: 180, y: 400 }, { event: { x: 0, y: 0 } }))).toBe(false);
  });

  it("커서가 (0,0) 이면 진짜 화면 자리로 본다(창이 원점에 있으면 창 안)", () => {
    const origin = { x: 0, y: 0, w: 1200, h: 800 };
    const at = { x: 0, y: 0 };
    expect(droppedOutside(probe(at, { eventWindow: origin, window: origin, event: { x: 1500, y: 400 } }))).toBe(false);
    expect(droppedOutside(probe(at, { event: { x: 1500, y: 400 } }))).toBe(true);
  });
});

/** Tauri 창 API 를 가짜로: 커서는 물리 픽셀(macOS 는 주 모니터 배율), 창은 그 창의 배율 */
const tauri = vi.hoisted(() => ({
  cursor: { x: 0, y: 0 },
  pos: { x: 0, y: 0 },
  size: { width: 0, height: 0 },
  scale: 1,
  primary: 1,
}));
vi.mock("@tauri-apps/api/window", () => ({
  cursorPosition: async () => tauri.cursor,
  primaryMonitor: async () => ({ scaleFactor: tauri.primary }),
  getCurrentWindow: () => ({ outerPosition: async () => tauri.pos, outerSize: async () => tauri.size, scaleFactor: async () => tauri.scale }),
}));

describe("tearOutAt", () => {
  const dragend = (screen: { x: number; y: number }, dropEffect = "none") =>
    ({ dataTransfer: { dropEffect }, screenX: screen.x, screenY: screen.y }) as unknown as DragEvent;
  const setup = (ua: string, scale: number, primary: number) => {
    vi.stubGlobal("navigator", { userAgent: ua });
    // WebKit 의 window.screenX… 는 논리 좌표(포인트). 창은 (100,100) 에 1200×800
    vi.stubGlobal("window", { screenX: 100, screenY: 100, outerWidth: 1200, outerHeight: 800 });
    Object.assign(tauri, { scale, primary, pos: { x: 100 * scale, y: 100 * scale }, size: { width: 1200 * scale, height: 800 * scale } });
  };
  afterEach(() => vi.unstubAllGlobals());

  it("macOS 에서 주 모니터(2배)와 창의 모니터(1배) 배율이 달라도 창 안의 커서를 창 안으로 본다", async () => {
    setup("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 1, 2);
    tauri.cursor = { x: 1000 * 2, y: 400 * 2 };
    expect(await tearOutAt(dragend({ x: 1500, y: 400 }))).toBeNull();
  });

  it("macOS 에서 창 밖이면 놓은 자리를 논리 좌표로 돌려준다", async () => {
    setup("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 2, 2);
    tauri.cursor = { x: 1500 * 2, y: 400 * 2 };
    expect(await tearOutAt(dragend({ x: 1500, y: 400 }))).toEqual({ x: 1500, y: 400 });
  });

  it("macOS 가 아니면 커서와 창을 같은 배율로 나눈다", async () => {
    setup("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 1.5, 1);
    tauri.cursor = { x: 1500 * 1.5, y: 400 * 1.5 };
    expect(await tearOutAt(dragend({ x: 1500, y: 400 }))).toEqual({ x: 1500, y: 400 });
    tauri.cursor = { x: 1000 * 1.5, y: 400 * 1.5 };
    expect(await tearOutAt(dragend({ x: 1500, y: 400 }))).toBeNull();
  });

  it("놓을 자리가 받았으면 Tauri 에 묻지도 않고 null", async () => {
    setup("Mozilla/5.0 (Macintosh)", 1, 1);
    tauri.cursor = { x: 1500, y: 400 };
    expect(await tearOutAt(dragend({ x: 1500, y: 400 }, "move"))).toBeNull();
  });
});
