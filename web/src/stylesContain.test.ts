import { describe, expect, it } from "vitest";
import stylesCss from "./styles.css?raw";

type Rule = { selector: string; decls: Record<string, string>; at: string[] };

/** 맨 안쪽 블록(선언만 든 것)을 감싼 @규칙들과 함께 모은다 */
function rules(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (c === "}") {
      const body = css.slice(start, i);
      const prelude = stack.pop() ?? "";
      // 안에 블록이 있었으면 start 가 그 블록 뒤로 가 있어 body 에는 남은 공백뿐이다
      if (!prelude.startsWith("@") && body.includes(":")) {
        const decls: Record<string, string> = {};
        for (const d of body.split(";")) {
          const k = d.indexOf(":");
          if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim();
        }
        out.push({ selector: prelude.replace(/\s+/g, " "), decls, at: stack.filter((s) => s.startsWith("@")) });
      }
      start = i + 1;
    } else if (c === ";" && stack.length === 0) start = i + 1;
  }
  return out;
}

/** 위젯 iframe 이 그 아래에 올 수 없는 자리의 선택자 — 여기 적은 것만 아래 검사에서 뺀다 */
const NEVER_HOLDS_WIDGET_FRAME: string[] = [];

const contained = (css: string) => rules(css).filter((r) => r.decls.contain !== undefined && r.decls.contain !== "none");
const lifts = (r: Rule) => r.selector.split(",").every((s) => s.includes(":not(:has(.kw-fixed))"));
const hasOnly = (r: Rule) => r.at.some((a) => /^@supports\s+selector\(\s*:has\(/.test(a));
const unguarded = (css: string) => contained(css).filter((r) => !NEVER_HOLDS_WIDGET_FRAME.includes(r.selector) && !(lifts(r) && hasOnly(r)));

describe("styles.css 의 contain", () => {
  it("미리보기 칸은 레이아웃을 가둔다", () => {
    const pane = contained(stylesCss).filter((r) => /^\.preview-pane\b/.test(r.selector));
    expect(pane.map((r) => r.decls.contain)).toEqual(["layout"]);
  });

  it("가두는 규칙은 모두 .kw-fixed 가 켜진 동안 풀리고 :has() 를 아는 엔진에만 걸린다", () => {
    expect(contained(stylesCss).length).toBeGreaterThan(0);
    expect(unguarded(stylesCss).map((r) => r.selector)).toEqual([]);
  });

  it("검사가 풀지 않는 규칙·@supports 밖의 규칙을 가려낸다", () => {
    const ok = "@supports selector(:has(*)) { .a:not(:has(.kw-fixed)) { contain: layout; } }";
    expect(unguarded(ok)).toEqual([]);
    expect(unguarded(".a { contain: layout; }").map((r) => r.selector)).toEqual([".a"]);
    expect(unguarded(".a:not(:has(.kw-fixed)) { contain: layout; }").map((r) => r.selector)).toEqual([".a:not(:has(.kw-fixed))"]);
    expect(unguarded("@supports selector(:has(*)) { .a { contain: content; } }").map((r) => r.selector)).toEqual([".a"]);
    expect(unguarded("@media (max-width: 800px) { .a, .b:not(:has(.kw-fixed)) { contain: strict } }").map((r) => r.selector)).toEqual([
      ".a, .b:not(:has(.kw-fixed))",
    ]);
    // contain 속성이 아닌 것(값에 든 contain, 다른 속성)과 contain: none 은 대상이 아니다
    expect(unguarded(".a { overscroll-behavior: contain; object-fit: contain; contain: none; }")).toEqual([]);
  });
});
