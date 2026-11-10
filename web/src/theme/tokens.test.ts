import { THEME_DEFAULTS, THEME_TOKENS } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import stylesCss from "../styles.css?raw";

const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자가 정확히 sel 인 블록(중첩 없음)들의 선언을 모은다. media 가 주어지면 그 @media 블록 안에서만 */
function decls(sel: string, media?: string): Record<string, string> {
  const out: Record<string, string> = {};
  const scopes: string[] = [];
  if (media) {
    const head = `@media ${media} {`;
    let i = css.indexOf(head);
    while (i >= 0) {
      // 짝 맞는 닫는 괄호까지
      let depth = 0;
      let j = i + head.length - 1;
      for (; j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}" && --depth === 0) break;
      }
      scopes.push(css.slice(i + head.length, j));
      i = css.indexOf(head, j);
    }
  } else {
    // 맨 위 단계만: @media 블록을 지운다
    scopes.push(css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ""));
  }
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, "g");
  for (const scope of scopes) {
    for (const m of scope.matchAll(re)) {
      for (const d of m[1]!.split(";")) {
        const k = d.indexOf(":");
        if (k < 0) continue;
        const name = d.slice(0, k).trim();
        if (name.startsWith("--")) out[name] = d.slice(k + 1).trim();
      }
    }
  }
  return out;
}

const light = decls(":root");
const dark = decls(':root[data-theme="dark"]');
const mediaDark = decls(':root:not([data-theme="light"])', "(prefers-color-scheme: dark)");

/** styles.css 의 색 꼴 값(16진·rgb()·hsl()·oklch()) — 그림자처럼 색이 든 다른 값은 아니다 */
const COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^)]*\))$/;

describe("styles.css 와 THEME_TOKENS", () => {
  it("밝음 값이 THEME_DEFAULTS.light 와 같다", () => {
    for (const t of THEME_TOKENS) expect(light[t], t).toBe(THEME_DEFAULTS.light[t]);
  });

  it("어두움 값이 THEME_DEFAULTS.dark 와 같다", () => {
    for (const t of THEME_TOKENS) expect(dark[t], t).toBe(THEME_DEFAULTS.dark[t]);
  });

  it("시스템 어두움(미디어 쿼리) 벌이 data-theme=dark 벌과 같다", () => {
    expect(mediaDark).toEqual(dark);
  });

  it(":root 의 색 꼴 변수는 모두 THEME_TOKENS 에 있다", () => {
    const colorVars = Object.entries(light)
      .filter(([, v]) => COLOR_RE.test(v))
      .map(([k]) => k);
    expect(colorVars.length).toBeGreaterThan(0);
    expect(colorVars.filter((k) => !THEME_TOKENS.includes(k))).toEqual([]);
    const darkColorVars = Object.entries(dark)
      .filter(([, v]) => COLOR_RE.test(v))
      .map(([k]) => k);
    expect(darkColorVars.filter((k) => !THEME_TOKENS.includes(k))).toEqual([]);
  });

  it("--focus 는 --focus-ring 을 쓰고 어두운 벌에는 없다", () => {
    expect(light["--focus"]).toBe("0 0 0 2px var(--bg), 0 0 0 4px var(--focus-ring)");
    expect(dark["--focus"]).toBeUndefined();
    expect(mediaDark["--focus"]).toBeUndefined();
  });
});
