import { THEME_DEFAULTS, THEME_TOKENS } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import stylesCss from "../styles.css?raw";

const manuals = import.meta.glob("../../../docs/manual/*/how-to/publish-packages.md", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

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

/**
 * 테마 토큰이 아닌 것으로 정해 둔 변수: 크기·간격·글꼴·그림자(`--focus` 포함). 이 밖의 `:root` 변수는 모두 색으로 보고 THEME_TOKENS 에
 * 있어야 한다 — 색 꼴을 세면 `transparent`·이름 색·`color-mix()` 로 더한 새 색 변수를 놓친다.
 */
const NOT_THEME_RE = /^--(?:sp-|fs-|font-|radius|shadow|focus$)|-(?:w|h)$/;

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

  it(":root 의 크기·글꼴·그림자가 아닌 변수는 모두 THEME_TOKENS 에 있다", () => {
    for (const set of [light, dark]) {
      const vars = Object.keys(set).filter((k) => !NOT_THEME_RE.test(k));
      expect(vars.length).toBeGreaterThan(0);
      expect(vars.filter((k) => !THEME_TOKENS.includes(k))).toEqual([]);
    }
  });

  it("사용자 문서(publish-packages en·ko)의 토큰 표가 THEME_TOKENS·THEME_DEFAULTS 와 같다(순서 포함)", () => {
    const want = THEME_TOKENS.map((t) => [t, THEME_DEFAULTS.light[t], THEME_DEFAULTS.dark[t]]);
    expect(Object.keys(manuals)).toHaveLength(2);
    for (const [file, text] of Object.entries(manuals)) {
      const rows = [...text.matchAll(/^\| `(--[a-z0-9-]+)` \| [^|]+ \| `([^`]+)` \| `([^`]+)` \|$/gm)].map((m) => [m[1], m[2], m[3]]);
      expect(rows, file).toEqual(want);
    }
  });

  it("--focus 는 --focus-ring 을 쓰고 어두운 벌에는 없다", () => {
    expect(light["--focus"]).toBe("0 0 0 2px var(--bg), 0 0 0 4px var(--focus-ring)");
    expect(dark["--focus"]).toBeUndefined();
    expect(mediaDark["--focus"]).toBeUndefined();
  });
});
