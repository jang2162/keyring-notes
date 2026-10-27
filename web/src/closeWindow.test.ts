import { describe, expect, it, vi } from "vitest";
import {
  canCloseWindow,
  closeRequestHandler,
  closeWindowCommands,
  closeWindowSafely,
  unsavedSummary,
  type CloseChoice,
  type CloseWindowSteps,
} from "./closeWindow";
import { normalizeCombo } from "./shortcuts";
import workspaceSrc from "./Workspace.tsx?raw";

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

describe("closeRequestHandler", () => {
  const request = () => ({ preventDefault: vi.fn() });
  const flushAsync = () => new Promise((r) => setTimeout(r, 0));
  const handler = (dirty: string[], answer: () => Promise<CloseChoice | null>) => {
    const s = {
      dirty: vi.fn(() => dirty),
      ask: vi.fn(answer),
      save: vi.fn(async () => {}),
      unsaved: vi.fn(),
      close: vi.fn(async () => {}),
      cancelled: vi.fn(),
      failed: vi.fn(),
    };
    return { s, on: closeRequestHandler(s) };
  };

  it("저장 안 한 변경이 없으면 막지 않는다(그대로 닫힌다)", () => {
    const { s, on } = handler([], async () => null);
    const e = request();
    on(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(s.ask).not.toHaveBeenCalled();
  });

  it("있으면 막고 묻고, 닫기로 정하면 닫기 요청을 다시 거치지 않는 close 로 닫는다", async () => {
    const { s, on } = handler(["a.md"], async () => "discard");
    const e = request();
    on(e);
    expect(e.preventDefault).toHaveBeenCalled();
    await flushAsync();
    expect(s.ask).toHaveBeenCalledOnce();
    expect(s.close).toHaveBeenCalledOnce();
    expect(s.cancelled).not.toHaveBeenCalled();
  });

  it("묻는 동안 또 온 요청은 막기만 하고 다시 묻지 않는다", async () => {
    let answer!: (v: CloseChoice | null) => void;
    const { s, on } = handler(["a.md"], () => new Promise((r) => (answer = r)));
    on(request());
    const again = request();
    on(again);
    expect(again.preventDefault).toHaveBeenCalled();
    expect(s.ask).toHaveBeenCalledOnce();
    answer(null);
    await flushAsync();
    // 물음이 끝난 뒤의 요청은 다시 묻는다
    on(request());
    expect(s.ask).toHaveBeenCalledTimes(2);
  });

  it("취소하면 cancelled 를 부르고(앱 끝내기를 멈춘다) 닫지 않는다", async () => {
    const { s, on } = handler(["a.md"], async () => null);
    on(request());
    await flushAsync();
    expect(s.cancelled).toHaveBeenCalledOnce();
    expect(s.close).not.toHaveBeenCalled();
  });

  it("닫다가 실패하면 cancelled 와 failed 를 부른다", async () => {
    const { s, on } = handler(["a.md"], async () => "discard");
    s.close.mockRejectedValueOnce(new Error("denied"));
    on(request());
    await flushAsync();
    expect(s.cancelled).toHaveBeenCalledOnce();
    expect(s.failed).toHaveBeenCalledWith(expect.any(Error));
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
