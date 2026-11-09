import { describe, expect, it } from "vitest";
import { frameEventAction, frameFocusInside, frameGuard, frameHeight, FRAME_MIN_HEIGHT } from "./layout";

describe("iframe 호스트 판정", () => {
  it("frameEventAction: 잡아 둔 창이 아니면 ignore, 출처가 null 이 아니면 kill", () => {
    expect(frameEventAction({ sourceIsFrame: false, origin: "null" })).toBe("ignore");
    expect(frameEventAction({ sourceIsFrame: false, origin: "https://x" })).toBe("ignore");
    expect(frameEventAction({ sourceIsFrame: true, origin: "https://x" })).toBe("kill");
    expect(frameEventAction({ sourceIsFrame: true, origin: "null" })).toBe("accept");
  });

  it("frameGuard: 첫 load·ready 만 ok, 그 뒤 kill", () => {
    const g = frameGuard();
    expect(g.load()).toBe("ok");
    expect(g.ready()).toBe("ok");
    expect(g.killed()).toBe(false);
    expect(g.load()).toBe("kill");
    expect(g.ready()).toBe("kill");
    expect(g.killed()).toBe(true);
    const h = frameGuard();
    expect(h.ready()).toBe("ok");
    expect(h.ready()).toBe("kill");
    expect(h.load()).toBe("kill");
  });

  it("frameHeight", () => {
    expect(FRAME_MIN_HEIGHT).toBe(48);
    expect(frameHeight(300, 1000, false)).toBe(300);
    expect(frameHeight(900, 1000, false)).toBe(800);
    expect(frameHeight(10, 1000, false)).toBe(48);
    expect(frameHeight(300.2, 1000, false)).toBe(301);
    expect(frameHeight(300, 1000, true)).toBe(1000);
    expect(frameHeight(300, 999, false)).toBe(300);
    expect(frameHeight(900, 999, false)).toBe(799);
  });

  it("frameFocusInside", () => {
    expect(frameFocusInside({ activeInRoot: false, relatedInRoot: false })).toBe(false);
    expect(frameFocusInside({ activeInRoot: true, relatedInRoot: false })).toBe(true);
    expect(frameFocusInside({ activeInRoot: false, relatedInRoot: true })).toBe(true);
    expect(frameFocusInside({ activeInRoot: true, relatedInRoot: true })).toBe(true);
  });
});
