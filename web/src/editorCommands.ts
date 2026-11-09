import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { HighlightStyle } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { LinkCandidate } from "./Editor";

/**
 * 본문 편집기와 표의 칸 편집기(cellEditor.ts)가 함께 쓰는 서식 명령·구문 색·위키링크 자동완성.
 * 칸 편집기가 Editor.tsx 를 직접 부르면 Editor → livePreview → 표 → 칸 편집기 → Editor 로 순환한다
 */

export /** 선택을 기호로 감싼다(이미 감싸여 있으면 벗긴다). 선택이 없으면 기호 사이에 커서 */
function wrapSelection(view: EditorView, before: string, after = before): boolean {
  const changes = view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    const outer = view.state.sliceDoc(r.from - before.length, r.to + after.length);
    if (outer.startsWith(before) && outer.endsWith(after) && outer.length >= before.length + after.length) {
      return {
        changes: [
          { from: r.from - before.length, to: r.from, insert: "" },
          { from: r.to, to: r.to + after.length, insert: "" },
        ],
        range: EditorSelection.range(r.from - before.length, r.to - before.length),
      };
    }
    return {
      changes: [
        { from: r.from, insert: before },
        { from: r.to, insert: after },
      ],
      range: EditorSelection.range(r.from + before.length, r.from + before.length + text.length),
    };
  });
  view.dispatch(changes, { scrollIntoView: true, userEvent: "input" });
  return true;
}

export /** 링크: 선택한 글을 [글](|)로, 선택이 없으면 [[|]] */
function insertLink(view: EditorView): boolean {
  const r = view.state.selection.main;
  if (r.empty) {
    view.dispatch({ changes: { from: r.from, insert: "[[]]" }, selection: { anchor: r.from + 2 }, userEvent: "input" });
    return true;
  }
  const text = view.state.sliceDoc(r.from, r.to);
  const insert = `[${text}]()`;
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: r.from + insert.length - 1 }, userEvent: "input" });
  return true;
}

/** 제목: 밑줄 없이 굵게(기본 강조 모양은 밑줄을 긋는다). 크기는 원문 모드만 headingSizes 로 준다 */
export const headingStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", textDecoration: "none" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
  // classHighlighter 에는 취소선 클래스가 없다
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

/**
 * 원문 모드의 제목 글자 크기. Live Preview 는 줄(.cm-lp-h1~h6, livePreview.ts)에 미리보기와 같은 크기를 주므로
 * 이것을 함께 걸면 배율이 두 번 곱해진다 — Editor.tsx 는 Live 가 꺼졌을 때만 이것을 건다.
 * 배율은 styles.css 「접기」 의 원문 거터 칸(cm-fold-h1~h3)과 같다
 */
export const headingSizes = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em" },
  { tag: tags.heading2, fontSize: "1.35em" },
  { tag: tags.heading3, fontSize: "1.18em" },
]);

export /** `[[` 또는 `![[` 뒤에서 문서·첨부 이름을 제안하고, 고르면 `]]`까지 닫아 준다. */
function wikilinkSource(get: () => LinkCandidate[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/!?\[\[[^\]\n|#[]*$/);
    if (!m) return null;
    const open = m.text.indexOf("[[");
    const embed = m.text.startsWith("!");
    const from = m.from + open + 2;
    // 링크는 문서를, 임베드(![[)는 첨부를 먼저 보여 준다.
    const rank = (c: LinkCandidate) => Number(embed ? !c.attachment : !!c.attachment);
    const items = [...get()].sort((a, b) => rank(a) - rank(b));
    return {
      from,
      validFor: /^[^\]\n|#[]*$/,
      options: items.map((c) => ({
        label: c.label,
        detail: c.detail,
        type: c.attachment ? "file" : "text",
        apply: (view: EditorView, _c: unknown, f: number, to: number) => {
          const closed = view.state.sliceDoc(to, to + 2) === "]]";
          const insert = c.label + (closed ? "" : "]]");
          view.dispatch({ changes: { from: f, to, insert }, selection: { anchor: f + insert.length + (closed ? 2 : 0) } });
        },
      })),
    };
  };
}
