import { describe, expect, it } from "vitest";
import { KEYBOARD_GAP, LONG_PRESS_MS, keyboardState, keyboardUp, moreBadge, pressOutcome, type KeyboardState, type MoreStatus } from "./bottomBarState";

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
    let k = keyboardState(null, { width: 412, height: 800, editing: true });
    k = keyboardState(k, { width: 412, height: 500, editing: true });
    expect(k.tallest).toBe(800);
    expect(k.up).toBe(true);
  });
});

/** 측정을 차례로 넣고 각 단계의 up 을 모은다 */
const run = (steps: { width: number; height: number; editing: boolean }[]) => {
  let k: KeyboardState | null = null;
  return steps.map((s) => (k = keyboardState(k, s)));
};

describe("keyboardState", () => {
  it("같은 폭에서는 지금까지 본 가장 큰 높이를 지킨다", () => {
    const [, b, c] = run([
      { width: 390, height: 700, editing: false },
      { width: 390, height: 844, editing: false },
      { width: 390, height: 400, editing: false },
    ]);
    expect(b.tallest).toBe(844);
    expect(c.tallest).toBe(844);
    expect(c.up).toBe(false); // 입력 중이 아니면 키보드가 아니다
  });

  it("키보드가 내려간 채 회전하면 다시 잰다 — 세로일 때의 큰 높이로 가로 화면을 늘 키보드로 보지 않게", () => {
    const [, b, c] = run([
      { width: 390, height: 844, editing: false },
      { width: 844, height: 390, editing: false },
      { width: 844, height: 390, editing: true },
    ]);
    expect(b.tallest).toBe(390);
    expect(c.up).toBe(false);
  });

  it("키보드가 올라온 채 회전해도 up 을 지킨다 — 리뷰 B 재현(412×915 → 412×560 → 780×200 → 412×560, 입력 중)", () => {
    const ups = run([
      { width: 412, height: 915, editing: true },
      { width: 412, height: 560, editing: true },
      { width: 780, height: 200, editing: true },
      { width: 412, height: 560, editing: true },
    ]).map((k) => k.up);
    expect(ups).toEqual([false, true, true, true]);
  });

  it("회전 뒤 가장 큰 높이는 입력이 끝난 첫 측정에서 다시 잰다", () => {
    const [, , c, d, e, f] = run([
      { width: 412, height: 915, editing: true },
      { width: 412, height: 560, editing: true },
      { width: 780, height: 200, editing: true }, // 키보드에 줄어든 높이를 가장 큰 높이로 삼지 않는다
      { width: 780, height: 200, editing: false }, // 입력이 끝남 — 여기서 다시 잰다
      { width: 780, height: 412, editing: false }, // 키보드가 내려감
      { width: 780, height: 200, editing: true }, // 다시 입력 + 키보드
    ]);
    expect(c.tallest).not.toBe(200);
    expect(d).toMatchObject({ up: false, tallest: 200 });
    expect(e.tallest).toBe(412);
    expect(f.up).toBe(true);
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
