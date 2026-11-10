import { THEME_DEFAULTS } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import { resolveTheme, type ThemePackage, themeModes } from "./resolve";

const LIGHT_BG = THEME_DEFAULTS.light["--bg"]!;
const DARK_BG = THEME_DEFAULTS.dark["--bg"]!;

const sea: ThemePackage = {
  id: "@me/sea",
  version: "0.1.0",
  name: { en: "Sea" },
  colors: { light: { "--bg": "#eef6ff", "--accent": "#1d6fb8" }, dark: { "--bg": "#0d1b2a" } },
};
const paper: ThemePackage = { id: "@me/paper", version: "0.1.0", name: { en: "Paper" }, colors: { light: { "--bg": "#fbf8f1", "--fg": "#2b2925" } } };
const env = (systemDark: boolean, escape = false) => ({ systemDark, escape });

describe("resolveTheme", () => {
  it("system: data-theme 없음, 토큰 없음, 메타는 기본 두 색, 모드는 시스템", () => {
    for (const dark of [false, true])
      expect(resolveTheme("system", [sea], env(dark))).toEqual({
        dataTheme: null,
        mode: dark ? "dark" : "light",
        tokens: {},
        metaBg: { light: LIGHT_BG, dark: DARK_BG },
        packageId: null,
        missing: null,
      });
  });

  it("light·dark: 그 모드, 메타 두 벌이 같은 색", () => {
    expect(resolveTheme("light", [], env(true))).toMatchObject({ dataTheme: "light", mode: "light", tokens: {}, metaBg: { light: LIGHT_BG, dark: LIGHT_BG } });
    expect(resolveTheme("dark", [], env(false))).toMatchObject({ dataTheme: "dark", mode: "dark", tokens: {}, metaBg: { light: DARK_BG, dark: DARK_BG } });
  });

  it("둘 다 가진 테마는 시스템을 따른다", () => {
    expect(resolveTheme("@me/sea", [sea], env(true))).toEqual({
      dataTheme: "dark",
      mode: "dark",
      tokens: { "--bg": "#0d1b2a" },
      metaBg: { light: "#0d1b2a", dark: "#0d1b2a" },
      packageId: "@me/sea",
      missing: null,
    });
    expect(resolveTheme("@me/sea", [sea], env(false))).toMatchObject({
      dataTheme: "light",
      tokens: { "--bg": "#eef6ff", "--accent": "#1d6fb8" },
      metaBg: { light: "#eef6ff", dark: "#eef6ff" },
    });
  });

  it("밝음만 가진 테마는 어두운 시스템에서도 밝음(data-theme=light)", () => {
    expect(resolveTheme("@me/paper", [paper], env(true))).toMatchObject({ dataTheme: "light", mode: "light", metaBg: { light: "#fbf8f1", dark: "#fbf8f1" } });
  });

  it("모르는 토큰과 나쁜 값은 tokens 에 없다", () => {
    const bad: ThemePackage = { ...paper, colors: { light: { "--zz": "#000", "--bg": "red; background: url(x)", "--fg": "#111111" } } };
    const r = resolveTheme("@me/paper", [bad], env(false));
    expect(r.tokens).toEqual({ "--fg": "#111111" });
    expect(r.metaBg).toEqual({ light: LIGHT_BG, dark: LIGHT_BG });
  });

  it("반투명 --bg 의 메타는 기본 --bg 위에 합성한 #rrggbb", () => {
    const glass: ThemePackage = { ...paper, colors: { dark: { "--bg": "rgb(255 255 255 / 0.5)" } } };
    const r = resolveTheme("@me/paper", [glass], env(false));
    expect(r.mode).toBe("dark");
    expect(r.metaBg.light).toBe("#8b8c8e");
    expect(r.tokens["--bg"]).toBe("rgb(255 255 255 / 0.5)");
  });

  it("고른 테마가 없으면 system 과 같고 missing", () => {
    expect(resolveTheme("@me/sea", [], env(true))).toEqual({ ...resolveTheme("system", [], env(true)), missing: "@me/sea" });
  });

  it("escape 면 system 과 같고 missing·packageId 없음", () => {
    expect(resolveTheme("@me/sea", [sea], env(true, true))).toEqual(resolveTheme("system", [], env(true)));
    expect(resolveTheme("@me/gone", [], env(false, true))).toEqual(resolveTheme("system", [], env(false)));
  });
});

describe("themeModes", () => {
  it("가진 모드", () => {
    expect(themeModes(sea)).toEqual(["light", "dark"]);
    expect(themeModes(paper)).toEqual(["light"]);
    expect(themeModes({ ...paper, colors: { dark: {} } })).toEqual(["dark"]);
  });
});
