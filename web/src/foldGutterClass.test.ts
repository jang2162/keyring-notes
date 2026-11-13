import { describe, expect, it } from "vitest";
import { EditorState, type RangeSet } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { gutterLineClass, type GutterMarker } from "@codemirror/view";
import { headingGutterClass, headingGutterLines, updateHeadings } from "./foldGutterClass";
import { topChunks } from "./treeChunks";
import { FUZZ_TIMEOUT, randomEdit, randomLines, rng } from "./editFuzz.testkit";

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

/** 증분 갱신 전 구현 그대로 — 최상위 노드를 다 훑는 기준 */
function reference(state: EditorState): string {
  const out: string[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      const m = /^ATXHeading(\d)$/.exec(n.name);
      if (m && m[1] !== "4") out.push(`${n.from}:cm-fold-h${m[1]}`);
      return false;
    },
  });
  return out.join(" ");
}

function marks(set: RangeSet<GutterMarker>): string {
  const out: string[] = [];
  for (let it = set.iter(); it.value; it.next()) out.push(`${it.from}:${it.value.elementClass}`);
  return out.join(" ");
}

describe("제목 거터 증분 갱신", () => {
  const exts = [markdown({ base: markdownLanguage }), history()];

  it("무작위 편집 — 증분 결과가 전체 재계산·기준 구현과 같다", { timeout: FUZZ_TIMEOUT }, () => {
    let edits = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const big = seed % 20 === 0;
      let s = EditorState.create({ doc: randomLines(r, big ? 1500 : 10 + (seed % 70), big && seed % 40 === 0), extensions: exts });
      let v = { set: headingGutterLines(s), doc: s.doc, chunks: topChunks(syntaxTree(s)) };
      for (let step = 0; step < 40; step++) {
        if (r() < 0.15) ensureSyntaxTree(s, Math.floor(r() * (s.doc.length + 1)), 50);
        const tr = r() < 0.05 ? s.update({}) : randomEdit(r, s);
        if (!tr) continue;
        s = tr.state;
        v = updateHeadings(v, s, tr.changes);
        const got = marks(v.set);
        if (got !== marks(headingGutterLines(s)) || got !== reference(s)) expect(got, `seed ${seed} step ${step}`).toBe(reference(s));
        edits++;
      }
    }
    expect(edits).toBeGreaterThan(7000);
  });

  it("필드가 내놓는 거터 클래스가 기준 구현과 같다", () => {
    const r = rng(9);
    let s = EditorState.create({ doc: randomLines(r, 200), extensions: [exts, headingGutterClass] });
    const shown = (st: EditorState) =>
      st
        .facet(gutterLineClass)
        .map((x) => marks(x as RangeSet<GutterMarker>))
        .join(" ");
    for (let step = 0; step < 100; step++) {
      const tr = randomEdit(r, s);
      if (!tr) continue;
      s = tr.state;
      expect(shown(s), `step ${step}`).toBe(reference(s));
    }
  });
});
