import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { mirrored, outgoingChanges } from "../mirror";
import {
  endWidgetEdit,
  nextWidgetBody,
  rewriteWidgetBlock,
  setWidgetDraft,
  setWidgetFocus,
  startWidgetEdit,
  widgetBlockAt,
  widgetBlockAtLine,
  widgetBlocks,
  widgetEditField,
  widgetGoneNow,
  widgetResume,
} from "./blockEdit";

function state(doc: string, opts: { anchor?: number; readOnly?: boolean } = {}) {
  const s = EditorState.create({
    doc,
    selection: { anchor: opts.anchor ?? 0 },
    extensions: [markdown({ base: markdownLanguage }), history(), widgetEditField, EditorState.readOnly.of(opts.readOnly ?? false)],
  });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}

function apply(s: EditorState, spec: TransactionSpec) {
  const tr = s.update(spec);
  ensureSyntaxTree(tr.state, tr.state.doc.length, 5000);
  return tr;
}

/** 다른 칸·동기화에서 들어온 변경 */
const external = (spec: TransactionSpec): TransactionSpec => ({ ...spec, annotations: [mirrored.of(true), Transaction.addToHistory.of(false)] });

const BODY = '{"widget": "a/b@1"}';
const DOC = "앞\n\n```keyring-widget\n" + BODY + "\n```\n\n뒤";
const FROM = DOC.indexOf("```keyring");

/** 같은 시각에 친 것으로(history 의 묶음 간격 안) */
const at = (spec: TransactionSpec, time: number): TransactionSpec => ({
  ...spec,
  annotations: [...[spec.annotations ?? []].flat(), Transaction.time.of(time)],
});

function undoOnce(s: EditorState): EditorState {
  let next = s;
  undo({ state: s, dispatch: (tr) => (next = tr.state) });
  return next;
}

describe("위젯 블록 찾기", () => {
  it("최상위·닫힌 keyring-widget 펜스", () => {
    const s = state(DOC);
    const bs = widgetBlocks(s);
    expect(bs).toHaveLength(1);
    const close = DOC.indexOf("```\n\n뒤");
    expect(bs[0]).toEqual({
      from: FROM,
      to: close + 3,
      bodyFrom: FROM + "```keyring-widget\n".length,
      bodyTo: FROM + "```keyring-widget\n".length + BODY.length,
      body: BODY,
      line: 3,
    });
    expect(widgetBlocks(state(DOC.replace("keyring-widget", "keyring-widget x")))).toHaveLength(1);
  });

  it("인용·목록 안, 닫히지 않은 블록, 다른 언어는 아니다", () => {
    for (const doc of [
      "> ```keyring-widget\n> {}\n> ```",
      "- a\n  ```keyring-widget\n  {}\n  ```",
      "```keyring-widget\n{}\n",
      "```json\n{}\n```",
      "```keyring-widgets\n{}\n```",
    ]) {
      const s = state(doc);
      expect(widgetBlocks(s), doc).toEqual([]);
      // 그 자리만 보는 길도 같은 판정이어야 한다(필드·쓰기는 이 길을 쓴다)
      const fence = doc.indexOf("```");
      expect(widgetBlockAt(s, fence), doc).toBeNull();
    }
  });

  it("프런트매터 안은 아니다", () => {
    expect(widgetBlocks(state("---\n```keyring-widget\n{}\n```\n---\n"))).toEqual([]);
    expect(widgetBlocks(state("---\na: 1\n---\n\n```keyring-widget\n{}\n```"))).toHaveLength(1);
  });

  it("widgetBlockAtLine", () => {
    const s = state(DOC);
    expect(widgetBlockAtLine(s, 3)).toEqual(widgetBlocks(s)[0]);
    expect(widgetBlockAtLine(s, 4)).toBeNull();
    expect(widgetBlockAtLine(s, 99)).toBeNull();
  });

  it("widgetBlockAt 은 여는 펜스 줄에서만", () => {
    const s = state(DOC);
    expect(widgetBlockAt(s, FROM)).toEqual(widgetBlocks(s)[0]);
    expect(widgetBlockAt(s, FROM + 5)).toEqual(widgetBlocks(s)[0]);
    expect(widgetBlockAt(s, DOC.indexOf(BODY))).toBeNull();
    expect(widgetBlockAt(s, 0)).toBeNull();
  });

  it("들여쓴 최상위 펜스(1~3칸)", () => {
    for (const pad of [" ", "  ", "   "]) {
      const doc = `a\n\n${pad}\`\`\`keyring-widget\n${pad}{}\n${pad}\`\`\`\n`;
      let s = state(doc);
      const bs = widgetBlocks(s);
      expect(bs, JSON.stringify(pad)).toHaveLength(1);
      expect(bs[0]!.from).toBe(3);
      expect(widgetBlockAt(s, bs[0]!.from)).toEqual(bs[0]);
      s = apply(s, { effects: startWidgetEdit.of({ from: bs[0]!.from, draft: {} }) }).state;
      const specs = [
        () => ({ changes: { from: 0, insert: "x" } }),
        (c: EditorState) => ({ changes: { from: c.doc.length, insert: "끝" } }),
        () => ({ changes: { from: 0, to: 1 } }),
      ];
      for (const spec of specs) {
        s = apply(s, external(spec(s))).state;
        expect(s.field(widgetEditField)!.gone, JSON.stringify(pad)).toBe(false);
      }
    }
  });

  it("빈 본문 블록", () => {
    const s = state("```keyring-widget\n```");
    const b = widgetBlocks(s)[0]!;
    expect(b.body).toBe("");
    const spec = rewriteWidgetBlock(s, b, '{"widget": "a/b@1"}');
    expect(apply(s, spec!).state.doc.toString()).toBe('```keyring-widget\n{"widget": "a/b@1"}\n```');
  });

  it("그리기만으로 문서가 바뀌지 않는다", () => {
    const s = state(DOC);
    const before = s.doc;
    widgetBlocks(s);
    widgetBlockAt(s, FROM);
    widgetBlockAtLine(s, 3);
    expect(s.doc).toBe(before);
  });
});

