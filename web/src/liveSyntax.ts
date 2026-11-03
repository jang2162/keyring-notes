import { syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";

/**
 * Live Preview 의 줄 단위 그리기 판정(구분선·인용·글머리·할 일). DOM 없이 EditorState 만 보고 정하므로 Node 에서 시험한다.
 * 장식으로 바꾸는 것은 livePreview.ts 의 build 다.
 */
export type SyntaxMark =
  | { kind: "hide"; from: number; to: number }
  /** 구분선 줄의 내용 전체 */
  | { kind: "hr"; from: number; to: number }
  /** 글머리 기호 한 글자(- * +) */
  | { kind: "bullet"; from: number; to: number }
  /** "- [ ] " 전체(글머리부터 표시 뒤 공백까지). line 은 1부터 */
  | { kind: "task"; from: number; to: number; done: boolean; line: number }
  /** 인용 줄 장식. 커서가 있는 줄에도 단다 — 줄마다 막대가 들쭉날쭉하지 않게 */
  | { kind: "quoteLine"; line: number; depth: number };

/** 콜아웃(> [!note]) 첫 줄. liveBlocks 가 위젯으로 그리고, 여기서는 인용으로 보지 않는다 */
export const CALLOUT_LINE = /^\s*>\s*\[![A-Za-z][\w-]*\][+-]?/;

/** 맨 앞 프런트매터(--- … ---)의 닫는 줄 번호. 없으면 null */
export function frontmatterEnd(state: EditorState): number | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return null;
  for (let i = 2; i <= Math.min(doc.lines, 300); i++) {
    const t = doc.line(i).text.trimEnd();
    if (t === "---" || t === "...") return i;
  }
  return null;
}

/** from–to 에 걸친 노드에서 그릴 것을 찾는다. active: 커서(선택)가 걸친 줄 번호 */
export function syntaxMarks(state: EditorState, from: number, to: number, active: Set<number>): SyntaxMark[] {
  const doc = state.doc;
  const out: SyntaxMark[] = [];
  const fm = frontmatterEnd(state);
  // lezer 는 프런트매터의 여는 --- 를 구분선으로 읽는다
  const fmTo = fm === null ? -1 : doc.line(fm).to;
  const lineOf = (pos: number) => doc.lineAt(pos).number;
  const quoteDepth = new Map<number, number>();
  let depth = 0;

  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      const name = n.name;
      if (name === "FencedCode" || name === "CodeBlock" || name === "HTMLBlock" || name === "Table" || name === "CommentBlock") return false;
      if (name === "HorizontalRule") {
        if (n.from > fmTo && !active.has(lineOf(n.from))) out.push({ kind: "hr", from: n.from, to: n.to });
        return false;
      }
      if (name === "Blockquote") {
        if (CALLOUT_LINE.test(doc.lineAt(n.from).text)) return false;
        depth++;
        for (let i = lineOf(n.from); i <= lineOf(n.to); i++) quoteDepth.set(i, depth);
        return;
      }
      if (name === "ListMark") {
        if (active.has(lineOf(n.from))) return;
        const mark = state.sliceDoc(n.from, n.to);
        const task = n.node.nextSibling?.name === "Task" ? n.node.nextSibling.getChild("TaskMarker") : null;
        if (task) {
          // 번호 목록의 할 일은 번호를 남기고 [ ] 만 바꾼다
          const start = /^[-*+]$/.test(mark) ? n.from : task.from;
          const end = state.sliceDoc(task.to, task.to + 1) === " " ? task.to + 1 : task.to;
          out.push({ kind: "task", from: start, to: end, done: /x/i.test(state.sliceDoc(task.from, task.to)), line: lineOf(n.from) });
        } else if (/^[-*+]$/.test(mark)) out.push({ kind: "bullet", from: n.from, to: n.to });
        return;
      }
      return;
    },
    leave: (n) => {
      if (n.name === "Blockquote" && !CALLOUT_LINE.test(doc.lineAt(n.from).text)) depth--;
    },
  });

  // 인용 기호는 줄마다 한 덩어리로(">> " 처럼 겹친 것도): 첫 > 부터 마지막 > 뒤 공백 하나까지
  for (const [line, d] of quoteDepth) {
    out.push({ kind: "quoteLine", line, depth: d });
    if (active.has(line)) continue;
    const l = doc.line(line);
    const m = /^(\s*)((?:>\s?)*>)( ?)/.exec(l.text);
    if (m && m[2]) out.push({ kind: "hide", from: l.from + m[1].length, to: l.from + m[0].length });
  }
  return out;
}

/** line(1부터) 의 할 일 표시 [ ]↔[x] 한 글자만 바꾼다. 선택은 건드리지 않는다. 할 일이 아니면 null */
export function toggleTaskAt(state: EditorState, line: number): TransactionSpec | null {
  if (line < 1 || line > state.doc.lines) return null;
  const l = state.doc.line(line);
  let marker: { from: number; to: number } | null = null;
  syntaxTree(state).iterate({
    from: l.from,
    to: l.to,
    enter: (n) => {
      if (marker) return false;
      if (n.name === "TaskMarker" && n.from >= l.from && n.to <= l.to) marker = { from: n.from, to: n.to };
      return;
    },
  });
  if (!marker) return null;
  const { from } = marker as { from: number; to: number };
  const done = state.sliceDoc(from + 1, from + 2) !== " ";
  return { changes: { from: from + 1, to: from + 2, insert: done ? " " : "x" }, userEvent: "input" };
}
