import { describe, expect, it } from "vitest";
import { applyThemeColor, THEME_BG, themeColorContents } from "./themeColor";

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

// vitest 는 CSS 의 ?raw 를 빈 글로 바꾸므로(CSS 처리를 끈 기본값) 파일을 직접 읽는다.
// web 의 tsconfig 는 node 타입을 싣지 않는다(실으면 setTimeout 같은 전역 타입이 바뀌어 다른 시험이 깨진다) — 쓰는 함수만 적는다
const { readFileSync } = (await import("node:fs" as string)) as { readFileSync(path: URL, encoding: "utf8"): string };
const stylesCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("themeColor", () => {
  it("THEME_BG 는 styles.css 의 --bg 와 같다", () => {
    expect(stylesCss).toContain(`--bg: ${THEME_BG.light};`);
    expect(stylesCss).toContain(`--bg: ${THEME_BG.dark};`);
  });

  it("system 은 미디어 쿼리별로 두 색", () => {
    expect(themeColorContents("system")).toEqual({ light: "#ffffff", dark: "#17191c" });
  });

  it("light 를 고르면 두 메타 모두 밝은 색", () => {
    expect(themeColorContents("light")).toEqual({ light: "#ffffff", dark: "#ffffff" });
  });

  it("dark 를 고르면 두 메타 모두 어두운 색", () => {
    expect(themeColorContents("dark")).toEqual({ light: "#17191c", dark: "#17191c" });
  });

  it("applyThemeColor 는 media 가 light·dark 인 메타의 content 를 바꾼다", () => {
    const doc = fakeDoc();
    applyThemeColor("dark", doc as unknown as Document);
    expect(doc.light.content).toBe("#17191c");
    expect(doc.dark.content).toBe("#17191c");
    applyThemeColor("system", doc as unknown as Document);
    expect(doc.light.content).toBe("#ffffff");
    expect(doc.dark.content).toBe("#17191c");
  });

  it("메타가 없으면 아무것도 하지 않는다(던지지 않는다)", () => {
    const empty = { querySelector: () => null };
    expect(() => applyThemeColor("dark", empty as unknown as Document)).not.toThrow();
  });
});
