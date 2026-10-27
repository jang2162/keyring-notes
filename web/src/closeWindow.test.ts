import { describe, expect, it, vi } from "vitest";
import {
  canCloseWindow,
  closeAskHandler,
  closeWindowCommands,
  closeWindowSafely,
  dropAutosaves,
  guardPage,
  restartAfterClosing,
  savesHeld,
  setCloseGuard,
  unsavedSummary,
  type CloseChoice,
  type CloseWindowSteps,
  type SaveHold,
} from "./closeWindow";
import { normalizeCombo } from "./shortcuts";
import workspaceSrc from "./Workspace.tsx?raw";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/core", async (orig) => ({ ...(await orig<typeof import("@tauri-apps/api/core")>()), invoke }));

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

describe("canCloseWindow", () => {
  it("데스크톱 앱에만 둔다", () => {
    expect(canCloseWindow(true, MAC)).toBe(true);
    expect(canCloseWindow(true, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true);
  });

  it("웹 브라우저와 모바일 앱에는 두지 않는다", () => {
    expect(canCloseWindow(false, MAC)).toBe(false);
    expect(canCloseWindow(true, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(false);
    expect(canCloseWindow(true, "Mozilla/5.0 (Linux; Android 15)")).toBe(false);
  });
});

describe("closeWindowCommands", () => {
  const c = { group: "Tabs", label: "Close window", run: () => {} };

  it("데스크톱이면 Mod+Shift+W 「창 닫기」 하나, 웹용 키는 없다", () => {
    const list = closeWindowCommands(true, c);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "close-window", keys: "Mod+Shift+W", group: "Tabs", label: "Close window" });
    expect(list[0].webKeys).toBeUndefined();
  });

  it("데스크톱이 아니면 명령이 없다(팔레트·단축키 설정에도 안 나온다)", () => {
    expect(closeWindowCommands(false, c)).toEqual([]);
  });

  it("Workspace 의 다른 명령 기본 키와 겹치지 않는다", () => {
    const keys = [...workspaceSrc.matchAll(/\b(?:keys|macKeys|webKeys):\s*["'`]([^"'`]+)["'`]/g)].map((m) => normalizeCombo(m[1]));
    // 세는 것이 실제로 잡히는지: 탭 닫기의 Mod+W 는 있어야 한다
    expect(keys).toContain("Mod+W");
    expect(keys).not.toContain(normalizeCombo(closeWindowCommands(true, c)[0].keys!));
  });
});

describe("closeWindowSafely", () => {
  /** dirty: 처음 저장 안 한 문서, left: save 뒤에 남는 문서 */
  const steps = (dirty: string[], answer: CloseChoice | null, left: string[] = []) => {
    let saved = false;
    return {
      dirty: vi.fn(() => (saved ? left : dirty)),
      ask: vi.fn(async () => answer),
      save: vi.fn(async () => {
        saved = true;
      }),
      unsaved: vi.fn(),
      close: vi.fn(async () => {}),
      hold: { asking: false, closing: false } as SaveHold,
      dropPending: vi.fn(),
    } satisfies CloseWindowSteps;
  };

  it("저장 안 한 변경이 없으면 묻지 않고 닫는다", async () => {
    const s = steps([], null);
    expect(await closeWindowSafely(s)).toBe(true);
    expect(s.ask).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("저장 안 한 변경이 있으면 저장하기 전에 먼저 그 문서들을 들어 묻는다(자동 저장이 켜져 있어도)", async () => {
    const s = steps(["a.md", "b.md"], "save");
    await closeWindowSafely(s);
    expect(s.ask).toHaveBeenCalledWith(["a.md", "b.md"]);
    expect(s.ask.mock.invocationCallOrder[0]).toBeLessThan(s.save.mock.invocationCallOrder[0]);
  });

  it("저장하고 닫기: 다 저장되면 닫는다", async () => {
    const s = steps(["a.md"], "save");
    expect(await closeWindowSafely(s)).toBe(true);
    expect(s.save).toHaveBeenCalledOnce();
    expect(s.unsaved).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("저장하고 닫기: 저장하지 못한 것이 남으면 그 문서들을 알리고 닫지 않는다", async () => {
    const s = steps(["a.md", "b.md"], "save", ["b.md"]);
    expect(await closeWindowSafely(s)).toBe(false);
    expect(s.unsaved).toHaveBeenCalledWith(["b.md"]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it("저장하지 않고 닫기: 저장하지 않고 닫는다", async () => {
    const s = steps(["a.md"], "discard", ["a.md"]);
    expect(await closeWindowSafely(s)).toBe(true);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("취소하면 저장도 닫기도 하지 않는다", async () => {
    const s = steps(["a.md"], null);
    expect(await closeWindowSafely(s)).toBe(false);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.close).not.toHaveBeenCalled();
  });
});

describe("closeWindowSafely: 자동 저장 멈춤", () => {
  /** 단계마다 그때의 SaveHold 를 적어 둔다 */
  const recorded = (answer: CloseChoice | null) => {
    const hold: SaveHold = { asking: false, closing: false };
    const seen: Record<string, boolean> = {};
    let saved = false;
    const s: CloseWindowSteps = {
      dirty: () => (saved ? [] : ["a.md"]),
      ask: async () => {
        seen.ask = savesHeld(hold);
        return answer;
      },
      save: async () => {
        seen.save = savesHeld(hold);
        saved = true;
      },
      unsaved: () => {},
      close: vi.fn(async () => {
        seen.close = savesHeld(hold);
      }),
      hold,
      dropPending: vi.fn(() => {
        seen.drop = savesHeld(hold);
      }),
    };
    return { s, hold, seen };
  };

  it("묻는 동안 자동 저장을 멈춘다", async () => {
    const { s, seen } = recorded(null);
    await closeWindowSafely(s);
    expect(seen.ask).toBe(true);
  });

  it("취소하면 다시 자동 저장한다", async () => {
    const { s, hold } = recorded(null);
    await closeWindowSafely(s);
    expect(savesHeld(hold)).toBe(false);
  });

  it("저장하지 않고 닫기: 창이 사라질 때까지 자동 저장을 멈추고, 닫기 전에 걸린 타이머를 지운다", async () => {
    const { s, seen } = recorded("discard");
    await closeWindowSafely(s);
    expect(seen.drop).toBe(true);
    expect(seen.close).toBe(true);
    expect((s.dropPending as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      (s.close as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
  });

  it("저장하고 닫기: 저장할 때는 멈추지 않는다", async () => {
    const { s, seen } = recorded("save");
    await closeWindowSafely(s);
    expect(seen.save).toBe(false);
    expect(seen.close).toBe(true);
  });

  it("닫다가 실패하면 다시 자동 저장한다", async () => {
    const { s, hold } = recorded("discard");
    (s.close as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("denied"));
    await expect(closeWindowSafely(s)).rejects.toThrow("denied");
    expect(savesHeld(hold)).toBe(false);
  });
});

describe("closeAskHandler", () => {
  const handler = (dirty: string[], answer: () => Promise<CloseChoice | null>, ack = true) => {
    const s = {
      ack: vi.fn(async () => ack),
      dirty: vi.fn(() => dirty),
      ask: vi.fn(answer),
      save: vi.fn(async () => {}),
      unsaved: vi.fn(),
      close: vi.fn(async () => {}),
      hold: { asking: false, closing: false },
      dropPending: vi.fn(),
      cancelled: vi.fn(),
      failed: vi.fn(),
    };
    return { s, on: closeAskHandler(s) };
  };

  it("먼저 받았다고 답하고 나서 묻는다", async () => {
    const { s, on } = handler(["a.md"], async () => "discard");
    await on(7);
    expect(s.ack).toHaveBeenCalledWith(7);
    expect(s.ack.mock.invocationCallOrder[0]).toBeLessThan(s.ask.mock.invocationCallOrder[0]);
    expect(s.close).toHaveBeenCalledOnce();
    expect(s.cancelled).not.toHaveBeenCalled();
  });

  it("앱이 새로 묻지 말라고 하면(이미 묻는 중·늦은 답) 묻지도 닫지도 않는다", async () => {
    const { s, on } = handler(["a.md"], async () => "discard", false);
    await on(7);
    expect(s.ask).not.toHaveBeenCalled();
    expect(s.close).not.toHaveBeenCalled();
    expect(s.cancelled).not.toHaveBeenCalled();
  });

  it("그사이 저장돼 저장 안 한 변경이 없으면 묻지 않고 닫는다", async () => {
    const { s, on } = handler([], async () => null);
    await on(1);
    expect(s.ask).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("취소하면 cancelled 를 부르고(앱의 차례 닫기를 멈춘다) 닫지 않는다", async () => {
    const { s, on } = handler(["a.md"], async () => null);
    await on(1);
    expect(s.cancelled).toHaveBeenCalledOnce();
    expect(s.close).not.toHaveBeenCalled();
  });

  it("닫다가 실패하면 cancelled 와 failed 를 부른다", async () => {
    const { s, on } = handler(["a.md"], async () => "discard");
    s.close.mockRejectedValueOnce(new Error("denied"));
    await on(1);
    expect(s.cancelled).toHaveBeenCalledOnce();
    expect(s.failed).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("restartAfterClosing", () => {
  it("알림을 먼저 듣고 나서 앱에 창마다 물은 뒤 다시 시작하라고 요청한다", async () => {
    let fire!: () => void;
    const off = vi.fn();
    const listenCancelled = vi.fn(async (on: () => void) => {
      fire = on;
      return off;
    });
    const request = vi.fn(async () => {});
    const done = restartAfterClosing({ listenCancelled, request });
    await new Promise((r) => setTimeout(r, 0));
    expect(listenCancelled.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(request).toHaveBeenCalledOnce();
    // 누가 취소하면 다시 시작하지 않고 cancelled 로 끝나고, 듣기를 그만둔다
    fire();
    expect(await done).toBe("cancelled");
    expect(off).toHaveBeenCalledOnce();
  });

  it("요청이 실패하면 그 오류로 끝난다", async () => {
    const off = vi.fn();
    const done = restartAfterClosing({ listenCancelled: async () => off, request: async () => Promise.reject(new Error("denied")) });
    await expect(done).rejects.toThrow("denied");
    expect(off).toHaveBeenCalledOnce();
  });
});

describe("dropAutosaves", () => {
  it("걸려 있는 자동 저장 타이머를 지워 돌지 않게 하고, 건 기록도 비운다", () => {
    vi.useFakeTimers();
    try {
      const fire = vi.fn();
      const timers = new Map([["a.md", setTimeout(fire, 1000)]]);
      const armed = new Map([["a.md", "armed"]]);
      dropAutosaves(timers, armed);
      vi.advanceTimersByTime(5000);
      expect(fire).not.toHaveBeenCalled();
      expect(timers.size).toBe(0);
      expect(armed.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("setCloseGuard", () => {
  it("페이지 번호는 문서를 만든 시각에서 얻어 나중 페이지가 크다(앱이 페이지가 바뀐 뒤 늦게 닿은 옛 요청을 가른다)", () => {
    expect(guardPage(1_730_000_000_000.123)).toBeLessThan(guardPage(1_730_000_000_000.5));
    expect(Number.isSafeInteger(guardPage(4_102_444_800_000))).toBe(true);
  });

  it("한 페이지에서는 같은 페이지 번호에 늘어나는 번호를 싣는다", async () => {
    invoke.mockClear();
    await setCloseGuard(null);
    await setCloseGuard({ message: "m", discard: "d", cancel: "c" });
    const [a, b] = invoke.mock.calls.map((c) => (c as unknown[])[1] as { page: number; seq: number });
    expect(invoke.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["set_close_guard", "set_close_guard"]);
    expect(a.page).toBe(guardPage());
    expect(b.page).toBe(a.page);
    expect(b.seq).toBeGreaterThan(a.seq);
  });
});

describe("Workspace 배선", () => {
  it("Tauri 의 JS 닫기 리스너를 걸지 않는다(새로고침 뒤에도 남아 창이 닫히지 않는다 — 막을지는 앱의 지킴이 정한다)", () => {
    expect(workspaceSrc).not.toMatch(/onCloseRequested/);
    expect(workspaceSrc).toMatch(/setCloseGuard\(/);
    expect(workspaceSrc).toMatch(/listenCloseAsks\(/);
  });

  it("자동 저장 타이머·창 blur·숨김·편집기 이탈 저장은 묻는 동안과 닫는 중 모두 멈춘다", () => {
    // 자동 저장 타이머(fire), 창 blur·숨김(go), 편집기 이탈 저장 — 셋 모두 savesHeld 로 검사한다
    expect(workspaceSrc.match(/savesHeld\(closeHold\.current\)/g)).toHaveLength(3);
    expect(workspaceSrc).not.toMatch(/askingClose/);
  });

  it("버리기로 정하면(dropPending) 걸려 있는 자동 저장 타이머를 지운다", () => {
    expect(workspaceSrc).toMatch(/dropPending: \(\) => dropAutosaves\(autosaveTimers\.current, autosaveArmed\.current\)/);
  });
});

describe("unsavedSummary", () => {
  const stem = (p: string) => p.replace(/^.*\//, "").replace(/\.md$/, "");

  it("셋까지는 이름을 모두 든다", () => {
    expect(unsavedSummary(["w/a.md", "w/b.md", "w/c.md"], stem)).toEqual({ names: '"a", "b", "c"', count: 3, more: false });
  });

  it("넘으면 앞의 셋만 들고 몇 개인지 알린다", () => {
    expect(unsavedSummary(["a.md", "b.md", "c.md", "d.md"], stem)).toEqual({ names: '"a", "b", "c"', count: 4, more: true });
  });
});
