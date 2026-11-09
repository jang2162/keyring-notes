import { describe, expect, it } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { disposeTable, editTableRaw, inDrawnTable, onDispose, tableEditor, tableRanges } from "./tableWidget";

const opts = { linkCandidates: () => [] };
function state(doc: string, anchor = 0, readOnly = false) {
  const s = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage }), tableEditor(() => null, opts), EditorState.readOnly.of(readOnly)],
  });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}

const DOC = "앞\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n뒤";
const FROM = DOC.indexOf("| a");
const TO = DOC.indexOf("\n\n뒤");

describe("tableRanges", () => {
  it("최상위 표 하나 → 표 줄 전체", () => {
    expect(tableRanges(state(DOC))).toEqual([{ from: FROM, to: TO }]);
  });

  it("커서가 표 안이어도 그린다", () => {
    expect(tableRanges(state(DOC, FROM + 2))).toEqual([{ from: FROM, to: TO }]);
  });

  it("인용·목록 안의 표는 그리지 않는다", () => {
    expect(tableRanges(state("> | a |\n> |---|"))).toEqual([]);
    expect(tableRanges(state("- x\n\n  | a |\n  |---|"))).toEqual([]);
  });

  it("프런트매터 안은 표로 보지 않는다", () => {
    // lezer 는 프런트매터를 모르므로 그 안에 빈 줄로 떨어진 표 꼴을 표로 읽는다
    const doc = "---\na: 1\n\n| k |\n|---|\n\nb: 2\n---\n\n| a |\n|---|";
    expect(tableRanges(state(doc))).toEqual([{ from: doc.lastIndexOf("| a |"), to: doc.length }]);
  });

  it("원문으로 편집을 고르면 그 표만 빠지고, 커서가 표 밖으로 나가면 다시 그린다", () => {
    const two = DOC + "\n\n| x |\n|---|";
    let s = state(two);
    expect(tableRanges(s)).toHaveLength(2);
    s = s.update({ effects: editTableRaw.of(FROM), selection: { anchor: FROM } }).state;
    expect(tableRanges(s).map((r) => r.from)).toEqual([two.indexOf("| x")]);
    // 표 안에서 움직이고 고쳐도 원문 그대로
    s = s.update({ selection: { anchor: FROM + 3 } }).state;
    s = s.update({ changes: { from: FROM + 2, insert: "Z" }, selection: { anchor: FROM + 3 } }).state;
    expect(tableRanges(s)).toHaveLength(1);
    // 표 앞에 글을 넣어도 원문 표시는 표를 따라간다
    s = s.update({ changes: { from: 0, insert: "앞앞" }, selection: { anchor: FROM + 5 } }).state;
    expect(tableRanges(s)).toHaveLength(1);
    s = s.update({ selection: { anchor: 0 } }).state;
    expect(tableRanges(s)).toHaveLength(2);
  });

  it("읽기 전용이어도 그린다", () => {
    expect(tableRanges(state(DOC, 0, true))).toEqual([{ from: FROM, to: TO }]);
  });

  it("문서 끝 줄바꿈 없는 표, 표 바로 앞의 --- 구분선", () => {
    const doc = "---\n\n| a |\n|---|";
    expect(tableRanges(state(doc))).toEqual([{ from: doc.indexOf("| a"), to: doc.length }]);
  });
});

describe("inDrawnTable: 본문 자동완성을 그린 표 안에서 끈다(칸에서 친 글이 본문 트랜잭션으로 들어오므로)", () => {
  it("그린 표 안이면 true, 밖이면 false", () => {
    const s = state(DOC);
    expect(inDrawnTable(s, FROM + 3)).toBe(true);
    expect(inDrawnTable(s, 0)).toBe(false);
  });
  it("원문으로 편집 중인 표와 표 편집기가 꺼진 상태(Live Preview 끔)는 false", () => {
    const raw = state(DOC).update({ effects: editTableRaw.of(FROM), selection: { anchor: FROM } }).state;
    expect(inDrawnTable(raw, FROM + 3)).toBe(false);
    const off = EditorState.create({ doc: DOC, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(off, DOC.length, 5000);
    expect(inDrawnTable(off, FROM + 3)).toBe(false);
  });
});

describe("Live Preview 를 껐다 켜기(Compartment 재구성)", () => {
  it("표 편집기를 다시 넣는 트랜잭션에서 던지지 않고 표를 그린다", () => {
    const slot = new Compartment();
    let s = EditorState.create({ doc: DOC, extensions: [markdown({ base: markdownLanguage }), slot.of([])] });
    ensureSyntaxTree(s, DOC.length, 5000);
    s = s.update({ effects: slot.reconfigure(tableEditor(() => null, opts)) }).state;
    expect(tableRanges(s)).toEqual([{ from: FROM, to: TO }]);
    s = s.update({ effects: slot.reconfigure([]) }).state;
    expect(inDrawnTable(s, FROM + 3)).toBe(false);
  });
});

describe("표 위젯이 사라질 때 정리(열린 메뉴·끌기 처리기)", () => {
  it("onDispose 로 건 것은 disposeTable 때 한 번씩 불리고, 푼 것은 불리지 않는다", () => {
    const wrap = {};
    const calls: string[] = [];
    onDispose(wrap, () => calls.push("menu"));
    const off = onDispose(wrap, () => calls.push("drag"));
    onDispose({}, () => calls.push("other"));
    off();
    disposeTable(wrap);
    disposeTable(wrap);
    expect(calls).toEqual(["menu"]);
  });

  it("표 위젯의 destroy 가 그 DOM 의 정리를 부른다", () => {
    const s = state(DOC);
    let widget: { destroy(dom: HTMLElement): void } | undefined;
    for (const d of s.facet(EditorView.decorations)) {
      if (typeof d === "function") continue;
      (d as DecorationSet).between(0, DOC.length, (_f, _t, v) => {
        widget ??= v.spec.widget;
      });
    }
    expect(widget).toBeDefined();
    const dom = {} as HTMLElement;
    let closed = 0;
    onDispose(dom, () => closed++);
    widget!.destroy(dom);
    expect(closed).toBe(1);
  });
});
