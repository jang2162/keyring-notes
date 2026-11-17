// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { history, historyKeymap, undo } from "@codemirror/commands";
import { replaceAll, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { findBar, replaceOne } from "./findBar";
import { matchStats } from "./findQuery";
import { frontmatterFold, frontmatterOpen, showRaw } from "./livePreview";

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

describe("접힌 프런트매터와 찾기 막대의 바꾸기(뷰)", () => {
  const FM = "---\ntag: fox\n---\n";
  function finder(doc: string, anchor: number, head = anchor): EditorView {
    const view = new EditorView({ doc, selection: { anchor, head }, parent: document.body, extensions: [findBar(), frontmatterFold(() => undefined)] });
    views.push(view);
    return view;
  }
  const query = (view: EditorView, spec: ConstructorParameters<typeof SearchQuery>[0]) => view.dispatch({ effects: setSearchQuery.of(new SearchQuery(spec)) });

  it("모두 바꾸기는 여는·닫는 줄에 닿는 일치(---\\n·^·$·^---$)를 바꾸지 않고, 찾기가 센 일치만 바꾼다", () => {
    const BODY = "# T\nfox\n---\nend";
    const cases: [ConstructorParameters<typeof SearchQuery>[0], string, number][] = [
      [{ search: "---\\n", replace: "" }, "# T\nfox\nend", 1],
      [{ search: "^", replace: "> ", regexp: true }, "> # T\n> fox\n> ---\n> end", 0],
      [{ search: "$", replace: ";", regexp: true }, "# T;\nfox;\n---;\nend;", 0],
      [{ search: "^---$", replace: "***", regexp: true }, "# T\nfox\n***\nend", 1],
    ];
    for (const [spec, body, counted] of cases) {
      const view = finder(FM + BODY, FM.length + 1);
      query(view, spec);
      expect(matchStats(view.state, new SearchQuery(spec)).total).toBe(counted);
      replaceAll(view);
      expect(view.state.doc.toString()).toBe(FM + body);
      expect(view.dom.querySelector(".cm-fm-fold")).not.toBeNull();
    }
  });

  it("펼쳐 있으면 모두 바꾸기가 프런트매터도 바꾼다", () => {
    const view = finder(FM + "fox", FM.length + 1);
    view.dispatch({ selection: { anchor: 3 }, effects: showRaw.of(null) });
    query(view, { search: "fox", replace: "cat" });
    replaceAll(view);
    expect(view.state.doc.toString()).toBe("---\ntag: cat\n---\ncat");
  });

  it("하나 바꾸기는 프런트매터 안 다음 일치를 건너뛰고 보이는 다음 일치를 고른다. 남은 일치가 그 안뿐이면 고르지 않는다", () => {
    const doc = FM + "fox a\nfox b";
    const first = doc.indexOf("fox", FM.length);
    const second = doc.lastIndexOf("fox");
    const view = finder(doc, second, second + 3);
    query(view, { search: "fox", replace: "cat" });
    replaceOne(view);
    expect(view.state.doc.toString()).toBe(FM + "fox a\ncat b");
    expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([first, first + 3]);
    replaceOne(view);
    expect(view.state.doc.toString()).toBe(FM + "cat a\ncat b");
    expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([FM.length, FM.length]);
    expect(view.dom.querySelector(".cm-fm-fold")).not.toBeNull();
  });
});
