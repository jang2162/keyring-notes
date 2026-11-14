import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { liveBlockRanges } from "./liveBlocks";
import { tableRanges, tableEditor } from "./tableWidget";
import { widgetEditField } from "./widgets/blockEdit";
import { parsed } from "./parsedState.testkit";

/** 바쁜 기계 흉내: 상태를 만드는 동안 Date.now 가 부를 때마다 25ms 씩 흘러, 20ms 예산의 첫 파싱이 한 걸음만 간다 */
function createWhileBusy(config: Parameters<typeof EditorState.create>[0]) {
  let t = Date.now();
  const now = vi.spyOn(Date, "now").mockImplementation(() => (t += 25));
  try {
    return EditorState.create(config);
  } finally {
    now.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("parsed — 끝까지 파싱한 상태", () => {
  it("ensureSyntaxTree 만으로는 syntaxTree 가 그대로다(앞 3,000 자) — parsed 는 문서 끝까지", () => {
    const doc = "글\n\n".repeat(2000);
    const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
    expect(ensureSyntaxTree(s, doc.length, 5000)?.length).toBe(doc.length);
    expect(syntaxTree(s).length).toBeLessThan(doc.length);
    expect(syntaxTree(parsed(s)).length).toBe(doc.length);
  });

  it("첫 파싱이 시간 예산에 걸려도 작은 문서의 위젯 블록·표를 찾는다", () => {
    const doc = '앞\n\n| a |\n|---|\n\n```keyring-widget\n{"widget": "keyring/dday@1"}\n```\n\n뒤';
    const extensions = [markdown({ base: markdownLanguage }), widgetEditField, tableEditor(() => null, { linkCandidates: () => [] })];
    const busy = createWhileBusy({ doc, extensions });
    ensureSyntaxTree(busy, doc.length, 5000);
    // 이 상태 그대로 읽으면 못 찾는다
    expect(liveBlockRanges(busy)).toEqual([]);
    const s = parsed(createWhileBusy({ doc, extensions }));
    expect(liveBlockRanges(s).map((b) => b.kind)).toEqual(["keyring-widget"]);
    expect(tableRanges(s)).toHaveLength(1);
  });
});
