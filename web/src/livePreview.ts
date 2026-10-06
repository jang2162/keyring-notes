import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * 편집 중 렌더링(Live Preview): 커서가 없는 줄에서는 마크업 기호를 숨기고 모양만 보인다.
 * 원문은 그대로이고(커서를 그 줄로 옮기면 기호가 다시 보인다), 숨기는 것은 표시뿐이다.
 *
 *   # 제목 → 제목(크게)        **굵게**·*기울임*·~~취소~~·==강조== → 기호 숨김
 *   `코드` → 백틱 숨김         [글자](주소) → 글자만     [[대상|별칭]] → 별칭(없으면 대상)
 *
 * 코드 블록·수식·표·이미지·HTML은 건드리지 않는다.
 */

const hide = Decoration.replace({});
const headingLine = (level: number) => Decoration.line({ class: `cm-lp-h cm-lp-h${level}` });
const markText = Decoration.mark({ class: "cm-lp-mark" });
const linkText = Decoration.mark({ class: "cm-lp-link" });

/** 선택(커서)이 걸친 줄 번호 */
function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

interface Item {
  from: number;
  to: number;
  deco: Decoration;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const items: Item[] = [];
  const lineOf = (pos: number) => state.doc.lineAt(pos).number;
  const visible = (pos: number) => !active.has(lineOf(pos));
  // 위키링크·하이라이트를 찾을 때 피할 범위(코드)
  const code: [number, number][] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (name === "FencedCode" || name === "CodeBlock" || name === "HTMLBlock" || name === "Table") {
          code.push([node.from, node.to]);
          return false;
        }
        if (name === "InlineCode") code.push([node.from, node.to]);
        const m = /^ATXHeading(\d)$/.exec(name);
        if (m) {
          const line = state.doc.lineAt(node.from);
          items.push({ from: line.from, to: line.from, deco: headingLine(Number(m[1])) });
          return;
        }
        if (name === "Image") return false; // 이미지 문법은 그대로
        if (!visible(node.from)) return;
        if (name === "HeaderMark") {
          // "# " 기호와 뒤 공백
          const after = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          if (node.node.parent?.name.startsWith("ATXHeading") && after > node.from) items.push({ from: node.from, to: after, deco: hide });
        } else if (name === "EmphasisMark" || name === "StrikethroughMark") {
          items.push({ from: node.from, to: node.to, deco: hide });
        } else if (name === "CodeMark" && node.node.parent?.name === "InlineCode") {
          items.push({ from: node.from, to: node.to, deco: hide });
        } else if (name === "Link") {
          // [글자](주소 "제목") → 글자만
          const marks: { from: number; to: number; name: string }[] = [];
          const c = node.node.cursor();
          if (c.firstChild()) {
            do marks.push({ from: c.from, to: c.to, name: c.name });
            while (c.nextSibling());
          }
          const open = marks.find((k) => k.name === "LinkMark" && state.sliceDoc(k.from, k.to) === "[");
          const close = marks.find((k) => k.name === "LinkMark" && state.sliceDoc(k.from, k.to) === "]");
          // 주소가 있는 링크만([글자](주소)). [^1]·[!note]·[참조] 같은 것은 그대로
          const hasUrl = marks.some((k) => k.name === "URL") && marks.some((k) => k.name === "LinkMark" && state.sliceDoc(k.from, k.to) === "(");
          if (hasUrl && open && close && lineOf(open.from) === lineOf(node.to)) {
            items.push({ from: open.from, to: open.to, deco: hide });
            if (close.to > open.to) items.push({ from: open.to, to: close.from, deco: linkText });
            items.push({ from: close.from, to: node.to, deco: hide });
          }
          return false;
        }
      },
    });

    // 위키링크 [[대상|별칭]]과 하이라이트 ==글자==(lezer 마크다운 문법에 없어 글자로 찾는다)
    const text = state.sliceDoc(from, to);
    const inCode = (pos: number) => code.some(([a, b]) => pos >= a && pos < b);
    for (const m of text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
      const start = from + m.index!;
      if (m[1] || inCode(start) || !visible(start)) continue; // 임베드 ![[…]]는 그대로
      const inner = m[2];
      const bar = inner.indexOf("|");
      const shownFrom = start + 2 + (bar >= 0 ? bar + 1 : 0);
      const end = start + m[0].length;
      items.push({ from: start, to: shownFrom, deco: hide });
      items.push({ from: shownFrom, to: end - 2, deco: linkText });
      items.push({ from: end - 2, to: end, deco: hide });
    }
    for (const m of text.matchAll(/==(?=\S)([^=\n]+?)==/g)) {
      const start = from + m.index!;
      if (inCode(start) || !visible(start)) continue;
      const end = start + m[0].length;
      items.push({ from: start, to: start + 2, deco: hide });
      items.push({ from: start + 2, to: end - 2, deco: markText });
      items.push({ from: end - 2, to: end, deco: hide });
    }
  }

  // 겹치는 숨김은 바깥 것만(시작 순서대로 보며 앞 숨김 안에 든 것은 뺀다). 정렬은 Decoration.set이 한다.
  items.sort((a, b) => a.from - b.from || b.to - a.to);
  let hiddenUntil = -1;
  const ranges = [];
  for (const it of items) {
    if (it.deco === hide) {
      if (it.from < hiddenUntil) continue;
      hiddenUntil = it.to;
    }
    ranges.push(it.deco.range(it.from, it.to));
  }
  return Decoration.set(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  ".cm-lp-h": { fontWeight: "700" },
  ".cm-lp-h1": { fontSize: "1.6em" },
  ".cm-lp-h2": { fontSize: "1.35em" },
  ".cm-lp-h3": { fontSize: "1.18em" },
  ".cm-lp-mark": { backgroundColor: "var(--mark-bg)", color: "var(--mark-fg)", borderRadius: "3px" },
  ".cm-lp-link": { color: "var(--accent)", textDecoration: "underline", textDecorationStyle: "dashed", textUnderlineOffset: "3px" },
});

export function livePreview(): Extension {
  return [plugin, theme];
}
