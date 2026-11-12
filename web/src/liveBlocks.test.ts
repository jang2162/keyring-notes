import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { liveBlockRanges } from "./liveBlocks";
import { widgetEditField } from "./widgets/blockEdit";

function state(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), widgetEditField] });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}

/** 블록을 [종류, 첫 줄, 끝 줄] 로 */
function blocks(doc: string) {
  const s = state(doc);
  return liveBlockRanges(s).map((b) => [b.kind, s.doc.lineAt(b.from).number, s.doc.lineAt(b.to).number]);
}

const MIXED = [
  "# 제목", // 1
  "",
  "```js", // 3
  "$$ 코드 안",
  "```",
  "",
  "$$", // 7
  "x",
  "$$",
  "",
  "$$ a $$", // 11
  "",
  "%%", // 13
  "숨김",
  "%%",
  "",
  "![[그림.png]]", // 17
  "",
  "![[문서]]", // 19
  "",
  "> [!note] 제목", // 21
  "> $$ 인용 안",
  "",
  "```mermaid", // 24
  "graph TD",
  "```",
  "",
  "<div>", // 28
  "$$",
  "</div>",
  "",
  "- 목록", // 32
  "  ```py",
  "  %% 안",
  "  ```",
  "",
  "![](a.png)", // 37
].join("\n");

describe("findBlocks", () => {
  it("코드·HTML·인용 안의 $$·%%·임베드는 블록으로 치지 않고, 밖의 것은 친다", () => {
    expect(blocks(MIXED)).toEqual([
      ["math", 7, 9],
      ["math", 11, 11],
      ["comment", 13, 15],
      ["image", 17, 17],
      ["embed", 19, 19],
      ["callout", 21, 22],
      ["mermaid", 24, 26],
      ["html", 28, 30],
      ["image", 37, 37],
    ]);
  });

  it("코드 블록이 이어 붙고 그 뒤에 수식이 와도 같은 결과", () => {
    const doc = "```\na\n```\n```\n$$\n```\n$$\nx\n$$\n";
    expect(blocks(doc)).toEqual([["math", 7, 9]]);
  });

  it("줄마다 블록 목록을 다시 훑지 않는다(줄 × 블록이 아니다)", () => {
    const doc = Array.from({ length: 400 }, (_, i) => `글 ${i}\n\n\`\`\`js\nconst v${i} = 1;\n\`\`\`\n`).join("\n");
    const s = state(doc);
    const some = vi.spyOn(Array.prototype, "some");
    try {
      liveBlockRanges(s);
      // 고치기 전에는 줄마다 code.some 을 불렀다(이 문서는 2,800 줄)
      expect(some.mock.calls.length).toBeLessThan(50);
    } finally {
      some.mockRestore();
    }
  });
});
