import { describe, expect, it } from "vitest";
import stylesCss from "./styles.css?raw";

/**
 * 메뉴 항목(<button class="menu-item">)의 글자색을 styles.css 의 겹침 순서대로 고른다.
 * 결합자 없는 선택자(태그·클래스·:hover·:disabled·:not(:disabled))만 본다 — 메뉴 항목에 걸리는 규칙은 이것뿐이다.
 * @규칙 안(테마 블록 등)의 규칙은 보지 않는다
 */
function menuItemColor(classes: string[], state: { hover?: boolean } = {}): string | undefined {
  const css = stylesCss.replace(/\/\*[\s\S]*?\*\//g, "");
  let best: { spec: number; order: number; value: string } | undefined;
  let order = 0;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      const prelude = css.slice(start, i).trim();
      const end = css.indexOf("}", i);
      const body = css.slice(i + 1, end);
      if (depth === 0 && !prelude.startsWith("@") && !body.includes("{")) {
        const color = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
        if (color)
          for (const sel of prelude.split(",").map((s) => s.trim())) {
            const spec = match(sel, classes, state);
            order++;
            if (spec !== null && (!best || spec > best.spec || (spec === best.spec && order > best.order))) best = { spec, order, value: color };
          }
        start = end + 1;
        i = end;
        continue;
      }
      depth++;
      start = i + 1;
    } else if (css[i] === "}") {
      depth = Math.max(0, depth - 1);
      start = i + 1;
    } else if (css[i] === ";" && depth === 0) start = i + 1;
  }
  return best?.value;
}

/** 맞으면 특이도(id 없음: 클래스·의사 클래스 ×10 + 태그), 아니면 null */
function match(sel: string, classes: string[], state: { hover?: boolean }): number | null {
  if (/[\s>+~[]/.test(sel) || sel.includes("::")) return null;
  let s = sel;
  let spec = 0;
  for (const [pseudo, ok] of [
    [":not(:disabled)", true],
    [":disabled", false],
    [":hover", !!state.hover],
  ] as const) {
    while (s.includes(pseudo)) {
      if (!ok) return null;
      s = s.replace(pseudo, "");
      spec += 10;
    }
  }
  if (s.includes(":")) return null;
  const m = /^([a-z]*)((?:\.[\w-]+)*)$/.exec(s);
  if (!m) return null;
  if (m[1] && m[1] !== "button") return null;
  if (m[1]) spec += 1;
  for (const c of m[2].split(".").filter(Boolean)) {
    if (!classes.includes(c)) return null;
    spec += 10;
  }
  return spec;
}

describe("메뉴 항목의 글자색", () => {
  it("포인터·화살표로 고른 줄(.on)도 평소 글자색 그대로다 — 전역 button.on(눌린 토글)의 --on-accent 를 받지 않는다", () => {
    expect(menuItemColor(["menu-item"])).toBe("var(--fg)");
    expect(menuItemColor(["menu-item", "on"], { hover: true })).toBe("var(--fg)");
    expect(menuItemColor(["menu-item", "on"])).toBe("var(--fg)");
  });

  it("위험 항목·지금 고른 항목은 고른 줄이어도 제 색을 지킨다", () => {
    expect(menuItemColor(["menu-item", "danger", "on"], { hover: true })).toBe("var(--danger)");
    expect(menuItemColor(["menu-item", "checked", "on"], { hover: true })).toBe("var(--accent)");
  });

  it("고르는 규칙이 전역 button.on 을 실제로 본다(검사 자체가 살아 있는지)", () => {
    expect(menuItemColor(["on"])).toBe("var(--on-accent)");
  });
});
