import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { headingGutterLines } from "./foldGutterClass";

const classes = (doc: string) => {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  const out: [number, string][] = [];
  const it = headingGutterLines(s).iter();
  for (; it.value; it.next()) out.push([s.doc.lineAt(it.from).number, it.value.elementClass]);
  return out;
};

describe("제목 줄의 거터 칸 클래스", () => {
  it("H1~H3·H5·H6 줄에 그 수준의 클래스를 단다(H4 는 본문 크기라 없다)", () => {
    expect(classes("# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f\n\n본문")).toEqual([
      [1, "cm-fold-h1"],
      [3, "cm-fold-h2"],
      [5, "cm-fold-h3"],
      [9, "cm-fold-h5"],
      [11, "cm-fold-h6"],
    ]);
  });

  it("최상위 제목만 본다 — 목록·인용 안 제목에는 달지 않는다", () => {
    expect(classes("- # 목록 안\n\n> ## 인용 안\n\n### 밖")).toEqual([[5, "cm-fold-h3"]]);
  });

  it("코드 블록 안의 # 줄은 제목이 아니다", () => {
    expect(classes("```\n# 주석\n```\n## 진짜")).toEqual([[4, "cm-fold-h2"]]);
  });
});
