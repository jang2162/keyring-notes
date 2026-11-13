// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paintBlock, type LiveRenderContext } from "./liveBlocks";
import { LinkResolver } from "./markdown";
import { paintCell } from "./tableWidget";

// 수식·다이어그램 렌더러(큰 번들)는 싣지 않는다
vi.mock("./render/katex", () => ({ renderTex: (tex: string) => tex }));
vi.mock("./render/mermaid", () => ({ renderMermaid: () => Promise.resolve("<svg></svg>") }));

const ok: LiveRenderContext = {
  resolver: new LinkResolver([{ name: "w", path: "w", type: "dir", children: [{ name: "page.md", path: "w/page.md", type: "file" }] }]),
  docPath: "w/doc.md",
};
/** 링크를 찾다 던지는 리졸버 — 렌더러가 그리는 중에 던지는 상황을 만든다 */
const boom = () => {
  throw new Error("렌더러가 던짐");
};
const broken = { resolver: { exact: boom, resolve: boom, paths: [], daily: null } as unknown as LinkResolver, docPath: "w/doc.md" } satisfies LiveRenderContext;

let logged: { mock: { calls: unknown[][] }; mockRestore(): void };
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

const CALLOUT = "> [!note] 제목\n> 안의 링크 [카페](page.md#caf%E9)";

describe("Live Preview 블록(paintBlock)", () => {
  it("깨진 앵커가 든 콜아웃을 그린다", () => {
    const el = document.createElement("div");
    paintBlock(el, CALLOUT, ok, () => true);
    const a = el.querySelector<HTMLElement>(".callout a.mdlink")!;
    expect(a.dataset.wikilink).toBe("w/page.md");
    expect(a.dataset.heading).toBe("caf%e9");
    expect(el.classList.contains("cm-lp-failed")).toBe(false);
    expect(logged.mock.calls).toEqual([]);
  });

  it("렌더러가 던지면 던지지 않고 원문 글자로 떨어진다", () => {
    const el = document.createElement("div");
    expect(() => paintBlock(el, CALLOUT, broken, () => true)).not.toThrow();
    expect(el.textContent).toBe(CALLOUT);
    expect(el.children).toHaveLength(0);
    expect(el.classList.contains("cm-lp-failed")).toBe(true);
    expect(logged.mock.calls).toHaveLength(1);
  });

  it("원문 글자는 HTML 로 풀리지 않는다", () => {
    const el = document.createElement("div");
    const src = '<img src=x onerror="alert(1)"> [x](a.md)';
    paintBlock(el, src, broken, () => true);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe(src);
  });
});

describe("Live Preview 표 칸(paintCell)", () => {
  it("깨진 앵커가 든 칸을 그린다", () => {
    const td = document.createElement("td");
    paintCell(td, " [카페](page.md#caf%E9) ", ok);
    expect(td.querySelector<HTMLElement>("a.mdlink")?.dataset.heading).toBe("caf%e9");
    expect(td.dataset.raw).toBe(" [카페](page.md#caf%E9) ");
  });

  it("렌더러가 던지면 던지지 않고 그 칸만 원문 글자로 떨어진다", () => {
    const td = document.createElement("td");
    expect(() => paintCell(td, " [x](a.md) ", broken)).not.toThrow();
    expect(td.textContent).toBe(" [x](a.md) ");
    expect(td.children).toHaveLength(0);
    // 같은 원문이면 다시 그리지 않게 하는 표시는 그대로 남긴다(실패한 칸을 입력마다 되풀이해 그리지 않는다)
    expect(td.dataset.raw).toBe(" [x](a.md) ");
    expect(logged.mock.calls).toHaveLength(1);
  });
});