describe("다시 쓰기", () => {
  it("nextWidgetBody", () => {
    expect(nextWidgetBody('{"widget":"a/b@1","x":1,"state":{"n":1}}', { n: 2 }, 1)).toBe('{"widget": "a/b@1", "state": {"n": 2}, "x": 1}');
    expect(nextWidgetBody('{"widget":"a/b@1","x":1,"state":{"n":1}}', { n: 2 }, 2)).toBe('{"widget": "a/b@2", "state": {"n": 2}, "x": 1}');
    expect(nextWidgetBody("{", { n: 2 }, 1)).toBeNull();
  });

  it("실행 취소 한 번에 위젯 변경만 되돌아간다", () => {
    let s = state(DOC);
    const t0 = Date.now();
    s = apply(s, { changes: { from: s.doc.length, insert: "z" }, userEvent: "input.type", annotations: Transaction.time.of(t0) }).state;
    const b = widgetBlocks(s)[0]!;
    const next = nextWidgetBody(b.body, { n: 1 }, 1)!;
    s = apply(s, at(rewriteWidgetBlock(s, b, next)!, t0)).state;
    expect(widgetBlocks(s)[0]!.body).toBe(next);
    s = undoOnce(s);
    expect(widgetBlocks(s)[0]!.body).toBe(BODY);
    expect(s.doc.toString().endsWith("뒤z")).toBe(true);
    s = undoOnce(s);
    expect(s.doc.toString()).toBe(DOC);
  });

  it("바로 옆 글과도 history 묶음에 섞이지 않는다", () => {
    let s = state(DOC);
    const t0 = Date.now();
    const b0 = widgetBlocks(s)[0]!;
    // 본문 끝 바로 뒤(같은 자리)에 공백 — JSON 으로는 그대로 유효하고, 바뀐 범위가 닿아 있어 묶일 수 있는 자리다
    s = apply(s, { changes: { from: b0.bodyTo, insert: " " }, userEvent: "input.type", annotations: Transaction.time.of(t0) }).state;
    const b = widgetBlocks(s)[0]!;
    const spec = rewriteWidgetBlock(s, b, nextWidgetBody(b.body, { n: 1 }, 1)!)!;
    s = apply(s, at(spec, t0)).state;
    s = undoOnce(s);
    expect(widgetBlocks(s)[0]!.body).toBe(BODY + " ");
    s = undoOnce(s);
    expect(s.doc.toString()).toBe(DOC);
  });

  it("적용 바로 뒤에 붙여 친 글이 위젯 변경에 묶이지 않는다", () => {
    let s = state(DOC);
    const t0 = Date.now();
    const b = widgetBlocks(s)[0]!;
    const next = nextWidgetBody(b.body, { n: 1 }, 1)!;
    s = apply(s, at(rewriteWidgetBlock(s, b, next)!, t0)).state;
    const end = widgetBlocks(s)[0]!.bodyTo;
    s = apply(s, { changes: { from: end, insert: " " }, userEvent: "input.type", annotations: Transaction.time.of(t0) }).state;
    s = undoOnce(s);
    expect(widgetBlocks(s)[0]!.body).toBe(next);
    s = undoOnce(s);
    expect(s.doc.toString()).toBe(DOC);
  });

  it("자동 저장·다른 칸 경로에 들어가고, 같으면·읽기 전용이면 null, 선택은 그대로", () => {
    const s = state(DOC, { anchor: 1 });
    const b = widgetBlocks(s)[0]!;
    const next = nextWidgetBody(b.body, { n: 1 }, 1)!;
    const tr = apply(s, rewriteWidgetBlock(s, b, next)!);
    expect(tr.isUserEvent("input.widget")).toBe(true);
    expect(outgoingChanges([tr], "k", "k")).toHaveLength(1);
    expect(tr.state.selection.main.anchor).toBe(1);
    expect(rewriteWidgetBlock(s, b, b.body)).toBeNull();
    const ro = state(DOC, { readOnly: true });
    expect(rewriteWidgetBlock(ro, widgetBlocks(ro)[0]!, next)).toBeNull();
  });
});

