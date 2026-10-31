import { describe, expect, it } from "vitest";
import { KEYBOARD_GAP, LONG_PRESS_MS, keyboardUp, moreBadge, nextTallest, pressOutcome, type MoreStatus } from "./bottomBarState";

const calm: MoreStatus = { offline: false, outbox: 0, saveIssue: false, syncError: false, reviewWaiting: 0, update: false };

describe("moreBadge", () => {
  it("보낼 변경·검토 대기는 수로 더한다", () => expect(moreBadge({ ...calm, outbox: 2, reviewWaiting: 1 })).toBe(3));
  it("수가 있으면 점보다 수가 먼저", () => expect(moreBadge({ ...calm, offline: true, outbox: 2 })).toBe(2));
  it("수가 없고 오프라인·저장 문제·동기화 오류·업데이트면 점", () => {
    for (const k of ["offline", "saveIssue", "syncError", "update"] as const) expect(moreBadge({ ...calm, [k]: true })).toBe("dot");
  });
  it("평소에는 없음", () => expect(moreBadge(calm)).toBeNull());
});

describe("keyboardUp", () => {
  it("입력 중이고 가장 컸던 높이보다 150px 넘게 줄었을 때만", () => {
    expect(KEYBOARD_GAP).toBe(150);
    expect(keyboardUp(500, 800, true)).toBe(true);
    expect(keyboardUp(650, 800, true)).toBe(false); // 정확히 150 은 아니다
    expect(keyboardUp(649, 800, true)).toBe(true);
    expect(keyboardUp(500, 800, false)).toBe(false);
  });
  it("안드로이드처럼 창 높이까지 함께 줄어도 가장 컸던 높이와 견주므로 키보드로 본다(Review Focus 1)", () => {
    // 키보드가 레이아웃 뷰포트까지 줄이면 innerHeight 도 500 이 된다 — 창 높이와 견주면 차이가 0 이라 놓친다
    let tallest = nextTallest(null, { width: 412, height: 800 });
    tallest = nextTallest(tallest, { width: 412, height: 500 });
    expect(tallest.height).toBe(800);
    expect(keyboardUp(500, tallest.height, true)).toBe(true);
  });
});

describe("nextTallest", () => {
  it("같은 폭에서는 지금까지 본 가장 큰 높이를 지킨다", () => {
    const a = nextTallest(null, { width: 390, height: 700 });
    expect(nextTallest(a, { width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
    expect(nextTallest({ width: 390, height: 844 }, { width: 390, height: 400 })).toEqual({ width: 390, height: 844 });
  });
  it("가로 폭이 바뀌면(회전) 다시 잰다 — 세로일 때의 큰 높이로 가로 화면을 늘 키보드로 보지 않게", () => {
    expect(nextTallest({ width: 390, height: 844 }, { width: 844, height: 390 })).toEqual({ width: 844, height: 390 });
    expect(keyboardUp(390, nextTallest({ width: 390, height: 844 }, { width: 844, height: 390 }).height, true)).toBe(false);
  });
});

describe("pressOutcome", () => {
  it("500ms 이상 누르면 hold, 길게 누르기가 없으면 늘 tap", () => {
    expect(LONG_PRESS_MS).toBe(500);
    expect(pressOutcome(499, true)).toBe("tap");
    expect(pressOutcome(500, true)).toBe("hold");
    expect(pressOutcome(900, false)).toBe("tap");
  });
});
