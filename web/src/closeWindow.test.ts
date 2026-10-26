import { describe, expect, it, vi } from "vitest";
import { canCloseWindow, closeWindowCommands, closeWindowSafely, type CloseWindowSteps } from "./closeWindow";
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
  const steps = (dirtyBefore: string[], dirtyAfter: string[], answer: boolean) => {
    let flushed = false;
    const s = {
      dirty: vi.fn(() => (flushed ? dirtyAfter : dirtyBefore)),
      flush: vi.fn(async () => {
        flushed = true;
      }),
      confirm: vi.fn(async () => answer),
      close: vi.fn(async () => {}),
    } satisfies CloseWindowSteps;
    return s;
  };

  it("저장 안 한 변경이 없으면 묻지 않고 닫는다", async () => {
    const s = steps([], [], false);
    expect(await closeWindowSafely(s)).toBe(true);
    expect(s.flush).not.toHaveBeenCalled();
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("먼저 저장하고, 저장으로 다 풀리면 묻지 않고 닫는다", async () => {
    const s = steps(["a.md"], [], false);
    expect(await closeWindowSafely(s)).toBe(true);
    expect(s.flush).toHaveBeenCalledOnce();
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it("저장하고도 남은 변경은 그 문서들을 들어 묻고, 취소하면 닫지 않는다", async () => {
    const s = steps(["a.md", "b.md"], ["b.md"], false);
    expect(await closeWindowSafely(s)).toBe(false);
    expect(s.flush.mock.invocationCallOrder[0]).toBeLessThan(s.confirm.mock.invocationCallOrder[0]);
    expect(s.confirm).toHaveBeenCalledWith(["b.md"]);
    expect(s.close).not.toHaveBeenCalled();
  });

  it("버리기로 하면 닫는다", async () => {
    const s = steps(["a.md"], ["a.md"], true);
    expect(await closeWindowSafely(s)).toBe(true);
    expect(s.close).toHaveBeenCalledOnce();
  });
});
