import { describe, expect, it } from "vitest";
import { isDark } from "./theme";

describe("Excalidraw isDark", () => {
  it("3·6·8자리 16진과 rgb()", () => {
    expect(isDark("#17191c")).toBe(true);
    expect(isDark("#fff")).toBe(false);
    expect(isDark("#17191cff")).toBe(true);
    expect(isDark("#ffffff80")).toBe(false);
    expect(isDark("rgb(10, 20, 30)")).toBe(true);
    expect(isDark("rgb(250 250 250 / 0.5)")).toBe(false);
  });

  it("읽지 못하면 밝음", () => {
    expect(isDark(undefined)).toBe(false);
    expect(isDark("oklch(0.2 0 0)")).toBe(false);
  });
});
