import { beforeEach, describe, expect, it, vi } from "vitest";
import { validPref } from "./prefs";

const { updateVaultSetting } = vi.hoisted(() => ({ updateVaultSetting: vi.fn(async () => undefined) }));
vi.mock("./vaultSettings", () => ({ updateVaultSetting, onVaultSettings: () => () => undefined }));

describe("validPref", () => {
  it("theme: 셋 또는 패키지 id", () => {
    for (const v of ["system", "light", "dark", "@me/sea", "@keyring/paper-2"]) expect(validPref("theme", v)).toBe(v);
  });

  it("theme: 잘못된 꼴은 버린다(손으로 고친 공통 설정)", () => {
    for (const v of ["@../x", "@Me/Sea", "blue", "@me/sea@1", "", 3, null, { id: "@me/sea" }]) expect(validPref("theme", v), String(v)).toBeUndefined();
  });

  it("다른 열거 값은 그대로 검사", () => {
    expect(validPref("editorFont", "mono")).toBe("mono");
    expect(validPref("editorFont", "@me/sea")).toBeUndefined();
  });
});

describe("clearRemovedChoice", () => {
  async function load(store: Record<string, unknown>) {
    vi.resetModules();
    const m = new Map(Object.entries(store).map(([k, v]) => [k, JSON.stringify(v)]));
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    });
    return import("./prefs");
  }
  beforeEach(() => {
    vi.useFakeTimers();
    updateVaultSetting.mockClear();
  });

  it("공통 값이 지운 테마면 공통 값을 system 으로(덮어쓰기는 만들지 않음)", async () => {
    const p = await load({ "keyring:ui-cache": { theme: "@me/sea" } });
    expect(p.getPrefs().theme).toBe("@me/sea");
    p.clearRemovedChoice("theme", "@me/sea");
    expect(p.sharedPref("theme")).toBe("system");
    expect(p.isLocalOverride("theme")).toBe(false);
    expect(p.getPrefs().theme).toBe("system");
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateVaultSetting).toHaveBeenCalledWith(["ui", "theme"], "system");
  });

  it("덮어쓰기가 지운 테마면 덮어쓰기만 system, 공통 값은 그대로", async () => {
    const p = await load({ "keyring:ui-cache": { theme: "dark" }, "keyring:prefs-local": { theme: "@me/sea" } });
    p.clearRemovedChoice("theme", "@me/sea");
    expect(p.isLocalOverride("theme")).toBe(true);
    expect(p.getPrefs().theme).toBe("system");
    expect(p.sharedPref("theme")).toBe("dark");
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateVaultSetting).not.toHaveBeenCalled();
  });

  it('둘 다 다른 값이면 아무것도 하지 않는다, language 는 "" 로', async () => {
    const p = await load({ "keyring:ui-cache": { theme: "dark", language: "ja" } });
    p.clearRemovedChoice("theme", "@me/sea");
    expect(p.sharedPref("theme")).toBe("dark");
    p.clearRemovedChoice("language", "ja");
    expect(p.sharedPref("language")).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateVaultSetting.mock.calls).toEqual([[["ui", "language"], ""]]);
  });
});
