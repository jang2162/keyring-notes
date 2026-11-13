import { describe, expect, it, vi } from "vitest";
import { ChangeSet, EditorState, type Extension } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { liveBlockRanges, liveBlocks, liveBlockScan, shouldDrawBlock, updateLiveBlockScan, type BlockScan, type LiveRenderContext } from "./liveBlocks";
import { CALLOUT_LINE } from "./liveSyntax";
import { isCommentBlock } from "./liveImage";
import { widgetBlockOfNode, widgetEditField } from "./widgets/blockEdit";
import { FUZZ_TIMEOUT, randomEdit, randomLines, rng } from "./editFuzz.testkit";

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

/** 증분 갱신 전의 findBlocks 그대로 — 문서 전체를 다 훑는 기준 구현. 증분 결과는 이것과 모든 경우에 같아야 한다 */
function referenceBlocks(state: EditorState): { from: number; to: number; kind: string }[] {
  const out: { from: number; to: number; kind: string }[] = [];
  const doc = state.doc;
  const code: [number, number][] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "FencedCode") {
        code.push([n.from, n.to]);
        const info = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(doc.lineAt(n.from).text)?.[2];
        if (info === "mermaid") out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "mermaid" });
        else if (widgetBlockOfNode(state, n.node)) out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "keyring-widget" });
        return false;
      }
      if (n.name === "HTMLBlock") {
        code.push([n.from, n.to]);
        if (!isCommentBlock(doc.sliceString(n.from, n.to))) out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, kind: "html" });
        return false;
      }
      if (n.name === "CodeBlock") {
        code.push([n.from, n.to]);
        return false;
      }
      if (n.name === "Blockquote") {
        const first = doc.lineAt(n.from);
        if (CALLOUT_LINE.test(first.text)) out.push({ from: first.from, to: doc.lineAt(n.to).to, kind: "callout" });
        return false;
      }
      return undefined;
    },
  });
  const tree = out.slice();
  const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos <= b);
  const taken = (pos: number) => tree.some((b) => pos >= b.from && pos <= b.to);
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (inCode(line.from) || taken(line.from)) continue;
    const t = line.text.trim();
    if (t.startsWith("$$")) {
      if (t.length > 4 && t.endsWith("$$")) {
        out.push({ from: line.from, to: line.to, kind: "math" });
        continue;
      }
      for (let j = i + 1; j <= doc.lines && j < i + 200; j++) {
        if (doc.line(j).text.includes("$$")) {
          out.push({ from: line.from, to: doc.line(j).to, kind: "math" });
          i = j;
          break;
        }
      }
      continue;
    }
    if (t.startsWith("%%") && !(t.length > 2 && t.slice(2).includes("%%"))) {
      for (let j = i + 1; j <= doc.lines && j < i + 500; j++) {
        if (doc.line(j).text.trimEnd().endsWith("%%")) {
          out.push({ from: line.from, to: doc.line(j).to, kind: "comment" });
          i = j;
          break;
        }
      }
      continue;
    }
    if (/^!\[\[[^\]\n]+\]\]$/.test(t) || /^!\[[^\]\n]*\]\([^)\n]+\)$/.test(t)) {
      const target = /^!\[\[([^\]|#\n]*)/.exec(t)?.[1]?.trim();
      out.push({ from: line.from, to: line.to, kind: target === undefined || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(target) ? "image" : "embed" });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

const fuzzExtensions: Extension = [markdown({ base: markdownLanguage }), widgetEditField, history()];

/** 증분 결과가 전체 재계산·기준 구현과 같은가. 다르면 씨앗·단계와 함께 던진다 */
function sameScan(scan: BlockScan, state: EditorState, where: string) {
  // 옮겨 가는 중간 결과까지 같아야 다음 갱신도 맞다(doc·chunks 는 상태에서 그대로 얻는 것이라 뺀다)
  const pick = (x: BlockScan) => ({ tree: x.tree, lines: x.lines, blocks: x.blocks, frontmatter: x.frontmatter });
  const full = pick(liveBlockScan(state));
  const got = pick(scan);
  if (JSON.stringify(got) !== JSON.stringify(full)) expect(got, where).toEqual(full);
  expect(scan.doc).toBe(state.doc);
  if (JSON.stringify(scan.blocks) !== JSON.stringify(referenceBlocks(state))) expect(scan.blocks, where).toEqual(referenceBlocks(state));
}

/** 편집을 steps 번 이어 하며 매번 맞대 본다. 돌린 편집 수를 돌려준다 */
function fuzzScan(seed: number, lines: number, steps: number, sparse: boolean): number {
  const r = rng(seed);
  let s = EditorState.create({ doc: randomLines(r, lines, sparse), extensions: fuzzExtensions });
  let scan = liveBlockScan(s);
  sameScan(scan, s, `seed ${seed} start`);
  let n = 0;
  for (let step = 0; step < steps; step++) {
    // 가끔 파싱을 더 시킨다 — 다음 트랜잭션에서 트리가 바뀐 곳 밖까지 자란다(빈 트랜잭션이면 트리만 바뀐다)
    if (r() < 0.15) ensureSyntaxTree(s, Math.floor(r() * (s.doc.length + 1)), 50);
    const tr = r() < 0.05 ? s.update({}) : randomEdit(r, s, sparse);
    if (!tr) continue;
    s = tr.state;
    scan = updateLiveBlockScan(scan, s, tr.changes);
    sameScan(scan, s, `seed ${seed} step ${step}`);
    n++;
  }
  return n;
}

describe("블록 찾기 증분 갱신", () => {
  it("무작위 편집(작은 문서) — 증분 결과가 전체 재계산·기준 구현과 같다", { timeout: FUZZ_TIMEOUT }, () => {
    let edits = 0;
    for (let seed = 1; seed <= 300; seed++) edits += fuzzScan(seed, 10 + (seed % 70), 40, false);
    expect(edits).toBeGreaterThan(10_000);
  });

  it("무작위 편집(큰 문서, $$·%% 짝이 멀다, 처음 트리가 덜 파싱됨) — 같다", { timeout: FUZZ_TIMEOUT }, () => {
    let edits = 0;
    for (let seed = 1001; seed <= 1012; seed++) edits += fuzzScan(seed, 1500 + (seed % 7) * 200, 40, seed % 2 === 0);
    expect(edits).toBeGreaterThan(400);
  });

  it("주석 %% 짝이 수백 줄 떨어진 채 여는 줄 바로 뒤·닫는 줄 바로 앞을 고쳐도 같다", () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `글 ${i}`);
    const doc = ["앞", "%%", ...body(480), "끝 %%", ...body(30), "$$", ...body(190), "$$", "뒤"].join("\n");
    let s = EditorState.create({ doc, extensions: fuzzExtensions });
    ensureSyntaxTree(s, s.doc.length, 5000);
    let scan = liveBlockScan(s);
    // 닫는 줄을 깨고, 되돌리고, 여는 줄을 지우고, 수식 닫는 줄 뒤에 줄을 넣는다
    const edits = [
      (st: EditorState) => ({ from: st.doc.line(483).to - 2, to: st.doc.line(483).to }),
      (st: EditorState) => ({ from: st.doc.line(483).to, insert: "%%" }),
      (st: EditorState) => ({ from: st.doc.line(2).from, to: st.doc.line(2).to + 1 }),
      (st: EditorState) => ({ from: st.doc.line(2).from, insert: "%%\n" }),
      (st: EditorState) => ({ from: st.doc.line(300).from, insert: "%%\n" }),
      (st: EditorState) => ({ from: st.doc.line(st.doc.lines - 1).from, insert: "x\n".repeat(20) }),
    ];
    for (const [i, e] of edits.entries()) {
      const tr = s.update({ changes: e(s) });
      s = tr.state;
      scan = updateLiveBlockScan(scan, s, tr.changes);
      sameScan(scan, s, `edit ${i}`);
    }
    expect(scan.blocks.map((b) => b.kind)).toContain("comment");
  });

  it("문서는 그대로이고 트리만 더 파싱돼도(배경 파싱) 같다", () => {
    const r = rng(77);
    const doc = randomLines(r, 3000);
    const partial = EditorState.create({ doc, extensions: fuzzExtensions });
    // 처음 상태는 앞 3,000 자만 파싱한다. 파싱을 더 시킨 뒤의 빈 트랜잭션이 편집기의 배경 파싱 트랜잭션과 같다
    ensureSyntaxTree(partial, doc.length, 5000);
    const tr = partial.update({});
    const fuller = tr.state;
    expect(tr.docChanged).toBe(false);
    expect(syntaxTree(fuller).length).toBeGreaterThan(syntaxTree(partial).length * 2);
    sameScan(updateLiveBlockScan(liveBlockScan(partial), fuller, tr.changes), fuller, "fuller");
    sameScan(updateLiveBlockScan(liveBlockScan(fuller), partial, ChangeSet.empty(doc.length)), partial, "partial");
  });

  it("문서 끝까지 다시 훑지 않는다 — 큰 문서 가운데 한 글자에 줄 루프가 보는 줄이 LOOKAHEAD 근처", () => {
    const doc = Array.from({ length: 5000 }, (_, i) => (i % 50 === 0 ? "$$ a $$" : `글 ${i}`)).join("\n");
    let s = EditorState.create({ doc, extensions: fuzzExtensions });
    ensureSyntaxTree(s, s.doc.length, 5000);
    const scan = liveBlockScan(s);
    const tr = s.update({ changes: { from: s.doc.line(2500).from, insert: "x" } });
    s = tr.state;
    const line = vi.spyOn(s.doc, "line");
    try {
      const next = updateLiveBlockScan(scan, s, tr.changes);
      expect(line.mock.calls.length).toBeLessThan(700);
      sameScan(next, s, "middle");
    } finally {
      line.mockRestore();
    }
  });
});

/** 선택(커서)이 걸친 줄 번호 — liveBlocks.ts 의 activeLines 와 같은 뜻 */
function activeLineSet(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) out.add(n);
  return out;
}

describe("블록 장식 필드", () => {
  const ctx = { resolver: { resolve: () => null }, docPath: "" } as unknown as LiveRenderContext;

  /** 필드가 내놓은 장식의 범위 */
  function drawn(state: EditorState): string {
    const out: string[] = [];
    for (const v of state.facet(EditorView.decorations)) {
      if (typeof v === "function") continue;
      for (let it = (v as DecorationSet).iter(); it.value; it.next()) out.push(`${it.from}-${it.to}`);
    }
    return out.join(" ");
  }

  /** 기준 구현의 블록 중 커서가 걸치지 않은 것 */
  function expected(state: EditorState): string {
    const active = activeLineSet(state);
    return referenceBlocks(state)
      .filter((b) => shouldDrawBlock([state.doc.lineAt(b.from).number, state.doc.lineAt(b.to).number], active, false))
      .map((b) => `${b.from}-${b.to}`)
      .join(" ");
  }

  it("무작위 편집·커서 이동 — 그리는 블록이 기준 구현과 같다(커서가 들어간 블록은 원문)", { timeout: FUZZ_TIMEOUT }, () => {
    let checks = 0;
    for (let seed = 501; seed <= 560; seed++) {
      const r = rng(seed);
      let s = EditorState.create({ doc: randomLines(r, 40 + (seed % 60)), extensions: [fuzzExtensions, liveBlocks(() => ctx)] });
      for (let step = 0; step < 40; step++) {
        const tr =
          r() < 0.4
            ? s.update({ selection: { anchor: Math.floor(r() * (s.doc.length + 1)), head: r() < 0.3 ? Math.floor(r() * (s.doc.length + 1)) : undefined } })
            : randomEdit(r, s);
        if (!tr) continue;
        s = tr.state;
        const got = drawn(s);
        if (got !== expected(s)) expect(got, `seed ${seed} step ${step}`).toBe(expected(s));
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(2000);
  });

  it("그릴 맥락이 없다가 생기면 처음부터 찾는다", () => {
    let on = false;
    const doc = "글\n\n```mermaid\ngraph TD\n```\n\n끝";
    let s = EditorState.create({ doc, extensions: [fuzzExtensions, liveBlocks(() => (on ? ctx : null))] });
    expect(drawn(s)).toBe("");
    s = s.update({ changes: { from: 0, insert: "x" } }).state;
    expect(drawn(s)).toBe("");
    on = true;
    s = s.update({ selection: { anchor: s.doc.length } }).state;
    expect(drawn(s)).toBe(expected(s));
    expect(drawn(s)).not.toBe("");
  });
});
