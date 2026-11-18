// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { LinkResolver, renderMarkdown } from "./markdown";
import { applyPreviewFolds, togglePreviewFold } from "./previewFolds";

const ctx = { resolver: new LinkResolver([]), docPath: "w/doc.md" };
const LONG = "```js\n" + Array.from({ length: 8 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n```";
const SRC = `# Title\n\nintro\n\n${LONG}\n\n\`\`\`js\nshort\n\`\`\`\n\n# Next\n`;

let n = 0;
let path = "";
beforeEach(() => {
  localStorage.clear();
  path = `w/doc-${n++}.md`;
});

function draw(): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown-body";
  root.innerHTML = renderMarkdown(SRC, ctx).html;
  applyPreviewFolds(root, path, SRC);
  return root;
}

const longPre = (root: HTMLElement) => [...root.querySelectorAll("pre")].find((p) => p.textContent!.includes("v7"))!;

describe("미리보기 코드 블록 접기 단추", () => {
  it("단추는 pre(가로 스크롤 상자) 안이 아니라 감싸개 안에서 pre 의 형제로 달린다", () => {
    const root = draw();
    const pre = longPre(root);
    expect(pre.querySelector(".pv-fold")).toBeNull();
    const wrap = pre.parentElement!;
    expect(wrap.classList.contains("pv-code")).toBe(true);
    const btn = wrap.querySelector(":scope > .pv-fold")!;
    expect(btn).not.toBeNull();
    expect(btn.nextElementSibling).toBe(pre);
  });

  it("짧은 코드 블록은 감싸지도 단추를 달지도 않는다", () => {
    const root = draw();
    const short = [...root.querySelectorAll("pre")].find((p) => p.textContent!.includes("short"))!;
    expect(short.parentElement).toBe(root);
    expect(root.querySelectorAll(".pv-code").length).toBe(1);
  });

  it("다시 적용해도 감싸개·단추가 늘지 않는다", () => {
    const root = draw();
    applyPreviewFolds(root, path, SRC);
    expect(root.querySelectorAll(".pv-code").length).toBe(1);
    expect(root.querySelectorAll(".pv-code > .pv-fold").length).toBe(1);
    expect(root.querySelectorAll("pre .pv-fold").length).toBe(0);
  });

  it("누르면 감싸개가 접히고(▸·aria-expanded false) 다시 누르면 펴진다", () => {
    const root = draw();
    const wrap = longPre(root).parentElement!;
    const line = Number(wrap.querySelector<HTMLElement>(":scope > .pv-fold")!.dataset.foldLine);
    togglePreviewFold(path, SRC, line);
    applyPreviewFolds(root, path, SRC);
    const btn = wrap.querySelector(":scope > .pv-fold")!;
    expect(wrap.classList.contains("pv-folded")).toBe(true);
    expect(btn.textContent).toBe("▸");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    togglePreviewFold(path, SRC, line);
    applyPreviewFolds(root, path, SRC);
    expect(wrap.classList.contains("pv-folded")).toBe(false);
    expect(btn.textContent).toBe("▾");
  });

  it("제목을 접으면 감싼 코드 블록(감싸개)이 숨는다", () => {
    const root = draw();
    const h = root.querySelector<HTMLElement>("h1")!;
    togglePreviewFold(path, SRC, Number(h.dataset.line));
    applyPreviewFolds(root, path, SRC);
    expect(longPre(root).parentElement!.classList.contains("fold-hidden")).toBe(true);
  });
});
