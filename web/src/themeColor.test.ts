import { describe, expect, it } from "vitest";
import stylesCss from "./styles.css?raw";
import { applyThemeColor, THEME_BG } from "./themeColor";

/** querySelector 로 media 에 light·dark 가 든 theme-color 메타 둘을 돌려주는 가짜 문서 */
function fakeDoc() {
  const light = { content: "#ffffff" };
  const dark = { content: "#17191c" };
  const doc = {
    light,
    dark,
    querySelector(sel: string) {
      if (!sel.startsWith('meta[name="theme-color"]')) return null;
      if (sel.includes('[media*="light"]')) return light;
      if (sel.includes('[media*="dark"]')) return dark;
      return null;
    },
  };
  return doc;
}

describe("themeColor", () => {
  it("THEME_BG 는 styles.css 의 --bg 와 같다", () => {
    expect(stylesCss).toContain(`--bg: ${THEME_BG.light};`);
    expect(stylesCss).toContain(`--bg: ${THEME_BG.dark};`);
  });

  it("applyThemeColor 는 media 가 light·dark 인 메타에 각각 쓴다", () => {
    const doc = fakeDoc();
    applyThemeColor({ light: "#000000", dark: "#111111" }, doc as unknown as Document);
    expect(doc.light.content).toBe("#000000");
    expect(doc.dark.content).toBe("#111111");
    applyThemeColor({ light: THEME_BG.light, dark: THEME_BG.dark }, doc as unknown as Document);
    expect(doc.light.content).toBe("#ffffff");
    expect(doc.dark.content).toBe("#17191c");
  });

  it("메타가 없으면 아무것도 하지 않는다(던지지 않는다)", () => {
    const empty = { querySelector: () => null };
    expect(() => applyThemeColor({ light: "#000000", dark: "#000000" }, empty as unknown as Document)).not.toThrow();
  });
});
