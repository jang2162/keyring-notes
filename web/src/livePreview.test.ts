import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { cursorDocStart, defaultKeymap, history, moveLineUp, redo, selectDocStart, undo } from "@codemirror/commands";
import { SearchQuery } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { matchStats, nextMatch } from "./findQuery";
import { bodyStart, frontmatterFold, frontmatterOpen, selectBody, selectionOutside, showRaw } from "./livePreview";

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

  it("맨 앞과 다른 자리를 함께 바꾸는 입력은 그대로 둔다(다른 변경을 잃지 않는다)", () => {
    const s = state(NOTE + "본문");
    const next = s.update({
      changes: [
        { from: 0, insert: "X" },
        { from: s.doc.length, insert: "Y" },
      ],
      userEvent: "input.type",
    }).state;
    expect(next.doc.toString()).toBe("X" + NOTE + "본문Y");
  });

  it("본문 시작 자리", () => {
    expect(bodyStart(state(NOTE + "글"))).toEqual({ at: NOTE.length, prefix: "" });
    expect(bodyStart(state("---\na: 1\n---"))).toEqual({ at: 12, prefix: "\n" });
    expect(bodyStart(state("글"))).toBeNull();
  });
});

describe("전체 선택은 본문만 잡는다", () => {
  const selectAll = (s: EditorState) => {
    let next: EditorState | null = null;
    const ran = selectBody({ state: s, dispatch: (tr) => (next = tr.state) });
    return { ran, sel: next ? [(next as EditorState).selection.main.from, (next as EditorState).selection.main.to] : null };
  };

  it("막 연 노트·본문의 커서에서 프런트매터 뒤부터 끝까지 고른다", () => {
    const doc = NOTE + "본문\n둘째 줄";
    expect(selectAll(state(doc))).toEqual({ ran: true, sel: [NOTE.length, doc.length] });
    expect(selectAll(state(doc, NOTE.length + 1))).toEqual({ ran: true, sel: [NOTE.length, doc.length] });
  });

  it("본문이 없으면 선택을 옮기지 않는다(프런트매터를 펼치지 않는다)", () => {
    expect(selectAll(state("---\na: 1\n---"))).toEqual({ ran: true, sel: null });
  });

  it("프런트매터가 없거나 원문으로 펼쳐 있으면 기본 전체 선택에 맡긴다", () => {
    expect(selectAll(state("본문")).ran).toBe(false);
    expect(selectAll(state(NOTE + "본문", 5)).ran).toBe(false);
    expect(selectAll(state(NOTE + "본문").update({ selection: { anchor: 3 }, effects: showRaw.of(null) }).state).ran).toBe(false);
  });

  it("frontmatterFold 의 Mod-a 가 기본 키맵(selectAll)보다 먼저 걸린다", () => {
    const s = EditorState.create({ doc: NOTE, extensions: [keymap.of(defaultKeymap), frontmatterFold(() => undefined)] });
    const first = s
      .facet(keymap)
      .flat()
      .find((b) => b.key === "Mod-a");
    expect(first?.run).toBe(selectBody);
  });
});

