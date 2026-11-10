import { describe, expect, it } from "vitest";
import { widgetThemeValue } from "./themeValue";

describe("widgetThemeValue", () => {
  it("읽을 수 있는 색은 16진으로(위젯이 oklch() 를 못 읽어도 되게)", () => {
    expect(widgetThemeValue("oklch(1 0 0)")).toBe("#ffffff");
    expect(widgetThemeValue("#17191c")).toBe("#17191c");
    expect(widgetThemeValue(" rgb(255 0 0) ")).toBe("#ff0000");
    expect(widgetThemeValue("rgb(0 0 0 / 0.5)")).toBe("#00000080");
  });

  it("읽지 못하면 그대로", () => {
    expect(widgetThemeValue("")).toBe("");
    expect(widgetThemeValue("transparent")).toBe("transparent");
  });
});
