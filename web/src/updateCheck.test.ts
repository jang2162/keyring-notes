import { describe, expect, it, vi } from "vitest";
import { installAndRestart, startupCheck } from "./updateCheck";

// 다시 시작은 창마다 묻는 길(restartAfterClosing)로만 한다. 플러그인의 relaunch 는 묻지 않고 초안을 버린다
const { relaunch, restartAfterClosing } = vi.hoisted(() => ({ relaunch: vi.fn(), restartAfterClosing: vi.fn(async () => "cancelled" as const) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("./closeWindow", async (orig) => ({ ...(await orig<typeof import("./closeWindow")>()), restartAfterClosing }));

describe("실행 때 업데이트 확인", () => {
  it("「업데이트 자동 확인」 이 꺼져 있으면 확인 요청을 보내지 않는다", async () => {
    const check = vi.fn(async () => ({ version: "9.9.9" }));
    const onFound = vi.fn();
    expect(await startupCheck({ enabled: false, supported: true, check, onFound })).toBe("off");
    expect(check).not.toHaveBeenCalled();
    expect(onFound).not.toHaveBeenCalled();
  });

  it("데스크톱 앱이 아니면(웹·모바일) 켜져 있어도 확인하지 않는다", async () => {
    const check = vi.fn(async () => null);
    expect(await startupCheck({ enabled: true, supported: false, check, onFound: vi.fn() })).toBe("off");
    expect(check).not.toHaveBeenCalled();
  });

  it("켜져 있으면 한 번 확인하고, 찾은 것은 넘기기만 한다(설치는 대화상자에서 고른 뒤)", async () => {
    const update = { version: "0.9.0", downloadAndInstall: vi.fn() };
    const check = vi.fn(async () => update);
    const onFound = vi.fn();
    expect(await startupCheck({ enabled: true, supported: true, check, onFound })).toBe("found");
    expect(check).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith(update);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("새 버전이 없거나 확인이 실패하면 아무것도 띄우지 않는다", async () => {
    const onFound = vi.fn();
    expect(await startupCheck({ enabled: true, supported: true, check: async () => null, onFound })).toBe("none");
    expect(await startupCheck({ enabled: true, supported: true, check: () => Promise.reject(new Error("offline")), onFound })).toBe("failed");
    expect(onFound).not.toHaveBeenCalled();
  });
});

describe("업데이트 설치 뒤 다시 시작", () => {
  it("설치한 뒤 창마다 닫기 물음을 거치는 다시 시작을 요청하고, 묻지 않는 relaunch 는 부르지 않는다", async () => {
    const update = { downloadAndInstall: vi.fn(async () => {}) };
    const onRestart = vi.fn();
    await installAndRestart(update, () => {}, onRestart);
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(restartAfterClosing).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall.mock.invocationCallOrder[0]).toBeLessThan(restartAfterClosing.mock.invocationCallOrder[0]);
    expect(onRestart).toHaveBeenCalledOnce();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("누가 취소하면 다시 시작하지 않고 cancelled 로 끝난다(업데이트는 설치된 채)", async () => {
    const restart = vi.fn(async () => "cancelled" as const);
    expect(
      await installAndRestart(
        { downloadAndInstall: async () => {} },
        () => {},
        () => {},
        restart,
      ),
    ).toBe("cancelled");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("설치가 실패하면 다시 시작을 요청하지 않는다", async () => {
    const restart = vi.fn(async () => "cancelled" as const);
    const update = { downloadAndInstall: async () => Promise.reject(new Error("bad signature")) };
    await expect(
      installAndRestart(
        update,
        () => {},
        () => {},
        restart,
      ),
    ).rejects.toThrow("bad signature");
    expect(restart).not.toHaveBeenCalled();
  });
});