describe("프런트매터 원문은 「원문 보기」를 눌렀을 때만 펼친다", () => {
  const DOC = NOTE + "첫 줄\n둘째 줄";
  const AT = NOTE.length; // 본문 시작
  const TO = NOTE.length - 1; // 닫는 줄 끝
  const ext = [frontmatterFold(() => undefined), history()];
  const make = (anchor = AT + 2, head = anchor, doc = DOC) => EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: ext });
  /** 접은 줄 장식이 있는가(펼쳐 있으면 장식이 없다) */
  const folded = (s: EditorState) => s.facet(EditorView.decorations).some((d) => typeof d !== "function" && d.size > 0);
  const sel = (s: EditorState) => s.selection.ranges.map((r) => [r.anchor, r.head]);
  /** userEvent 가 null 이면 앱의 이동(줄 번호로 가기 등) */
  const select = (s: EditorState, anchor: number, head = anchor, userEvent: string | null = "select.pointer") =>
    s.update({ selection: EditorSelection.single(anchor, head), userEvent: userEvent ?? undefined }).state;
  const run = (cmd: StateCommand, s: EditorState) => {
    let next = s;
    cmd({ state: s, dispatch: (tr) => (next = tr.state) });
    return next;
  };
  const openRaw = (s: EditorState) => s.update({ selection: { anchor: 3 }, effects: showRaw.of(null) }).state;

  it("본문에서 위로 끌어 맨 위를 넘겨도 접혀 있고 선택은 본문 시작에서 멈춘다(복사에 --- 가 없다)", () => {
    const s = select(make(), AT + 5, 0);
    expect(sel(s)).toEqual([[AT + 5, AT]]);
    expect(folded(s) && !frontmatterOpen(s)).toBe(true);
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).not.toContain("---");
    // 끄는 도중 프런트매터 안 위치들
    for (const head of [TO, 10, 3, 1]) expect(sel(select(make(), AT + 5, head))).toEqual([[AT + 5, AT]]);
  });

  it("Shift+↑·본문 첫 줄의 ↑·Mod+Home·Shift+Mod+Home 도 본문 시작에서 멈춘다", () => {
    expect(sel(select(make(), AT + 2, 5, "select"))).toEqual([[AT + 2, AT]]); // Shift+↑
    expect(sel(select(make(), 5, 5, "select"))).toEqual([[AT, AT]]); // ↑
    const home = run(cursorDocStart, make());
    expect(sel(home)).toEqual([[AT, AT]]);
    const shiftHome = run(selectDocStart, make(AT + 4));
    expect(sel(shiftHome)).toEqual([[AT + 4, AT]]);
    expect([home, shiftHome].every(folded)).toBe(true);
  });

  it("「원문 보기」 효과로 펼치고, 펼친 채 안을 고치는 동안은 열려 있고, 본문으로 나가면 접힌다", () => {
    const open = openRaw(make());
    expect(frontmatterOpen(open)).toBe(true);
    expect(folded(open)).toBe(false);
    const edited = type(open.update({ selection: { anchor: 10 } }).state, "Z");
    expect(edited.doc.toString()).toBe(DOC.slice(0, 10) + "Z" + DOC.slice(10));
    expect(frontmatterOpen(edited)).toBe(true);
    // 펼친 채 맨 앞 커서·위로 끌기는 원문 위의 선택이다(밀지 않는다). 맨 앞에 친 글은 그 자리에 들어간다
    const start = select(edited, 0, 0, "select");
    expect(sel(start)).toEqual([[0, 0]]);
    expect(frontmatterOpen(start)).toBe(true);
    expect(type(start, "X").doc.toString().startsWith("X---")).toBe(true);
    expect(sel(select(edited, AT + 6, 2))).toEqual([[AT + 6, 2]]);
    // 본문에 걸친 선택은 아직 프런트매터에 걸쳐 있다
    expect(frontmatterOpen(select(edited, 5, AT + 3))).toBe(true);
    const out = select(edited, AT + 4);
    expect(frontmatterOpen(out)).toBe(false);
    expect(folded(out)).toBe(true);
  });

  it("줄 번호로 가기처럼 앱이 프런트매터 안에 둔 선택도 펼치지 않고 본문 시작으로 민다. 다 들어간 범위는 뺀다", () => {
    const goto = select(make(), 5, 10, null);
    expect(sel(goto)).toEqual([[AT, AT]]);
    expect(folded(goto)).toBe(true);
    // 여러 범위(Mod+D·모두 고르기): 안에 든 범위만 빠진다
    const multi = make().update({
      selection: EditorSelection.create([EditorSelection.range(4, 10), EditorSelection.range(AT + 1, AT + 3)], 0),
      userEvent: "select.search",
    }).state;
    expect(sel(multi)).toEqual([[AT + 1, AT + 3]]);
    // 막 연 문서의 커서·1행으로 가기(맨 앞 빈 커서)는 그대로다
    expect(sel(select(make(), 0, 0, null))).toEqual([[0, 0]]);
    expect(folded(make(0))).toBe(true);
  });

  it("본문이 없으면 밀 곳이 맨 앞 커서다", () => {
    const s = select(make(0, 0, "---\na: 1\n---"), 12, 12, "select");
    expect(sel(s)).toEqual([[0, 0]]);
    expect(folded(s)).toBe(true);
  });

  it("되돌리기·다시 하기는 접힌 원문을 고쳐도 접힌 채로 둔다. 필터를 건너뛴 그 선택은 selectionOutside 가 본문 시작으로 민다", () => {
    const edited = type(openRaw(make()).update({ selection: { anchor: 10 } }).state, "Z");
    const out = select(edited, AT + 4);
    expect(frontmatterOpen(out)).toBe(false);
    const undone = run(undo, out);
    expect(undone.doc.toString()).toBe(DOC);
    expect(frontmatterOpen(undone)).toBe(false);
    expect(folded(undone)).toBe(true);
    expect(sel(undone.update({ selection: selectionOutside(undone)! }).state)).toEqual([[AT, AT]]);
    const redone = run(redo, undone.update({ selection: selectionOutside(undone)! }).state);
    expect(redone.doc.toString()).toContain("Z");
    expect(folded(redone)).toBe(true);
    // 본문만 고친 것을 되돌리면 밀 것이 없다
    expect(selectionOutside(run(undo, type(make(AT + 2), "Y")))).toBeNull();
  });

  it("찾기는 접힌 프런트매터 안의 일치를 세지도 고르지도 않는다. 펼치면 센다", () => {
    const doc = "---\ntag: fox\n---\nfox 와 fox";
    const at = doc.indexOf("fox", 15);
    const s = make(at + 3, at + 3, doc);
    const q = new SearchQuery({ search: "fox" });
    expect(matchStats(s, q).total).toBe(2);
    // 끝에서 처음으로 돌 때 프런트매터 안이 아니라 본문 첫 일치로
    expect(nextMatch(make(doc.length, doc.length, doc), q)).toEqual({ from: at, to: at + 3 });
    expect(matchStats(openRaw(s), q).total).toBe(3);
  });

  it("접혀 있는 동안의 바꾸기는 프런트매터 안을 고치지 않는다", () => {
    const doc = "---\ntag: fox\n---\nfox";
    const s = make(doc.length, doc.length, doc);
    const changes = [
      { from: 9, to: 12, insert: "cat" },
      { from: 17, to: 20, insert: "cat" },
    ];
    expect(s.update({ changes, userEvent: "input.replace.all" }).state.doc.toString()).toBe("---\ntag: fox\n---\ncat");
    expect(openRaw(s).update({ changes, userEvent: "input.replace.all" }).state.doc.toString()).toBe("---\ntag: cat\n---\ncat");
  });

  it("사용자의 편집이 경계를 고쳐 선택이 안에 들면 밀지 않고 원문을 보인다(Alt+↑·막 친 ---)", () => {
    const moved = run(moveLineUp, make(AT + 1));
    expect(moved.doc.toString()).toBe("---\nedited: 2026-10-30T09:12:33Z\n첫 줄\n---\n둘째 줄");
    expect(frontmatterOpen(moved)).toBe(true);
    // 프런트매터를 새로 쓰는 중이면 닫는 --- 를 친 순간에도 커서 자리 그대로다
    const writing = EditorState.create({ doc: "---\na: 1\n", selection: { anchor: 9 }, extensions: ext });
    const closed = type(writing, "---");
    expect(sel(closed)).toEqual([[12, 12]]);
    expect(frontmatterOpen(closed)).toBe(true);
  });
});
