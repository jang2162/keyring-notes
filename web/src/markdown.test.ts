// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LinkResolver, renderInlineMarkdown, renderMarkdown } from "./markdown";

const resolver = new LinkResolver([
  {
    name: "w",
    path: "w",
    type: "dir",
    children: [
      { name: "page.md", path: "w/page.md", type: "file" },
      { name: "doc.md", path: "w/doc.md", type: "file" },
    ],
  },
]);
const ctx = { resolver, docPath: "w/doc.md" };
const html = (src: string) => renderMarkdown(src, ctx).html;

/** 그린 결과를 DOM 으로(속성 값을 글자 대조가 아니라 풀린 값으로 본다) */
function dom(src: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html(src);
  return el;
}

/** 주소가 들어가는 속성 값 전부 */
function urlAttrs(root: HTMLElement): string[] {
  return [...root.querySelectorAll("*")].flatMap((el) => ["href", "src", "xlink:href", "action", "formaction"].flatMap((n) => el.getAttribute(n) ?? []));
}

describe("renderMarkdown: 깨진 퍼센트 인코딩", () => {
  it("상대 링크의 앵커가 깨져 있어도 던지지 않고 원문 그대로 쓴다", () => {
    const a = dom("[카페](page.md#caf%E9)").querySelector("a")!;
    expect(a.dataset.wikilink).toBe("w/page.md");
    expect(a.dataset.resolved).toBe("1");
    expect(a.dataset.heading).toBe("caf%e9");
    expect(a.textContent).toBe("카페");
  });

  it("멀쩡한 앵커는 풀어서 쓴다", () => {
    expect(dom("[x](page.md#%EC%B9%B4%ED%8E%98)").querySelector("a")!.dataset.heading).toBe("카페");
    expect(dom("[x](page.md#%5Eblk)").querySelector("a")!.dataset.block).toBe("blk");
  });

  it("상대 링크의 경로가 깨져 있어도 던지지 않는다", () => {
    const a = dom("[x](caf%E9.md)").querySelector("a")!;
    expect(a.dataset.wikilink).toBe("w/caf%E9.md");
    expect(a.dataset.resolved).toBe("0");
  });

  it("상대 경로 이미지의 주소가 깨져 있어도 던지지 않는다", () => {
    expect(dom("![그림](img/caf%E9.png)").querySelector("img")).not.toBeNull();
  });

  it("경로와 앵커가 % 하나뿐이어도 던지지 않는다", () => {
    expect(() => html("[a](%#%) ![b](%) [c](x.md#%E0%A4%A)")).not.toThrow();
  });

  it("줄 안 렌더(표 칸)도 던지지 않는다", () => {
    const el = document.createElement("div");
    el.innerHTML = renderInlineMarkdown("[카페](page.md#caf%E9)", ctx);
    expect(el.querySelector("a")!.dataset.heading).toBe("caf%e9");
  });
});

describe("renderMarkdown: 짝 없는 서로게이트", () => {
  // encodeURIComponent 는 짝 없는 서로게이트에서 던진다 — 수식·다이어그램 원문을 속성에 넣는 자리가 그것을 쓴다
  const lone = "\uD83D";

  it("수식·다이어그램 원문에 있어도 던지지 않는다", () => {
    expect(() => html(`$a${lone}b$`)).not.toThrow();
    expect(() => html(`$$\na${lone}b\n$$`)).not.toThrow();
    expect(() => html("```mermaid\ngraph TD; A" + lone + "\n```")).not.toThrow();
  });

  it("이미지·위키링크 대상에 있어도 던지지 않는다", () => {
    expect(() => html(`![x](a${lone}.png) ![[b${lone}.png]] [[c${lone}]] [d](e${lone}.md)`)).not.toThrow();
  });
});

describe("renderMarkdown: 정화", () => {
  it("javascript: 주소를 속성에 남기지 않는다", () => {
    for (const src of [
      "[x](javascript:alert(1))",
      '<a href="javascript:alert(1)">x</a>',
      '<a href=" JaVaScRiPt:alert(1)">x</a>',
      '<img src="javascript:alert(1)">',
    ]) {
      const out = dom(src);
      expect(urlAttrs(out).filter((v) => /javascript/i.test(v))).toEqual([]);
    }
    // 원시 HTML 의 a 는 남고 주소만 빠진다
    expect(dom('<a href="javascript:alert(1)">x</a>').querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("<script> 를 남기지 않는다", () => {
    const out = dom("앞\n\n<script>window.pwned = 1</script>\n\n<div><script>window.pwned = 2</script>안</div>\n\n뒤");
    expect(out.querySelector("script")).toBeNull();
    expect(out.innerHTML).not.toContain("pwned");
    expect(out.textContent).toContain("뒤");
  });

  it("on* 처리기 속성을 남기지 않는다", () => {
    const out = dom('<img src="x.png" onerror="alert(1)">\n\n<div onclick="alert(2)" onmouseover="alert(3)">글</div>\n\n<svg onload="alert(4)"></svg>');
    for (const el of out.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) expect(attr).not.toMatch(/^on/i);
    }
    expect(out.innerHTML).not.toMatch(/alert\(/);
    expect(out.querySelector("img")).not.toBeNull();
  });

  it("줄 안 렌더(표 칸)도 같은 정화를 지난다", () => {
    const el = document.createElement("div");
    el.innerHTML = renderInlineMarkdown('<img src=x onerror="alert(1)"> [x](javascript:alert(2)) <script>alert(3)</script>', ctx);
    expect(el.querySelector("script")).toBeNull();
    expect(el.innerHTML).not.toMatch(/onerror|alert\(3\)/i);
    expect(urlAttrs(el).filter((v) => /javascript/i.test(v))).toEqual([]);
  });

  it("class 와 data-* 는 남긴다 — 원시 HTML 로 수식·다이어그램 자리를 만들 수 있다", () => {
    const slot = dom('<div class="mermaid-slot" data-src="%">x</div>').querySelector<HTMLElement>(".mermaid-slot");
    expect(slot?.dataset.src).toBe("%");
  });
});
