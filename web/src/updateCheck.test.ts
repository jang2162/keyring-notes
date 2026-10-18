import { describe, expect, it, vi } from "vitest";
import { startupCheck } from "./updateCheck";

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
