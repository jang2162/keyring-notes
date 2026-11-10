import { describe, expect, it } from "vitest";
import { composite, CONTRAST_MIN, contrastLabel, contrastRatio, isThemeColor, parseCssColor, type Rgba, themeContrast, toHex } from "../src/index.js";

function hex(v: string): string | undefined {
  const c = parseCssColor(v);
  return c ? toHex(c) : undefined;
}

function near(v: string, want: [number, number, number], tol = 1) {
  const c = parseCssColor(v)!;
  expect(c, v).not.toBeNull();
  expect(Math.abs(c.r - want[0]), `${v} r=${c.r}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(c.g - want[1]), `${v} g=${c.g}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(c.b - want[2]), `${v} b=${c.b}`).toBeLessThanOrEqual(tol);
}

const rgb = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });

describe("parseCssColor·toHex", () => {
  it("16진 3·6·8자리", () => {
    expect(hex("#abc")).toBe("#aabbcc");
    expect(hex("#A0B1C2")).toBe("#a0b1c2");
    const c = parseCssColor("#11223380")!;
    expect(c.a).toBeCloseTo(128 / 255, 3);
    expect(toHex(c)).toBe("#11223380");
  });

  it("rgb()·rgba() — 빈칸·쉼표·%·알파", () => {
    expect(hex("rgb(255 0 0)")).toBe("#ff0000");
    expect(hex("rgba(255, 0, 0, 1)")).toBe("#ff0000");
    expect(hex("rgb(100% 0% 0%)")).toBe("#ff0000");
    expect(parseCssColor("rgb(0 0 0 / 0.5)")!.a).toBe(0.5);
    expect(parseCssColor("rgb(0 0 0 / 50%)")!.a).toBe(0.5);
    expect(parseCssColor("rgba(0, 0, 0, 0.25)")!.a).toBe(0.25);
  });

  it("hsl()", () => {
    expect(hex("hsl(120deg 100% 25%)")).toBe("#008000");
    expect(hex("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(hex("hsla(240 100% 50% / 1)")).toBe("#0000ff");
  });

  it("oklch()·oklab()", () => {
    near("oklch(62.8% 0.2577 29.23)", [255, 0, 0]);
    near("oklch(0.628 0.2577 29.23deg)", [255, 0, 0]);
    expect(hex("oklch(0 0 0)")).toBe("#000000");
    expect(hex("oklch(1 0 0)")).toBe("#ffffff");
    expect(parseCssColor("oklab(0.5 -0.1 0.1)")).not.toBeNull();
    // 범위 밖은 0–1 로 자른다
    const c = parseCssColor("oklch(0.9 0.4 140)")!;
    for (const k of ["r", "g", "b"] as const) {
      expect(c[k]).toBeGreaterThanOrEqual(0);
      expect(c[k]).toBeLessThanOrEqual(255);
    }
  });

  it("isThemeColor 가 거부하는 값은 늘 null(주입 거부는 한 곳)", () => {
    for (const v of ["red", "url(x)", "rgb(1 2 3); x", "var(--bg)", "rgb(1 2 3)}", "#ggg", "", `rgb(${"0".repeat(98)} 0 0)`, "#fff\n"]) {
      expect(isThemeColor(v)).toBe(false);
      expect(parseCssColor(v), v).toBeNull();
    }
  });

  it("꼴은 지나도 읽을 수 없는 값은 null", () => {
    for (const v of ["rgb(1 2)", "rgb(1 2 3 4 5)", "rgb(1, 2 3)", "hsl(1deg)", "oklch(1)", "rgb(1 2 3 / 4 / 5)"]) {
      expect(isThemeColor(v), v).toBe(true);
      expect(parseCssColor(v), v).toBeNull();
    }
  });
});

describe("composite·contrastRatio", () => {
  it("검은 글·흰 바탕은 21", () => {
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBe(21);
  });

  it("#777 은 4.5 아래, #767676 은 위", () => {
    const r1 = contrastRatio(parseCssColor("#777")!, parseCssColor("#fff")!);
    const r2 = contrastRatio(parseCssColor("#767676")!, parseCssColor("#fff")!);
    expect(r1).toBeCloseTo(4.478, 2);
    expect(r1).toBeLessThan(CONTRAST_MIN);
    expect(r2).toBeCloseTo(4.54, 2);
    expect(r2).toBeGreaterThanOrEqual(CONTRAST_MIN);
  });

  it("반투명 글은 바탕 위에 합성해 잰다", () => {
    const half = contrastRatio(parseCssColor("rgb(0 0 0 / 0.5)")!, rgb(255, 255, 255));
    expect(half).toBeCloseTo(contrastRatio(rgb(127.5, 127.5, 127.5), rgb(255, 255, 255)), 6);
    expect(half).toBeCloseTo(contrastRatio(parseCssColor("#808080")!, rgb(255, 255, 255)), 1);
  });

  it("composite: 아래가 불투명이면 결과도 불투명", () => {
    expect(composite(rgb(0, 0, 0, 0.5), rgb(255, 255, 255))).toEqual(rgb(127.5, 127.5, 127.5, 1));
    expect(composite(rgb(0, 0, 0, 0), rgb(10, 20, 30))).toEqual(rgb(10, 20, 30, 1));
  });
});

describe("themeContrast·contrastLabel", () => {
  it("--fg = --bg 면 1", () => {
    expect(themeContrast({ light: { "--fg": "#fff", "--bg": "#fff" } }, "light")).toBe(1);
  });

  it("테마에 없는 토큰은 그 모드 기본값", () => {
    expect(themeContrast({ dark: { "--bg": "#000" } }, "dark")).toBeCloseTo(contrastRatio(parseCssColor("#e6e6e6")!, rgb(0, 0, 0)), 9);
    expect(themeContrast({ dark: { "--bg": "#000" } }, "light")).toBeCloseTo(contrastRatio(parseCssColor("#1f2328")!, rgb(255, 255, 255)), 9);
  });

  it("반투명 --bg 는 기본 --bg 위에 합성", () => {
    const base = themeContrast({}, "light")!;
    expect(themeContrast({ light: { "--bg": "rgb(255 255 255 / 0)" } }, "light")).toBeCloseTo(base, 9);
    expect(themeContrast({ dark: { "--bg": "rgb(255 255 255 / 0)" } }, "dark")).toBeCloseTo(themeContrast({}, "dark")!, 9);
  });

  it("꼴은 지났는데 읽을 수 없으면 null", () => {
    expect(themeContrast({ light: { "--fg": "rgb(1 2)" } }, "light")).toBeNull();
  });

  it("보일 때는 소수 첫째 자리 내림", () => {
    expect(contrastLabel(4.48)).toBe("4.4");
    expect(contrastLabel(4.5)).toBe("4.5");
    expect(contrastLabel(4.6)).toBe("4.6");
    expect(contrastLabel(21)).toBe("21.0");
    expect(contrastLabel(1)).toBe("1.0");
  });
});
