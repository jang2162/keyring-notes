import { beforeEach, describe, expect, it, vi } from "vitest";
import { availableUpdate, installAndQuit, installAndRestart, startupCheck } from "./updateCheck";

// 다시 시작·끄기는 창마다 묻는 길(restartAfterClosing·quitAfterClosing)로만 한다
const { restartAfterClosing, quitAfterClosing } = vi.hoisted(() => ({
  restartAfterClosing: vi.fn(async () => "cancelled" as const),
  quitAfterClosing: vi.fn(async () => {}),
}));
vi.mock("./closeWindow", async (orig) => ({ ...(await orig<typeof import("./closeWindow")>()), restartAfterClosing, quitAfterClosing }));

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
  it("설치한 뒤 창마다 닫기 물음을 거치는 다시 시작을 요청한다", async () => {
    const update = { downloadAndInstall: vi.fn(async () => {}) };
    const onRestart = vi.fn();
    await installAndRestart(update, () => {}, onRestart);
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(restartAfterClosing).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall.mock.invocationCallOrder[0]).toBeLessThan(restartAfterClosing.mock.invocationCallOrder[0]);
    expect(onRestart).toHaveBeenCalledOnce();
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

describe("업데이트 설치하고 끄기(Quit 앞의 물음)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("설치한 뒤 다시 시작이 아니라 창마다 닫기 물음을 거치는 Quit 차례를 요청한다", async () => {
    const update = { downloadAndInstall: vi.fn(async () => {}) };
    const onInstalled = vi.fn();
    await installAndQuit(update, () => {}, onInstalled);
    expect(quitAfterClosing).toHaveBeenCalledOnce();
    expect(restartAfterClosing).not.toHaveBeenCalled();
    expect(update.downloadAndInstall.mock.invocationCallOrder[0]).toBeLessThan(onInstalled.mock.invocationCallOrder[0]);
    expect(onInstalled.mock.invocationCallOrder[0]).toBeLessThan(quitAfterClosing.mock.invocationCallOrder[0]);
  });

  it("설치가 실패하면 끄지 않는다(오류를 보이고 다시 고르게 한다)", async () => {
    const quit = vi.fn(async () => {});
    const onInstalled = vi.fn();
    const update = { downloadAndInstall: async () => Promise.reject(new Error("offline")) };
    await expect(installAndQuit(update, () => {}, onInstalled, quit)).rejects.toThrow("offline");
    expect(onInstalled).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});

describe("「새 버전이 있다」 상태(레드닷)", () => {
  const upd = (version: string) => ({ version, close: vi.fn(async () => {}) });

  it("있고 없음이 바뀔 때만 앱에 알리고, 듣는 쪽에 넘긴다", () => {
    const report = vi.fn();
    const a = availableUpdate({ report, inUse: () => false });
    const seen = vi.fn();
    a.subscribe(seen);
    const one = upd("0.9.0");
    a.set(one);
    a.set(one);
    a.set(upd("0.9.1"));
    expect(report.mock.calls).toEqual([[true]]);
    a.set(null);
    expect(report.mock.calls).toEqual([[true], [false]]);
    expect(seen).toHaveBeenCalledTimes(3);
    expect(a.get()).toBeNull();
  });

  it("갈아 끼운 업데이트는 놓되, 대화상자가 쥔 것은 놓지 않는다", () => {
    const shown = upd("0.9.0");
    const a = availableUpdate<ReturnType<typeof upd>>({ report: () => {}, inUse: (u) => u === shown });
    a.set(shown);
    a.set(null);
    expect(shown.close).not.toHaveBeenCalled();
    const other = upd("0.9.1");
    a.set(other);
    a.set(upd("0.9.2"));
    expect(other.close).toHaveBeenCalledOnce();
  });
});
