import { describe, expect, it } from "vitest";
import {
  frameEventAction,
  frameFocusInside,
  frameGuard,
  frameHeight,
  frameLoadFailedKey,
  FRAME_MIN_HEIGHT,
  fullscreenDocEscape,
  fullscreenFocusButton,
} from "./layout";

describe("frameLoadFailedKey — 코드를 읽지 못한 자리", () => {
  it("잠금이 바뀌어 market_stale 이면 kw.pending(곧 새 항목으로 다시 그린다), 그 밖은 기본(kw.loadFailed)", () => {
    expect(frameLoadFailedKey({ code: "market_stale", params: { id: "@me/c" } })).toBe("kw.pending");
    expect(frameLoadFailedKey({ code: "market_hash_mismatch" })).toBeUndefined();
    expect(frameLoadFailedKey(new Error("x"))).toBeUndefined();
    expect(frameLoadFailedKey(null)).toBeUndefined();
  });
});

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

  it("fullscreenFocusButton: 포커스가 감싸개 밖(WebKit 의 마우스 누름 — body·위젯 뿌리)이면 단추로 옮기고, 안(단추·iframe)이면 그대로", () => {
    expect(fullscreenFocusButton(false)).toBe(true);
    expect(fullscreenFocusButton(true)).toBe(false);
  });

  it("fullscreenDocEscape: 감싸개를 품은 곳에 떨어진 Esc 만 닫기로 받는다", () => {
    const esc = { key: "Escape", isComposing: false, defaultPrevented: false, targetHoldsFrame: true, modalOpen: false };
    expect(fullscreenDocEscape(esc)).toBe(true);
    // 팔레트 입력칸·메뉴 등 감싸개와 무관한 요소의 Esc
    expect(fullscreenDocEscape({ ...esc, targetHoldsFrame: false })).toBe(false);
    // 모달이 열려 있으면 모달 차례(모달은 window 에서 받아 document 보다 늦다)
    expect(fullscreenDocEscape({ ...esc, modalOpen: true })).toBe(false);
    // 편집기 등이 이미 처리한 Esc, 한글 조합 중, 다른 키
    expect(fullscreenDocEscape({ ...esc, defaultPrevented: true })).toBe(false);
    expect(fullscreenDocEscape({ ...esc, isComposing: true })).toBe(false);
    expect(fullscreenDocEscape({ ...esc, key: "Enter" })).toBe(false);
  });
});

import { routeFrameMessage } from "./layout";

describe("routeFrameMessage — mountFrame 의 창 message 갈래", () => {
  const ID = "w1";
  const msg = (o: Record<string, unknown>) => ({ kw: "kw1", id: ID, ...o });
  const write = msg({ type: "fileWrite", req: 0, bytes: new Uint8Array([1]), baseHash: "a".repeat(64) });
  const ev = (data: unknown, o: { sourceIsFrame?: boolean; origin?: string } = {}) => ({
    sourceIsFrame: o.sourceIsFrame ?? true,
    origin: o.origin ?? "null",
    data,
  });
  const live = () => ({ draining: false, dead: false, guard: frameGuard() });

  it("다른 창은 ignore, 출처가 바뀐 같은 창은 kill(ready 전의 첫 메시지부터)", () => {
    expect(routeFrameMessage(ev(write, { sourceIsFrame: false }), ID, live()).kind).toBe("ignore");
    expect(routeFrameMessage(ev(write, { origin: "https://x" }), ID, live()).kind).toBe("kill");
  });

  it("모양이 틀리거나 다른 인스턴스 것은 ignore", () => {
    expect(routeFrameMessage(ev({ kw: "kw1", id: "w2", type: "blur" }), ID, live()).kind).toBe("ignore");
    expect(routeFrameMessage(ev("x"), ID, live()).kind).toBe("ignore");
  });

  it("살아 있으면 receive, 두 번째 ready 는 kill", () => {
    const s = live();
    expect(routeFrameMessage(ev({ kw: "kw1", type: "ready" }), ID, s).kind).toBe("receive");
    expect(routeFrameMessage(ev(msg({ type: "blur" })), ID, s)).toEqual({ kind: "receive", msg: { type: "blur" } });
    expect(routeFrameMessage(ev({ kw: "kw1", type: "ready" }), ID, s).kind).toBe("kill");
  });

  it("drain 창: 지운 iframe 이 이미 보낸 fileWrite 만 넘기고(답 없음) 나머지는 버린다", () => {
    const s = { ...live(), draining: true, dead: true };
    const r = routeFrameMessage(ev(write), ID, s);
    expect(r.kind).toBe("drainWrite");
    expect(routeFrameMessage(ev(msg({ type: "fileRead", req: 1 })), ID, s).kind).toBe("ignore");
    expect(routeFrameMessage(ev(msg({ type: "setState", patch: { a: 1 } })), ID, s).kind).toBe("ignore");
    // drain 중에도 출처가 바뀐 문서는 kill 쪽으로(mountFrame 이 dead 라 아무것도 안 한다)
    expect(routeFrameMessage(ev(write, { origin: "https://x" }), ID, s).kind).toBe("kill");
  });

  it("죽은 뒤(drain 아님)에는 아무것도 받지 않는다", () => {
    const s = { ...live(), dead: true };
    expect(routeFrameMessage(ev(write), ID, s).kind).toBe("ignore");
    expect(routeFrameMessage(ev(msg({ type: "blur" })), ID, s).kind).toBe("ignore");
  });
});
