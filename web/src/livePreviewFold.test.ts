// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { history, historyKeymap, undo } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import { frontmatterFold, frontmatterOpen } from "./livePreview";

/** 편집기에 붙은 접기: 「원문 보기」 단추와 되돌리기 뒤의 선택 밀기(뷰가 있어야 도는 것) */
const NOTE = "---\nedited: 2026-10-30T09:12:33Z\n---\n";
const DOC = NOTE + "첫 줄\n둘째 줄";
const AT = NOTE.length;

let views: EditorView[] = [];
afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
});

function open(anchor = AT + 2): EditorView {
  const view = new EditorView({
    doc: DOC,
    selection: { anchor },
    parent: document.body,
    extensions: [history(), keymap.of(historyKeymap), frontmatterFold(() => undefined)],
  });
  views.push(view);
  return view;
}

const press = (view: EditorView, selector: string) =>
  view.dom.querySelector(selector)!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));

describe("접힌 프런트매터(뷰)", () => {
  it("「원문 보기」를 누르면 펼치고, 「속성 N개」는 오른쪽 패널을 연다(펼치지 않는다)", () => {
    let props = 0;
    const view = new EditorView({ doc: DOC, selection: { anchor: AT + 2 }, parent: document.body, extensions: [frontmatterFold(() => props++)] });
    views.push(view);
    expect(view.dom.querySelector(".cm-fm-fold")).not.toBeNull();
    press(view, ".cm-fm-props");
    expect(props).toBe(1);
    expect(frontmatterOpen(view.state)).toBe(false);
    press(view, ".cm-fm-raw");
    expect(frontmatterOpen(view.state)).toBe(true);
    expect(view.dom.querySelector(".cm-fm-fold")).toBeNull();
    expect(view.state.selection.main.head).toBe(3);
  });

  it("접힌 원문을 고친 것을 되돌려도 접힌 채이고, 되살린 선택은 곧 본문 시작으로 밀린다", async () => {
    const view = open();
    press(view, ".cm-fm-raw");
    view.dispatch({ selection: { anchor: 10 } });
    view.dispatch({ changes: { from: 10, insert: "Z" }, selection: { anchor: 11 }, userEvent: "input.type" });
    view.dispatch({ selection: { anchor: AT + 5 }, userEvent: "select.pointer" });
    expect(frontmatterOpen(view.state)).toBe(false);
    undo(view);
    expect(view.state.doc.toString()).toBe(DOC);
    expect(frontmatterOpen(view.state)).toBe(false);
    await Promise.resolve();
    expect(view.state.selection.main.from).toBe(AT);
    expect(view.dom.querySelector(".cm-fm-fold")).not.toBeNull();
  });
});
