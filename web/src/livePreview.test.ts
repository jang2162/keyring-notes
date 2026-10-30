import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { bodyStart, frontmatterFold } from "./livePreview";

const NOTE = "---\nedited: 2026-10-30T09:12:33Z\n---\n";
const state = (doc: string, anchor = 0) => EditorState.create({ doc, selection: { anchor }, extensions: [frontmatterFold(() => undefined)] });
const type = (s: EditorState, text: string, userEvent = "input.type") =>
  s.update({
    changes: { from: s.selection.main.from, to: s.selection.main.to, insert: text },
    selection: { anchor: s.selection.main.from + text.length },
    userEvent,
  }).state;

describe("맨 앞 커서의 입력이 프런트매터를 깨지 않는다", () => {
  it("막 연 새 노트(커서 0)에 친 글은 프런트매터 뒤에 들어간다", () => {
    const s = type(state(NOTE), "본문");
    expect(s.doc.toString()).toBe(NOTE + "본문");
    expect(s.selection.main.head).toBe(NOTE.length + 2);
  });

  it("붙여 넣기도 같다", () => {
    expect(type(state(NOTE + "원래 본문"), "붙인 글\n", "input.paste").doc.toString()).toBe(NOTE + "붙인 글\n원래 본문");
  });

  it("닫는 줄이 문서 끝이면 줄을 바꾸고 넣는다", () => {
    expect(type(state("---\nedited: x\n---"), "글").doc.toString()).toBe("---\nedited: x\n---\n글");
  });

  it("커서가 본문에 있거나 프런트매터가 없으면 그 자리에 넣는다", () => {
    expect(type(state(NOTE + "ab", NOTE.length + 1), "X").doc.toString()).toBe(NOTE + "aXb");
    expect(type(state("본문"), "X").doc.toString()).toBe("X본문");
  });

  it("선택해서 바꾸거나 사용자 입력이 아닌 변경(불러오기·되돌리기 등)은 그대로", () => {
    const s = state(NOTE);
    expect(s.update({ changes: { from: 0, insert: "X" } }).state.doc.toString()).toBe("X" + NOTE);
    const selected = EditorState.create({ doc: NOTE, selection: { anchor: 0, head: 3 }, extensions: [frontmatterFold(() => undefined)] });
    expect(type(selected, "X").doc.toString()).toBe("X" + NOTE.slice(3));
  });

  it("본문 시작 자리", () => {
    expect(bodyStart(state(NOTE + "글"))).toEqual({ at: NOTE.length, prefix: "" });
    expect(bodyStart(state("---\na: 1\n---"))).toEqual({ at: 12, prefix: "\n" });
    expect(bodyStart(state("글"))).toBeNull();
  });
});
