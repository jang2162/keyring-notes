// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeFolding, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { foldAllParsed, foldedLineNumbers, foldLevel, foldMemory, parseView, toggleLine, type FoldMemory } from "./editorFolds";
import { anchorsOf, getFolds, setFolds } from "./folds";

/** 앞 3,000 자(첫 파싱이 닿는 곳) 뒤까지 `##` 제목이 이어지는 문서 */
const SECTIONS = 200;
const DOC = "Intro\n\n" + Array.from({ length: SECTIONS }, (_, i) => `## Section ${i + 1}\n\nText of section ${i + 1}, long enough.\n`).join("\n");
const LINES = DOC.split("\n");
const HEADINGS = LINES.flatMap((l, i) => (l.startsWith("## ") ? [i + 1] : []));

let views: EditorView[] = [];
let n = 0;

/** 편집기처럼: 열 때 되살리고, 매 업데이트를 기억에 넘긴다 */
function open(key: string): { view: EditorView; folds: FoldMemory } {
  const folds = foldMemory(() => key);
  const view = new EditorView({
    doc: DOC,
    parent: document.body,
    extensions: [markdown({ base: markdownLanguage }), codeFolding(), EditorView.updateListener.of((u) => folds.update(u))],
  });
  views.push(view);
  return { view, folds };
}

/** 바쁜 기계 흉내: 그동안 Date.now 가 부를 때마다 25ms 씩 흘러 파싱 예산이 몇 걸음 만에 끝난다 */
function whileBusy<T>(fn: () => T): T {
  let t = Date.now();
  const now = vi.spyOn(Date, "now").mockImplementation(() => (t += 25));
  try {
    return fn();
  } finally {
    now.mockRestore();
  }
}

const storedLines = (key: string) => getFolds(key).map((a) => a.line);
const store = (key: string, lines: number[]) => setFolds(key, anchorsOf(LINES, lines));
const microtasks = () => new Promise<void>((r) => queueMicrotask(r));

afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
  vi.restoreAllMocks();
});

describe("저장된 접기 되살리기", () => {
  it("문서가 3,000 자보다 길다(시험의 전제)", () => {
    const { view } = open(`k${++n}.md`);
    expect(syntaxTree(view.state).length).toBeLessThan(view.state.doc.length);
    expect(view.state.doc.line(HEADINGS.at(-1)!).from).toBeGreaterThan(3000);
  });

  it("앞 3,000 자 뒤의 것까지 모두 되살리고 저장값이 줄지 않는다", () => {
    const key = `k${++n}.md`;
    store(key, HEADINGS);
    const { view, folds } = open(key);
    folds.restore(view);
    expect(foldedLineNumbers(view.state)).toEqual(HEADINGS);
    expect(storedLines(key)).toEqual(HEADINGS);
  });

  it("예산 안에 끝까지 파싱하지 못하면 앞쪽만 되살리고 저장값은 덮지 않는다 — 고쳐도·접혀 있어도", () => {
    const key = `k${++n}.md`;
    store(key, HEADINGS);
    const { view, folds } = open(key);
    whileBusy(() => folds.restore(view));
    const folded = foldedLineNumbers(view.state);
    expect(folded.length).toBeGreaterThan(0);
    expect(folded.length).toBeLessThan(HEADINGS.length);
    expect(storedLines(key)).toEqual(HEADINGS);

    // 접힌 곳이 있는 채 내용을 고치면 지금 접힌 것으로 저장한다 — 못 되살린 것도 함께
    view.dispatch({ changes: { from: 0, insert: "Hello " } });
    expect(storedLines(key)).toEqual(HEADINGS);
    // 줄이 밀리면 따라간다
    view.dispatch({ changes: { from: 0, insert: "New line\n" } });
    expect(storedLines(key)).toEqual(HEADINGS.map((l) => l + 1));
  });

  it("못 되살린 것은 파싱이 따라오면 되살린다", async () => {
    const key = `k${++n}.md`;
    store(key, HEADINGS);
    const { view, folds } = open(key);
    whileBusy(() => folds.restore(view));
    expect(foldedLineNumbers(view.state).length).toBeLessThan(HEADINGS.length);
    parseView(view, 5000);
    await microtasks();
    expect(foldedLineNumbers(view.state)).toEqual(HEADINGS);
    expect(storedLines(key)).toEqual(HEADINGS);
  });

  it("되살린 뒤 사용자가 접거나 편 것은 저장한다 — 못 되살린 것은 남긴 채", () => {
    const key = `k${++n}.md`;
    store(key, HEADINGS.slice(0, 3));
    const { view, folds } = open(key);
    folds.restore(view);
    toggleLine(view, HEADINGS.at(-1)!);
    expect(storedLines(key)).toEqual([...HEADINGS.slice(0, 3), HEADINGS.at(-1)]);

    const key2 = `k${++n}.md`;
    store(key2, HEADINGS);
    const b = open(key2);
    whileBusy(() => b.folds.restore(b.view));
    toggleLine(b.view, HEADINGS[0]);
    expect(storedLines(key2)).toEqual(HEADINGS.slice(1));
  });

  it("「모두 펴기」는 못 되살린 것까지 잊는다", () => {
    const key = `k${++n}.md`;
    store(key, HEADINGS);
    const { view, folds } = open(key);
    whileBusy(() => folds.restore(view));
    folds.unfoldAll(view);
    expect(foldedLineNumbers(view.state)).toEqual([]);
    expect(getFolds(key)).toEqual([]);
  });

  it("문서에 없는 줄은 되살리지 않되 저장값에서 지우지도 않는다", () => {
    const key = `k${++n}.md`;
    const anchors = [...anchorsOf(LINES, [HEADINGS[0], HEADINGS.at(-1)!]), { line: 5000, text: "## Gone" }];
    setFolds(key, anchors);
    const { view, folds } = open(key);
    folds.restore(view);
    expect(foldedLineNumbers(view.state)).toEqual([HEADINGS[0], HEADINGS.at(-1)]);
    expect(getFolds(key)).toEqual(anchors);
  });

  it("다른 쪽(개요·미리보기)이 저장값을 바꾸면 따라 접고 편다", () => {
    const key = `k${++n}.md`;
    store(key, HEADINGS.slice(0, 2));
    const { view, folds } = open(key);
    folds.restore(view);
    store(key, [HEADINGS[1], HEADINGS.at(-1)!]);
    folds.restore(view);
    expect(foldedLineNumbers(view.state)).toEqual([HEADINGS[1], HEADINGS.at(-1)]);
    expect(storedLines(key)).toEqual([HEADINGS[1], HEADINGS.at(-1)]);
  });
});

describe("열자마자 접기 명령이 뒤쪽 제목까지 본다", () => {
  it("모두 접기", () => {
    const key = `k${++n}.md`;
    const { view } = open(key);
    foldAllParsed(view);
    expect(foldedLineNumbers(view.state)).toEqual(HEADINGS);
    expect(storedLines(key)).toEqual(HEADINGS);
  });

  it("이 수준 제목만", () => {
    const key = `k${++n}.md`;
    const { view } = open(key);
    foldLevel(view);
    expect(foldedLineNumbers(view.state)).toEqual(HEADINGS);
  });

  it("한 줄 접기(개요)", () => {
    const key = `k${++n}.md`;
    const { view } = open(key);
    expect(toggleLine(view, HEADINGS.at(-1)!)).toBe(true);
    expect(storedLines(key)).toEqual([HEADINGS.at(-1)]);
  });
});
