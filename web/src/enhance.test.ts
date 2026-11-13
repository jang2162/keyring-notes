// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { enhance } from "./enhance";
import { LinkResolver, renderMarkdown } from "./markdown";

// 수식·다이어그램 렌더러(큰 번들)는 받은 원문을 그대로 돌려주는 것으로 바꾼다 — 여기서 보는 것은 원문이 어떻게 풀려 넘어가는가다
vi.mock("./render/katex", () => ({ renderTex: (tex: string) => `<span class="katex-stub">${tex.replace(/</g, "&lt;")}</span>` }));
const mermaidSources: string[] = [];
vi.mock("./render/mermaid", () => ({
  renderMermaid: (src: string) => {
    mermaidSources.push(src);
    return Promise.resolve("<svg></svg>");
  },
}));

const resolver = new LinkResolver([]);
const ctx = { resolver, docPath: "w/doc.md" };

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

/** 미리보기와 같은 길: 그린 HTML 을 넣고 채운다 */
function drawn(src: string): HTMLElement {
  const el = root(renderMarkdown(src, ctx).html);
  enhance(el, ctx);
  return el;
}

describe("enhance: 깨진 퍼센트 인코딩", () => {
  // 수식은 KaTeX 를 불러온 뒤에는 그 자리에서 바로 채운다 — 던지는 것은 그 길이다
  beforeAll(async () => {
    enhance(root('<span class="math" data-tex="x"></span>'), ctx);
    await vi.dynamicImportSettled();
  });

  it("data-tex 가 깨져 있어도 던지지 않고 받은 글 그대로 그린다", () => {
    const el = root('<span class="math" data-tex="%">원문</span><span class="math math-display" data-tex="caf%E9"></span>');
    expect(() => enhance(el, ctx)).not.toThrow();
    expect([...el.querySelectorAll(".katex-stub")].map((n) => n.textContent)).toEqual(["%", "caf%E9"]);
  });

  it("data-src 가 깨져 있어도 던지지 않고 받은 글 그대로 그린다", async () => {
    const el = root('<div class="mermaid-slot" data-src="%E9%"><pre><code>x</code></pre></div>');
    expect(() => enhance(el, ctx)).not.toThrow();
    await vi.dynamicImportSettled();
    expect(mermaidSources).toContain("%E9%");
  });

  it("원시 HTML 로 만든 자리(정화를 지난 것)도 던지지 않는다", () => {
    expect(() => drawn('<div class="mermaid-slot" data-src="%">x</div>\n\n<span class="math" data-tex="%E9">y</span>')).not.toThrow();
  });
});

describe("enhance: 원문이 속성을 오가도 그대로다", () => {
  beforeAll(async () => {
    enhance(root('<span class="math" data-tex="x"></span>'), ctx);
    await vi.dynamicImportSettled();
  });

  it("수식 원문의 % 와 한글", () => {
    expect(drawn("$100\\% 카페$").querySelector(".katex-stub")?.textContent).toBe("100\\% 카페");
  });

  it("다이어그램 원문의 % 와 -->", async () => {
    drawn("```mermaid\ngraph TD; A-->B %% 50%\n```");
    await vi.dynamicImportSettled();
    expect(mermaidSources).toContain("graph TD; A-->B %% 50%\n");
  });

  it("짝 없는 서로게이트는 U+FFFD 로 바뀌어 넘어간다", () => {
    expect(drawn("$a\uD83Db$").querySelector(".katex-stub")?.textContent).toBe("a�b");
  });
});
