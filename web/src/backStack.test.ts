import { describe, expect, it, vi } from "vitest";
import { createBackStack } from "./backStack";

/**
 * 가짜 주소 기록: 항목 배열 + 인덱스. back() 은 브라우저처럼 비동기다 — 인덱스를 줄이고 popstate 를 쏘는 것이 둘 다
 * 나중(microtask)이라, 그 사이의 pushState·replaceState 는 아직 떠나지 않은 항목에 적힌다
 */
function fakeHistory(start: { state?: unknown; url?: string } = {}) {
  const entries: { state: unknown; url: string }[] = [{ state: start.state ?? null, url: start.url ?? "#/A.md" }];
  let index = 0;
  let listener: (e: { state: unknown }) => void = () => {};
  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state: unknown, _t: string, url?: string | URL | null) {
      entries.splice(index + 1);
      entries.push({ state, url: url == null ? entries[index].url : String(url) });
      index++;
    },
    replaceState(state: unknown, _t: string, url?: string | URL | null) {
      entries[index] = { state, url: url == null ? entries[index].url : String(url) };
    },
    back: vi.fn(() => {
      queueMicrotask(() => {
        if (index === 0) return;
        index--;
        listener({ state: entries[index].state });
      });
    }),
  };
  return {
    history,
    entries,
    get index() {
      return index;
    },
    get top() {
      return entries[index];
    },
    /** 사람이 누른 뒤로가기(우리가 부른 back 과 같은 경로지만 시험에서 직접) */
    userBack() {
      index--;
      queueMicrotask(() => listener({ state: entries[index].state }));
    },
    listen(fn: (e: { state: unknown }) => void) {
      listener = fn;
    },
  };
}

