import { ChangeSet, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { canMirror, diffChange, mirrored, mirrorSpec, mirrorTargets, outgoingChanges } from "./mirror";

describe("두 칸 사이 변경 전달", () => {
  it("canMirror: 문서 길이가 같을 때만 true", () => {
    const c = ChangeSet.of({ from: 0, insert: "x" }, 5);
    expect(canMirror(5, c)).toBe(true);
    expect(canMirror(6, c)).toBe(false);
  });

  it("전달받은 변경은 표식이 붙고 그 칸의 되돌리기 기록에 남지 않는다", () => {
    const a = EditorState.create({ doc: "hello" });
    const changes = a.update({ changes: { from: 5, insert: " world" } }).changes;
    const b = EditorState.create({ doc: "hello" });
    const tr = b.update({ changes, annotations: [mirrored.of(true), Transaction.addToHistory.of(false)] });
    expect(tr.state.doc.toString()).toBe("hello world");
    expect(tr.annotation(mirrored)).toBe(true);
    expect(b.update({ changes }).annotation(mirrored)).toBeUndefined();
  });

  describe("outgoingChanges: 이 뷰에서 밖(초안·다른 칸)으로 내보낼 변경", () => {
    const key = "x.md#3";
    const typed = (s: EditorState, insert: string) => s.update({ changes: { from: s.doc.length, insert }, userEvent: "input.type" });

    it("이 칸에서 친 변경만, 트랜잭션 순서대로", () => {
      const a = typed(EditorState.create({ doc: "hello" }), "1");
      const b = typed(a.state, "2");
      const sel = a.state.update({ selection: { anchor: 0 } });
      expect(outgoingChanges([a, sel, b], key, key)).toEqual([a.changes, b.changes]);
    });

    it("다른 칸에서 받은 변경(applyChanges 가 만드는 트랜잭션)은 내보내지 않는다 — 길이가 맞아 그대로 넣든 fallback 으로 맞추든", () => {
      const other = EditorState.create({ doc: "hello" }).update({ changes: { from: 5, insert: " world" } });
      const same = EditorState.create({ doc: "hello" });
      const tr = same.update(mirrorSpec(same, other.changes, "hello world")!);
      expect(tr.state.doc.toString()).toBe("hello world");
      expect(tr.annotation(Transaction.addToHistory)).toBe(false);
      expect(outgoingChanges([tr], key, key)).toEqual([]);

      const drifted = EditorState.create({ doc: "hell" });
      const tr2 = drifted.update(mirrorSpec(drifted, other.changes, "hello world")!);
      expect(tr2.state.doc.toString()).toBe("hello world");
      expect(outgoingChanges([tr2], key, key)).toEqual([]);
      expect(mirrorSpec(tr.state, other.changes, "hello world")).toBeNull();
    });

    it("낡은 뷰(만든 docKey ≠ 지금 docKey)의 변경은 전부 막는다", () => {
      const tr = typed(EditorState.create({ doc: "hello" }), "!");
      expect(outgoingChanges([tr], "x.md#3", "x.md#4")).toEqual([]);
      expect(outgoingChanges([tr], "x.md#3", "y.md#1")).toEqual([]);
      expect(outgoingChanges([tr], "x.md#3", "x.md#3")).toEqual([tr.changes]);
    });

    it("diffChange: 앞뒤 같은 부분을 뺀 한 구간, 같으면 null", () => {
      expect(diffChange("hello", "hello")).toBeNull();
      expect(diffChange("hello world", "hello there world")).toEqual({ from: 6, to: 6, insert: "there " });
      expect(diffChange("abc", "axc")).toEqual({ from: 1, to: 2, insert: "x" });
    });
  });

  describe("mirrorTargets: 변경을 넣어도 되는 다른 칸", () => {
    const panes = (a: string | null, b: string | null) => [{ active: a }, { active: b }];

    it("같은 문서를 같은 판으로 연 다른 칸에만", () => {
      expect(mirrorTargets(0, "x.md", "x.md#3", panes("x.md", "x.md"), ["x.md#3", "x.md#3"])).toEqual([1]);
    });

    it("보낸 칸 자신은 빼고, 다른 문서를 보는 칸도 뺀다", () => {
      expect(mirrorTargets(1, "x.md", "x.md#3", panes("x.md", "x.md"), ["x.md#3", "x.md#3"])).toEqual([0]);
      expect(mirrorTargets(0, "x.md", "x.md#3", panes("x.md", "y.md"), ["x.md#3", "y.md#1"])).toEqual([]);
    });

    it("배치는 이미 그 문서인데 에디터는 아직 다른 문서(다시 그리기 전)면 뺀다", () => {
      expect(mirrorTargets(0, "x.md", "x.md#3", panes("x.md", "x.md"), ["x.md#3", "y.md#1"])).toEqual([]);
    });

    it("같은 문서라도 에디터가 다른 판(다시 읽기 뒤 새로 만들기 전)이거나 아직 없으면 뺀다", () => {
      expect(mirrorTargets(0, "x.md", "x.md#4", panes("x.md", "x.md"), ["x.md#4", "x.md#3"])).toEqual([]);
      expect(mirrorTargets(0, "x.md", "x.md#3", panes("x.md", "x.md"), ["x.md#3", null])).toEqual([]);
    });
  });
});
