// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { parseFrontmatter } from "@keyring-notes/core";
import { docMeta } from "./DocPane";
import { frontmatterEnd } from "./liveSyntax";
import { LinkResolver, renderMarkdown, splitFrontmatter } from "./markdown";

/**
 * 화면이 프런트매터를 떼는 자리 셋(미리보기 splitFrontmatter, 속성 개수·아이콘 docMeta, Live Preview frontmatterEnd)은
 * core 의 parseFrontmatter 와 같은 줄에서 끊어야 한다. 갈리면 색인·속성 패널은 프런트매터로 보는 줄을 미리보기가 본문으로 그린다.
 */
const SHAPES: { name: string; doc: string }[] = [
  { name: "보통", doc: "---\ntitle: x\ntags: [a, b]\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "값이 ... 로 끝남", doc: "---\ntitle: 생각 중...\nrank: m\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "값이 --- 로 끝남", doc: "---\ntitle: 끝---\nrank: m\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "빈 프런트매터", doc: "---\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "빈 프런트매터 뒤 수평선", doc: "---\n---\n# 제목\n\n본문\n\n---\n\n- [ ] 할 일\n" },
  { name: "CRLF", doc: "---\r\ntitle: 생각 중...\r\nrank: m\r\n---\r\n# 제목\r\n\r\n- [ ] 할 일\r\n" },
  { name: "BOM", doc: "\uFEFF---\ntitle: x\nicon: 🍎\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "닫는 줄 없음", doc: "---\ntitle: 생각 중...\n# 제목\n\n- [ ] 할 일\n" },
  { name: "닫는 줄이 ...", doc: "---\ntitle: x\n...\n# 제목\n\n- [ ] 할 일\n" },
  { name: "닫는 줄 뒤 공백", doc: "---\ntitle: x\n--- \t\n# 제목\n\n- [ ] 할 일\n" },
  { name: "닫는 줄 뒤 빈 줄 여럿", doc: "---\ntitle: x\n---\n\n  \n\n# 제목\n\n- [ ] 할 일\n" },
  { name: "닫는 줄 뒤가 줄바꿈 없는 공백(그 줄은 닫는 줄이 아니다)", doc: "---\ntitle: x\n---\u00A0\n# 제목\n\n- [ ] 할 일\n" },
  { name: "여는 줄 뒤 공백(프런트매터가 아니다)", doc: "--- \ntitle: x\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "들여쓴 --- 줄", doc: "---\nnote: |\n  위\n  ---\n  아래\n---\n# 제목\n\n- [ ] 할 일\n" },
  { name: "프런트매터 없음", doc: "# 제목\n\n본문 ---\n\n- [ ] 할 일\n" },
  { name: "프런트매터뿐", doc: "---\ntitle: x\n---" },
];

const ctx = { resolver: new LinkResolver([]), docPath: "a.md" };

/** 글 앞에서 n 줄이 차지하는 글자 수 */
const lengthOfLines = (doc: string, n: number) => doc.split("\n").slice(0, n).join("\n").length + (n > 0 && doc.split("\n").length > n ? 1 : 0);

describe("화면의 프런트매터 판정은 core 와 같다", () => {
  for (const { name, doc } of SHAPES) {
    describe(name, () => {
      const fm = parseFrontmatter(doc);
      const lineOf = (text: string) => doc.replace(/\r/g, "").split("\n").indexOf(text) + 1;

      it("미리보기가 떼는 범위", () => {
        const split = splitFrontmatter(doc);
        expect(split.frontmatter !== null).toBe(fm.lines > 0);
        const removed = doc.length - split.body.length;
        expect(doc.endsWith(split.body)).toBe(true);
        // 프런트매터 줄까지는 반드시 떼고, 더 뗀 것은 그 뒤의 빈 줄뿐이다
        const block = lengthOfLines(doc, fm.lines);
        expect(removed).toBeGreaterThanOrEqual(block);
        expect(doc.slice(block, removed).trim()).toBe("");
        if (fm.lines === 0) expect(removed).toBe(0);
      });

      it("미리보기의 줄 번호는 원문의 줄이다", () => {
        const el = document.createElement("div");
        el.innerHTML = renderMarkdown(doc, { ...ctx, hideFrontmatter: true }).html;
        if (lineOf("# 제목")) expect(el.querySelector("h1")?.getAttribute("data-line")).toBe(String(lineOf("# 제목")));
        if (lineOf("- [ ] 할 일")) expect(el.querySelector("input.task")?.getAttribute("data-task-line")).toBe(String(lineOf("- [ ] 할 일")));
        // 프런트매터의 글이 본문으로 새지 않는다
        if (fm.lines > 0) expect(el.textContent).not.toMatch(/title|rank|note:/);
      });

      it("문서 위에 속성 보기", () => {
        const el = document.createElement("div");
        el.innerHTML = renderMarkdown(doc, ctx).html;
        const pre = el.querySelector("pre.frontmatter");
        expect(pre !== null).toBe(fm.lines > 0);
        if (pre) expect(parseFrontmatter(`---\n${pre.textContent}\n---\n`).data).toEqual(fm.data);
      });

      it("속성 개수·아이콘", () => {
        expect(docMeta(doc).fm).toEqual(fm.data);
      });

      it("Live Preview 가 접는 줄", () => {
        expect(frontmatterEnd(EditorState.create({ doc }))).toBe(fm.lines || null);
      });
    });
  }

  it("예: 빈 프런트매터 뒤의 수평선까지 삼키지 않는다", () => {
    const doc = "---\n---\n# 제목\n\n본문\n\n---\n\n뒤\n";
    expect(splitFrontmatter(doc)).toEqual({ frontmatter: "", body: "# 제목\n\n본문\n\n---\n\n뒤\n" });
    const el = document.createElement("div");
    el.innerHTML = renderMarkdown(doc, { ...ctx, hideFrontmatter: true }).html;
    expect(el.querySelector("h1")?.textContent).toBe("제목");
    expect(el.querySelectorAll("hr")).toHaveLength(1);
    expect(docMeta(doc)).toEqual({ fm: {}, propCount: 0, icon: null });
  });

  it("예: BOM 이 붙은 문서의 프런트매터도 뗀다", () => {
    const doc = "\uFEFF---\ntitle: x\nicon: 🍎\n---\n본문\n";
    expect(splitFrontmatter(doc)).toEqual({ frontmatter: "title: x\nicon: 🍎", body: "본문\n" });
    expect(docMeta(doc)).toEqual({ fm: { title: "x", icon: "🍎" }, propCount: 2, icon: "🍎" });
  });

  it("예: 닫는 줄 뒤의 빈 줄은 본문에서 빼고, 본문 첫 줄의 들여쓰기는 남긴다", () => {
    expect(splitFrontmatter("---\na: 1\n---\n\n \n    코드\n").body).toBe("    코드\n");
    expect(splitFrontmatter("---\na: 1\n---\n  \n").body).toBe("");
    expect(splitFrontmatter("---\na: 1\n---\n  ").body).toBe("");
  });
});
