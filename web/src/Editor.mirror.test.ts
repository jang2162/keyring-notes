import { ChangeSet, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { canMirror, mirrored } from "./mirror";

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
});
