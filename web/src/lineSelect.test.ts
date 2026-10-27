import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { lineSpan, shiftBase, spanSelection, type Span } from "./lineSelect";

// 줄: 1 "# Title"(0-7) 2 "alpha line"(8-18) 3 ""(19) 4 "beta line"(20-29) 5 "gamma"(30-35) 6 "last"(36-40, 줄바꿈 없음)
const state = EditorState.create({ doc: "# Title\nalpha line\n\nbeta line\ngamma\nlast" });
const line = (n: number): Span => lineSpan(state.doc.line(n));
const picked = (sel: EditorSelection) => {
  const { anchor, head, from, to } = sel.main;
  return { anchor, head, text: state.sliceDoc(from, to) };
};

describe("줄 번호로 줄 고르기", () => {
  it("한 줄: 맨 앞~맨 끝, 줄바꿈은 넣지 않는다", () => {
    expect(picked(spanSelection(line(2), line(2)))).toEqual({ anchor: 8, head: 18, text: "alpha line" });
  });

  it("빈 줄: 그 줄 맨 앞에 커서만 둔다", () => {
    expect(picked(spanSelection(line(3), line(3)))).toEqual({ anchor: 19, head: 19, text: "" });
  });

  it("마지막 줄(뒤에 줄바꿈 없음)", () => {
    expect(picked(spanSelection(line(6), line(6)))).toEqual({ anchor: 36, head: 40, text: "last" });
  });

  it("아래로 끌기: 첫 줄 맨 앞~마지막 줄 맨 끝, 사이 줄바꿈만 든다", () => {
    expect(picked(spanSelection(line(2), line(4)))).toEqual({ anchor: 8, head: 29, text: "alpha line\n\nbeta line" });
  });

  it("위로 끌기: 범위는 같고 방향만 반대", () => {
    expect(picked(spanSelection(line(4), line(2)))).toEqual({ anchor: 29, head: 8, text: "alpha line\n\nbeta line" });
  });

  it("접힌 블록: lineBlockAt 이 준 블록(접힌 내용 포함) 전체, 끝의 줄바꿈은 빼고", () => {
    // "# A\na1\n# B\nb1" 에서 "# A" 를 접으면 화면 한 줄이 된다 — 브라우저에서 잰 lineBlockAt 값 { from: 0, to: 6 }
    const doc = EditorState.create({ doc: "# A\na1\n# B\nb1" });
    const folded = lineSpan({ from: 0, to: 6 });
    const sel = spanSelection(folded, folded).main;
    expect(doc.sliceDoc(sel.from, sel.to)).toBe("# A\na1");
    // 접힌 블록에서 아래 줄까지 끌어도 끝 줄의 줄바꿈은 없다
    const down = spanSelection(folded, lineSpan(doc.doc.line(3))).main;
    expect(doc.sliceDoc(down.from, down.to)).toBe("# A\na1\n# B");
  });
});

describe("Shift+누르기", () => {
  it("본문 커서에서 아래 줄을 누르면 그 줄 맨 끝까지", () => {
    const base = shiftBase(EditorSelection.single(10), undefined);
    expect(picked(spanSelection(base, line(4)))).toEqual({ anchor: 10, head: 29, text: "pha line\n\nbeta line" });
  });

  it("본문 커서에서 위 줄을 누르면 그 줄 맨 앞까지", () => {
    const base = shiftBase(EditorSelection.single(25), undefined);
    expect(picked(spanSelection(base, line(2)))).toEqual({ anchor: 25, head: 8, text: "alpha line\n\nbeta " });
  });

  it("줄 번호로 고른 그대로면 처음 누른 줄 전체를 기준으로 넓힌다(위로 넓혀도 그 줄이 빠지지 않는다)", () => {
    const sel = spanSelection(line(5), line(5));
    const base = shiftBase(sel, { base: line(5), sel });
    expect(picked(spanSelection(base, line(2)))).toEqual({ anchor: 35, head: 8, text: "alpha line\n\nbeta line\ngamma" });
    expect(picked(spanSelection(base, line(6)))).toEqual({ anchor: 30, head: 40, text: "gamma\nlast" });
  });

  it("기준점이 든 줄을 누르면 기준점은 그대로 두고 그 줄 맨 끝까지", () => {
    const base = shiftBase(EditorSelection.single(10), undefined);
    expect(picked(spanSelection(base, line(2)))).toEqual({ anchor: 10, head: 18, text: "pha line" });
    // 기준점이 줄 맨 앞이어도 같은 규칙(줄 전체가 골라진다)
    expect(picked(spanSelection(shiftBase(EditorSelection.single(8), undefined), line(2)))).toEqual({ anchor: 8, head: 18, text: "alpha line" });
  });

  it("그 뒤 선택이 바뀌었으면 지금 선택의 기준점 한 점이 기준이다", () => {
    const sel = spanSelection(line(5), line(5));
    expect(shiftBase(EditorSelection.single(12, 14), { base: line(5), sel })).toEqual({ from: 12, to: 12 });
  });
});