function setup(o: { enabled?: boolean; state?: unknown; url?: string } = {}) {
  const f = fakeHistory(o);
  const stack = createBackStack({ history: f.history, addPopListener: (fn) => f.listen(fn), enabled: () => o.enabled ?? true });
  return { f, stack };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("backStack", () => {
  it("noop when not touch", () => {
    const { f, stack } = setup({ enabled: false });
    const off = stack.push(() => {});
    expect(f.entries.length).toBe(1);
    off();
    expect(f.history.back).not.toHaveBeenCalled();
  });

  it("push adds one marker for many", () => {
    const { f, stack } = setup({ state: { back: "X" } });
    stack.push(() => {});
    stack.push(() => {});
    expect(f.entries.length).toBe(2);
    expect(f.top.state).toEqual({ back: "X", kOverlay: true });
    expect(f.top.url).toBe("#/A.md");
  });

  it("back closes only top", async () => {
    const { f, stack } = setup();
    const lower = vi.fn();
    const upper = vi.fn();
    stack.push(lower);
    stack.push(upper);
    f.userBack();
    await flush();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    expect(f.entries.length).toBe(2);
    expect(f.index).toBe(1);
    expect((f.top.state as { kOverlay?: boolean }).kOverlay).toBe(true);
    // 다시 뒤로: 아래 것이 닫히고 표시는 더 쌓이지 않는다
    f.userBack();
    await flush();
    expect(lower).toHaveBeenCalledTimes(1);
    expect(f.index).toBe(0);
  });

  it("last close by button pops marker", async () => {
    const { f, stack } = setup();
    const close = vi.fn();
    const off = stack.push(close);
    off();
    off();
    expect(f.history.back).toHaveBeenCalledTimes(1);
    await flush();
    expect(close).not.toHaveBeenCalled();
    expect(f.index).toBe(0);
  });

  it("closing by back does not call back again when the component releases", async () => {
    const { f, stack } = setup();
    let off = () => {};
    off = stack.push(() => off());
    f.userBack();
    await flush();
    expect(f.history.back).not.toHaveBeenCalled();
    expect(f.index).toBe(0);
  });

  it("re-pushes marker when close refused", async () => {
    const { f, stack } = setup();
    const close = vi.fn(() => Promise.resolve(false));
    stack.push(close);
    f.userBack();
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(f.index).toBe(1);
    expect((f.top.state as { kOverlay?: boolean }).kOverlay).toBe(true);
    // 다시 뒤로: 같은 것을 다시 닫으려 한다
    f.userBack();
    await flush();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("settles before push", async () => {
    const { f, stack } = setup();
    const off = stack.push(() => {});
    off(); // 비동기 back 진행 중
    await stack.navigate("#/:settings/general");
    await flush();
    expect(f.top.url).toBe("#/:settings/general");
    expect(f.index).toBe(1);
    expect(f.entries[0].url).toBe("#/A.md");
    expect(f.entries.length).toBe(2);
  });

  it("replaces marker when navigating from overlay", async () => {
    const { f, stack } = setup();
    const off = stack.push(() => {});
    await stack.navigate("#/:settings/general");
    expect(f.entries.length).toBe(2);
    expect(f.top.url).toBe("#/:settings/general");
    expect((f.top.state as { kOverlay?: boolean } | null)?.kOverlay).toBeUndefined();
    off();
    await flush();
    expect(f.history.back).not.toHaveBeenCalled();
    expect(f.top.url).toBe("#/:settings/general");
  });

  it("push during our back waits for it", async () => {
    const { f, stack } = setup();
    const off = stack.push(() => {});
    off(); // 비동기 back 진행 중에 다시 연다(StrictMode 의 두 번 마운트 등)
    stack.push(() => {});
    await flush();
    expect(f.entries.length).toBe(2);
    expect(f.index).toBe(1);
    expect((f.top.state as { kOverlay?: boolean }).kOverlay).toBe(true);
  });

  it("navigate retires the overlays it replaced", async () => {
    const { f, stack } = setup();
    stack.push(() => {});
    stack.push(() => {}); // 닫히는 중이지만 아직 해제하지 않은 것(아래 깔린 모달 등)
    await stack.navigate("#/:settings/general");
    const offDialog = stack.push(() => {}); // 설정 안 확인 창
    expect(f.index).toBe(2);
    offDialog();
    await flush();
    expect(f.history.back).toHaveBeenCalledTimes(1);
    expect(f.index).toBe(1);
    expect(f.top.url).toBe("#/:settings/general");
  });

  it("replace keeps marker", () => {
    const { f, stack } = setup();
    stack.push(() => {});
    stack.replace("#/B.md");
    expect(f.top.url).toBe("#/B.md");
    expect((f.top.state as { kOverlay?: boolean }).kOverlay).toBe(true);
  });

  it("replace without marker clears state", () => {
    const { f, stack } = setup({ state: { back: "X" } });
    stack.replace("#/B.md");
    expect(f.top).toEqual({ state: null, url: "#/B.md" });
  });

  it("address changed under the marker survives back", async () => {
    const { f, stack } = setup();
    stack.push(() => {});
    stack.push(() => {});
    stack.replace("#/B.md");
    f.userBack();
    await flush();
    // 아래 항목도 지금 노트 — 뒤로가기 뒤 주소가 옛 노트로 돌아가지 않는다
    expect(f.entries[0].url).toBe("#/B.md");
  });

  it("replace waits for our back", async () => {
    const { f, stack } = setup();
    const off = stack.push(() => {});
    off(); // 비동기 back 진행 중(탭 시트에서 노트를 골라 닫힘)
    stack.replace("#/B.md");
    await flush();
    expect(f.index).toBe(0);
    expect(f.top.url).toBe("#/B.md");
  });

  it("cleans stale marker on init", () => {
    const { f, stack } = setup({ state: { kOverlay: true } });
    stack.initClean();
    expect(f.history.back).toHaveBeenCalledTimes(1);
  });

  it("init leaves a normal entry alone", () => {
    const { f, stack } = setup({ state: { back: "X" } });
    stack.initClean();
    expect(f.history.back).not.toHaveBeenCalled();
  });
});
