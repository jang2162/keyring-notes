import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { blockFieldNeedsUpdate, liveBlockRanges, shouldDrawBlock } from "../liveBlocks";
import { endWidgetEdit, startWidgetEdit, widgetEditField } from "./blockEdit";

function state(doc: string, anchor = 0) {
  const s = EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), widgetEditField] });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}

const DOC = '앞\n\n```keyring-widget\n{"widget": "keyring/dday@1"}\n```\n\n뒤';
const FROM = DOC.indexOf("```keyring");
const TO = DOC.indexOf("```\n\n뒤") + 3;

describe("Live Preview 블록 찾기", () => {
  it("최상위 위젯 블록은 keyring-widget", () => {
    expect(liveBlockRanges(state(DOC)).filter((b) => b.kind === "keyring-widget")).toEqual([{ from: FROM, to: TO, kind: "keyring-widget" }]);
  });

  it("인용 안·닫히지 않은 블록은 아니고, mermaid 는 그대로", () => {
    for (const doc of ["> ```keyring-widget\n> {}\n> ```", "```keyring-widget\n{}\n", "- a\n  ```keyring-widget\n  {}\n  ```"]) {
      expect(
        liveBlockRanges(state(doc)).map((b) => b.kind),
        doc,
      ).not.toContain("keyring-widget");
    }
    expect(liveBlockRanges(state("```mermaid\ngraph TD\n```")).map((b) => b.kind)).toEqual(["mermaid"]);
  });
});

describe("그리기 판정", () => {
  it("shouldDrawBlock", () => {
    expect(shouldDrawBlock([3, 5], new Set([4]), false)).toBe(false);
    expect(shouldDrawBlock([3, 5], new Set([4]), true)).toBe(true);
    expect(shouldDrawBlock([3, 5], new Set([1]), false)).toBe(true);
    expect(shouldDrawBlock([3, 5], new Set([3]), false)).toBe(false);
    expect(shouldDrawBlock([3, 5], new Set([5]), false)).toBe(false);
  });
});

describe("blockFieldNeedsUpdate", () => {
  const upd = (s: EditorState, spec: TransactionSpec) => blockFieldNeedsUpdate(s.update(spec));

  it("수정 시작·끝 효과만 있어도 다시 계산한다", () => {
    const s = state(DOC);
    expect(upd(s, { effects: startWidgetEdit.of({ from: FROM, draft: {}, stateFrom: 1, entryKey: "k" }) })).toBe(true);
    const editing = s.update({ effects: startWidgetEdit.of({ from: FROM, draft: {}, stateFrom: 1, entryKey: "k" }) }).state;
    expect(upd(editing, { effects: endWidgetEdit.of(null) })).toBe(true);
  });

  it("빈 트랜잭션은 다시 계산하지 않는다(수정 중이어도)", () => {
    const s = state(DOC);
    expect(upd(s, {})).toBe(false);
    const editing = s.update({ effects: startWidgetEdit.of({ from: FROM, draft: {}, stateFrom: 1, entryKey: "k" }) }).state;
    expect(upd(editing, {})).toBe(false);
  });

  it("선택·문서가 바뀌면 다시 계산한다", () => {
    const s = state(DOC);
    expect(upd(s, { selection: { anchor: 1 } })).toBe(true);
    expect(upd(s, { changes: { from: 0, insert: "x" } })).toBe(true);
  });
});
