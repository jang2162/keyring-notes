import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalVault } from "@keyring-notes/core";
import { SyncController } from "./syncController";

/** 연결된 기기(자동 동기화 켬)의 localStorage 와, 저장 알림 구독과 동기화 상태만 갖춘 볼트 */
function setup() {
  const mem = new Map([["keyring:sync", JSON.stringify({ server: "https://notes.example", token: "t", device: "Mac", auto: true })]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
    removeItem: (k: string) => mem.delete(k),
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const listeners: ((paths: string[], source: string) => void)[] = [];
  const vault = {
    onChange: (fn: (paths: string[], source: string) => void) => (listeners.push(fn), () => undefined),
    snapshot: vi.fn(async () => new Map()),
    store: { readMeta: async () => null },
  } as unknown as LocalVault;
  const fetchFn = vi.fn(async () => new Response("{}", { status: 500 }));
  return { vault, listeners, fetchFn, win: globalThis.window as unknown as { addEventListener: ReturnType<typeof vi.fn> } };
}

describe("SyncController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("보통 창은 저장 알림을 받고 자동 동기화를 건다", () => {
    const { vault, listeners, fetchFn, win } = setup();
    new SyncController(vault, fetchFn as unknown as typeof fetch).startAuto();
    expect(listeners).toHaveLength(1);
    expect(win.addEventListener).toHaveBeenCalled();
  });

  it("노트 하나만 띄운 새 창(passive)은 동기화를 돌리지 않는다 — 원래 창 하나가 맡는다", async () => {
    const { vault, listeners, fetchFn, win } = setup();
    const c = new SyncController(vault, fetchFn as unknown as typeof fetch, { passive: true });
    c.startAuto();
    expect(listeners).toHaveLength(0);
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(await c.run()).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(vault.snapshot).not.toHaveBeenCalled();
    expect(c.get().running).toBe(false);
  });
});
