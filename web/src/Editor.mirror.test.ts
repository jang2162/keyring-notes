import { ChangeSet, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { canMirror, mirrored, mirrorTargets } from "./mirror";

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
