import { describe, expect, it } from "vitest";
import { checkThemeColors, isThemeColor, THEME_DEFAULTS, THEME_TOKENS } from "../src/index.js";

describe("THEME_TOKENS", () => {
  it("55개이고 겹치지 않는다", () => {
    expect(THEME_TOKENS).toHaveLength(55);
    expect(new Set(THEME_TOKENS).size).toBe(55);
  });

  it("모두 테마 색 검사를 지난다(크기·글꼴 꼴에 걸리지 않음)", () => {
    for (const t of THEME_TOKENS) expect(checkThemeColors({ light: { [t]: "#000" } }).errors, t).toEqual([]);
  });

  it("그림자·간격 변수는 넣지 않는다", () => {
    for (const t of ["--focus", "--shadow", "--shadow-sm", "--sp-1", "--fs-base", "--radius"]) expect(THEME_TOKENS).not.toContain(t);
    expect(THEME_TOKENS).toContain("--focus-ring");
  });
});

describe("THEME_DEFAULTS", () => {
  it("밝음·어두움 키가 THEME_TOKENS 와 같고 값이 모두 색이다", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(Object.keys(THEME_DEFAULTS[mode]).sort()).toEqual([...THEME_TOKENS].sort());
      for (const [t, v] of Object.entries(THEME_DEFAULTS[mode])) expect(isThemeColor(v), `${mode} ${t}=${v}`).toBe(true);
    }
  });
});
