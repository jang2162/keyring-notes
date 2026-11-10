import { describe, expect, it } from "vitest";
import { appliedTheme, applyThemeChoice, cacheAction, onThemeApplied, readThemeCache, setThemePackages, themePackages } from "./apply";
import { resolveTheme, type ThemePackage } from "./resolve";

const sea: ThemePackage = { id: "@me/sea", version: "0.1.0", name: { en: "Sea" }, colors: { light: { "--bg": "#eef6ff" }, dark: { "--bg": "#0d1b2a" } } };

describe("readThemeCache", () => {
  it("정상 캐시는 그대로", () => {
    expect(readThemeCache(JSON.stringify(sea))).toEqual(sea);
  });

  it("나쁜 값·이름은 그 토큰만 버린다(손으로 고친 캐시)", () => {
    const raw = { ...sea, colors: { light: { "--bg": "red; background: url(x)", "--fg": "#111", "--fs-base": "#000", "bad name": "#000", "--n": 3 } } };
    expect(readThemeCache(JSON.stringify(raw))).toEqual({ ...sea, colors: { light: { "--fg": "#111" } } });
  });

  it("id 꼴이 나쁘거나 깨진 JSON·빈 값은 null", () => {
    expect(readThemeCache(JSON.stringify({ ...sea, id: "@../x" }))).toBeNull();
    expect(readThemeCache(JSON.stringify({ ...sea, version: 3 }))).toBeNull();
    expect(readThemeCache("{")).toBeNull();
    expect(readThemeCache(null)).toBeNull();
    expect(readThemeCache("[]")).toBeNull();
  });

  it("name 의 글자가 아닌 값은 버린다", () => {
    expect(readThemeCache(JSON.stringify({ ...sea, name: { en: "Sea", ko: 3 } }))!.name).toEqual({ en: "Sea" });
  });
});

describe("cacheAction", () => {
  const env = { systemDark: false, escape: false };
  it("받은 테마를 그리면 write, 기본이면 clear, escape 면 keep", () => {
    expect(cacheAction(resolveTheme("@me/sea", [sea], env), false)).toBe("write");
    expect(cacheAction(resolveTheme("system", [sea], env), false)).toBe("clear");
    expect(cacheAction(resolveTheme("@me/sea", [], env), false)).toBe("clear");
    expect(cacheAction(resolveTheme("@me/sea", [sea], { ...env, escape: true }), true)).toBe("keep");
    expect(cacheAction(resolveTheme("dark", [sea], { ...env, escape: true }), true)).toBe("keep");
  });
});

describe("setThemePackages", () => {
  it("목록을 바꾼다(합치지 않는다) — 캐시의 옛 판은 새 목록의 판으로", () => {
    const seen: (string | null)[] = [];
    const off = onThemeApplied((r) => seen.push(r.packageId));
    applyThemeChoice("@me/sea");
    setThemePackages([sea]);
    expect(appliedTheme().packageId).toBe("@me/sea");
    const newer = { ...sea, version: "0.2.0", colors: { light: { "--bg": "#ffffff" } } };
    setThemePackages([newer]);
    expect(themePackages()).toEqual([newer]);
    expect(appliedTheme().tokens).toEqual({ "--bg": "#ffffff" });
    setThemePackages([]);
    expect(themePackages()).toEqual([]);
    expect(appliedTheme()).toMatchObject({ packageId: null, missing: "@me/sea" });
    off();
    expect(seen.at(-1)).toBeNull();
    applyThemeChoice("system");
  });
});