describe("수정 중 위치 따라가기", () => {
  function editing(doc = DOC, from = doc.indexOf("```keyring")) {
    const tr = apply(state(doc), { effects: startWidgetEdit.of({ from, draft: { n: 9 }, owner: "live" }) });
    return { tr, s: tr.state, from };
  }

  it("수정 시작은 문서를 바꾸지 않는다", () => {
    const { tr, s } = editing();
    expect(tr.docChanged).toBe(false);
    expect(outgoingChanges([tr], "k", "k")).toEqual([]);
    expect(s.field(widgetEditField)).toEqual({ from: FROM, draft: { n: 9 }, base: { n: 9 }, owner: "live", gone: false, focus: null });
  });

  it("초안·포커스·끝", () => {
    let { s } = editing();
    s = apply(s, { effects: setWidgetFocus.of(1) }).state;
    expect(s.field(widgetEditField)!.focus).toBe(1);
    s = apply(s, { effects: setWidgetDraft.of({ n: 10 }) }).state;
    // 시작 상태(base)·주인(owner)은 수정이 이어지는 동안 바뀌지 않는다 — 이어받는 위젯이 같은 기준으로 「바뀌었는가」를 본다
    expect(s.field(widgetEditField)).toEqual({ from: FROM, draft: { n: 10 }, base: { n: 9 }, owner: "live", gone: false, focus: 1 });
    s = apply(s, external({ changes: { from: 0, insert: "x" } })).state;
    expect(s.field(widgetEditField)).toMatchObject({ base: { n: 9 }, owner: "live" });
    s = apply(s, { effects: endWidgetEdit.of(null) }).state;
    expect(s.field(widgetEditField)).toBeNull();
  });

  it("앞에 넣은 글만큼 밀린다(그 자리 바로 앞 포함)", () => {
    let { s } = editing();
    s = apply(s, external({ changes: { from: 0, insert: "새 줄\n" } })).state;
    expect(s.field(widgetEditField)).toMatchObject({ from: FROM + 4, draft: { n: 9 }, gone: false });
    s = apply(s, external({ changes: { from: FROM + 4, insert: "새 줄\n" } })).state;
    expect(s.field(widgetEditField)).toMatchObject({ from: FROM + 8, gone: false });
  });

  it("문서 맨 앞 블록에서도", () => {
    const doc = "```keyring-widget\n{}\n```\n";
    let { s } = editing(doc, 0);
    s = apply(s, external({ changes: { from: 0, insert: "새 줄\n" } })).state;
    expect(s.field(widgetEditField)).toMatchObject({ from: 4, gone: false });
  });

  it("본문을 바꾸면 그대로, 블록을 지우면 gone 한 번", () => {
    let { s } = editing();
    const b = widgetBlocks(s)[0]!;
    s = apply(s, external({ changes: { from: b.bodyFrom, to: b.bodyTo, insert: '{"widget": "a/b@1", "x": 1}' } })).state;
    expect(s.field(widgetEditField)).toMatchObject({ from: FROM, gone: false });
    const after = nextWidgetBody(widgetBlockAt(s, s.field(widgetEditField)!.from)!.body, { n: 9 }, 1)!;
    expect(JSON.parse(after)).toEqual({ widget: "a/b@1", x: 1, state: { n: 9 } });
    const b2 = widgetBlocks(s)[0]!;
    const tr = apply(s, external({ changes: { from: b2.from, to: b2.to } }));
    expect(tr.state.field(widgetEditField)!.gone).toBe(true);
    expect(widgetGoneNow(tr)).toBe(true);
    const tr2 = apply(tr.state, external({ changes: { from: 0, insert: "x" } }));
    expect(widgetGoneNow(tr2)).toBe(false);
    expect(widgetGoneNow(apply(tr2.state, {}))).toBe(false);
  });

  it("한 번 사라진 블록은 되살아나도 gone 그대로", () => {
    let { s } = editing();
    const b = widgetBlocks(s)[0]!;
    const closeLine = s.doc.lineAt(b.to);
    // 닫는 펜스를 지우면 닫히지 않은 블록 — 위젯 블록이 아니다
    s = apply(s, external({ changes: { from: closeLine.from, to: closeLine.to } })).state;
    expect(s.field(widgetEditField)!.gone).toBe(true);
    s = apply(s, external({ changes: { from: closeLine.from, insert: "```" } })).state;
    expect(widgetBlockAt(s, s.field(widgetEditField)!.from)).not.toBeNull();
    expect(s.field(widgetEditField)!.gone).toBe(true);
  });

  it("수정 시작 효과는 뒤 spec 의 변경을 따라 옮겨진다(그 자리 바로 앞에 넣은 글 뒤로)", () => {
    const s = state(DOC);
    const tr = s.update({ effects: startWidgetEdit.of({ from: FROM, draft: {} }) }, { changes: { from: FROM, insert: "새 줄\n" } });
    expect(tr.state.field(widgetEditField)).toMatchObject({ from: FROM + 4, gone: false });
  });

  describe("덜 파싱된 트리", () => {
    // EditorState 는 처음에 앞 3000자만 파싱하고, 변경마다 그 끝까지만 더 파싱한다 — 뒤의 블록은 트리에 아직 없다
    const PAD = "줄\n\n".repeat(4000);
    const BIG = PAD + "```keyring-widget\n{}\n```\n";
    const BFROM = PAD.length;
    function partial() {
      const s = EditorState.create({ doc: BIG, extensions: [markdown({ base: markdownLanguage }), widgetEditField] });
      return s.update({ effects: startWidgetEdit.of({ from: BFROM, draft: {} }) }).state;
    }

    it("트리가 그 자리까지 오지 않았으면 gone 으로 치지 않는다", () => {
      let s = partial();
      s = s.update(external({ changes: { from: 0, insert: "x" } })).state;
      expect(widgetBlockAt(s, s.field(widgetEditField)!.from)).toBeNull();
      expect(s.field(widgetEditField)!.gone).toBe(false);
    });

    it("파싱이 따라오면 그때 판정한다", () => {
      let s = partial();
      s = s.update(external({ changes: { from: BFROM, to: BIG.length } })).state;
      expect(s.field(widgetEditField)!.gone).toBe(false);
      ensureSyntaxTree(s, s.doc.length, 5000);
      const tr = s.update({});
      expect(tr.state.field(widgetEditField)!.gone).toBe(true);
      expect(widgetGoneNow(tr)).toBe(true);
    });

    it("파싱이 따라와도 블록이 있으면 gone 이 아니다", () => {
      let s = partial();
      s = s.update(external({ changes: { from: 0, insert: "x" } })).state;
      ensureSyntaxTree(s, s.doc.length, 5000);
      s = s.update({}).state;
      expect(s.field(widgetEditField)).toMatchObject({ from: BFROM + 1, gone: false });
    });
  });

  it("바뀐 것이 없으면 같은 객체", () => {
    const { s } = editing();
    const tr = apply(s, {});
    expect(tr.state.field(widgetEditField)).toBe(tr.startState.field(widgetEditField));
    const tr2 = apply(s, { selection: { anchor: 1 } });
    expect(tr2.state.field(widgetEditField)).toBe(tr2.startState.field(widgetEditField));
    // 블록 뒤를 고친 문서 변경도 자리·gone 이 그대로면 같은 객체
    const tr3 = apply(s, external({ changes: { from: s.doc.length, insert: "끝" } }));
    expect(tr3.state.field(widgetEditField)).toBe(tr3.startState.field(widgetEditField));
  });
});

describe("widgetResume — 다시 붙는 위젯이 이어받을 것", () => {
  const edit = { from: 3, draft: { n: 2 }, base: { n: 1 }, owner: "live", gone: false, focus: 1 };
  it("같은 호스트·같은 자리면 초안·시작 상태·포커스", () => {
    expect(widgetResume(edit, "live", true)).toEqual({ draft: { n: 2 }, base: { n: 1 }, focus: 1 });
  });
  it("다른 호스트가 시작한 수정·다른 자리·사라진 블록·수정 없음은 이어받지 않는다", () => {
    expect(widgetResume(edit, "preview", true)).toBeNull();
    expect(widgetResume(edit, "live", false)).toBeNull();
    expect(widgetResume({ ...edit, gone: true }, "live", true)).toBeNull();
    expect(widgetResume(null, "live", true)).toBeNull();
  });
});
