import { syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";

/** @lezer/common 은 web 의 직접 의존성이 아니라 syntaxTree 의 결과에서 노드 타입을 얻는다 */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolve"]>;

/**
 * Live Preview 의 줄 단위 그리기 판정(구분선·인용·글머리·할 일·코드 블록). DOM 없이 EditorState 만 보고 정하므로 Node 에서 시험한다.
 * 장식으로 바꾸는 것은 livePreview.ts 의 build 다.
 */
export type SyntaxMark =
  | { kind: "hide"; from: number; to: number }
  /** 구분선 줄의 내용 전체 */
  | { kind: "hr"; from: number; to: number }
  /** 글머리 기호 한 글자(- * +). depth 는 목록 뎁스(1부터, 번호 목록도 센다) — 뎁스마다 다른 점을 그린다 */
  | { kind: "bullet"; from: number; to: number; depth: number }
  /**
   * 목록 항목의 첫 줄. 커서가 있는 줄에도 단다 — 들여쓰기 칸이 커서를 따라 움직이지 않게.
   * indentFrom–indentTo: 줄 앞 공백, indentTo–markTo: 표시(글머리·번호·할 일)와 뒤 공백 하나. 글은 markTo 부터.
   * 인용 안 목록은 줄 앞이 "> " 라 칸을 나눌 수 없어 내지 않는다(원문 들여쓰기 그대로)
   */
  | { kind: "listLine"; line: number; depth: number; indentFrom: number; indentTo: number; markTo: number }
  /** 목록 항목 안 문단에서 표시가 있는 첫 줄이 아닌 줄. 줄 앞 공백을 접고 그 뎁스의 글 시작에 맞춘다 */
  | { kind: "listCont"; line: number; depth: number; indentFrom: number; indentTo: number }
  /** "- [ ] " 전체(글머리부터 표시 뒤 공백까지). line 은 1부터 */
  | { kind: "task"; from: number; to: number; done: boolean; line: number }
  /** 인용 줄 장식. 커서가 있는 줄에도 단다 — 줄마다 막대가 들쭉날쭉하지 않게 */
  | { kind: "quoteLine"; line: number; depth: number }
  /** 코드 블록 안쪽 줄의 상자 장식. 커서가 블록 안에 있어도 단다 */
  | { kind: "codeLine"; line: number }
  /** 여는 펜스 줄(펜스부터 줄 끝). 커서가 블록 밖일 때만. code 는 펜스를 뺀 안쪽 코드(복사용) */
  | { kind: "fenceHead"; from: number; to: number; lang: string; code: string }
  /** 닫는 펜스 줄(펜스부터 줄 끝). 닫는 펜스 없이 문서가 끝나면 없다 */
  | { kind: "fenceTail"; from: number; to: number };

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

/** ListItem 의 목록 뎁스(1부터). 글머리·번호 목록을 가리지 않고 감싼 ListItem 을 센다 */
function listDepth(item: SyntaxNode): number {
  let d = 1;
  for (let p = item.parent; p; p = p.parent) if (p.name === "ListItem") d++;
  return d;
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
  /** 줄마다 인용 기호(QuoteMark)의 첫 시작과 마지막 끝. 코드 블록 안 줄의 > 는 코드 글자일 수 있어 노드로만 정한다 */
  const quoteMarks = new Map<number, { from: number; to: number }>();
  const quoteMark = (q: { from: number; to: number }) => {
    const line = lineOf(q.from);
    const had = quoteMarks.get(line);
    quoteMarks.set(line, had ? { from: Math.min(had.from, q.from), to: Math.max(had.to, q.to) } : { from: q.from, to: q.to });
  };
  let depth = 0;

  const fenced = (node: SyntaxNode) => {
    const marks = node.getChildren("CodeMark");
    const open = marks[0];
    if (!open) return;
    const info = node.getChild("CodeInfo");
    const lang = info ? (state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0] ?? "") : "";
    // Mermaid 는 liveBlocks 가 그린 다이어그램으로 바꾼다
    if (lang === "mermaid") return;
    const close = marks.length > 1 ? marks[marks.length - 1] : null;
    const head = lineOf(open.from);
    const tail = close ? lineOf(close.from) : lineOf(node.to);
    for (let i = head + 1; i <= (close ? tail - 1 : tail); i++) out.push({ kind: "codeLine", line: i });
    for (let i = head; i <= tail; i++) if (active.has(i)) return;
    // 목록·인용 안에서는 CodeText 가 줄마다 따로 생기고(사이에 들여쓰기·QuoteMark) 빈 줄에는 없을 수 있어 코드 줄마다 겹친 글을 모은다
    const texts = node.getChildren("CodeText");
    const lines: string[] = [];
    for (let i = head + 1; i <= (close ? tail - 1 : tail); i++) {
      const l = doc.line(i);
      lines.push(texts.map((t) => (t.to < l.from || t.from > l.to ? "" : state.sliceDoc(Math.max(t.from, l.from), Math.min(t.to, l.to)))).join(""));
    }
    out.push({ kind: "fenceHead", from: open.from, to: doc.line(head).to, lang, code: lines.join("\n") });
    if (close) out.push({ kind: "fenceTail", from: close.from, to: doc.line(tail).to });
  };

  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      const name = n.name;
      // 펼친 프런트매터(커서가 안)의 YAML 도 lezer 는 구분선·목록·할 일로 읽는다 — 종류와 상관없이 건너뛴다
      if (n.from <= fmTo && name !== "Document") return false;
      if (name === "QuoteMark") {
        quoteMark(n);
        return;
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        // 인용 안 코드 블록의 QuoteMark 는 코드 블록의 자식이다
        for (const q of n.node.getChildren("QuoteMark")) quoteMark(q);
      }
      if (name === "FencedCode") {
        fenced(n.node);
        return false;
      }
      if (name === "CodeBlock") {
        for (let i = lineOf(n.from); i <= lineOf(n.to); i++) out.push({ kind: "codeLine", line: i });
        return false;
      }
      if (name === "HTMLBlock" || name === "Table" || name === "CommentBlock") return false;
      if (name === "HorizontalRule") {
        if (!active.has(lineOf(n.from))) out.push({ kind: "hr", from: n.from, to: n.to });
        return false;
      }
      if (name === "Blockquote") {
        if (CALLOUT_LINE.test(doc.lineAt(n.from).text)) return false;
        depth++;
        for (let i = lineOf(n.from); i <= lineOf(n.to); i++) quoteDepth.set(i, depth);
        return;
      }
      // 항목 안 문단(할 일은 Task 가 문단 자리)의 줄 중 표시가 있는 첫 줄을 뺀 나머지 — 이어지는 줄(lazy 포함)과 느슨한 목록의 둘째 이후 문단
      if ((name === "Paragraph" || name === "Task") && n.node.parent?.name === "ListItem" && depth === 0) {
        const d = listDepth(n.node.parent);
        const markLine = lineOf(n.node.parent.from);
        for (let i = Math.max(lineOf(n.from), markLine + 1); i <= lineOf(n.to); i++) {
          const l = doc.line(i);
          out.push({ kind: "listCont", line: i, depth: d, indentFrom: l.from, indentTo: l.from + /^[ \t]*/.exec(l.text)![0].length });
        }
        return;
      }
      if (name === "ListMark") {
        const mark = state.sliceDoc(n.from, n.to);
        const task = n.node.nextSibling?.name === "Task" ? n.node.nextSibling.getChild("TaskMarker") : null;
        const itemDepth = n.node.parent ? listDepth(n.node.parent) : 1;
        const line = doc.lineAt(n.from);
        if (depth === 0 && /^[ \t]*$/.test(doc.sliceString(line.from, n.from))) {
          const end = task ? task.to : n.to;
          const markTo = /[ \t]/.test(state.sliceDoc(end, end + 1)) ? end + 1 : end;
          out.push({ kind: "listLine", line: line.number, depth: itemDepth, indentFrom: line.from, indentTo: n.from, markTo });
        }
        if (active.has(line.number)) return;
        if (task) {
          // 번호 목록의 할 일은 번호를 남기고 [ ] 만 바꾼다
          const start = /^[-*+]$/.test(mark) ? n.from : task.from;
          const end = state.sliceDoc(task.to, task.to + 1) === " " ? task.to + 1 : task.to;
          out.push({ kind: "task", from: start, to: end, done: /x/i.test(state.sliceDoc(task.from, task.to)), line: lineOf(n.from) });
        } else if (/^[-*+]$/.test(mark)) out.push({ kind: "bullet", from: n.from, to: n.to, depth: itemDepth });
        return;
      }
      return;
    },
    leave: (n) => {
      if (n.name === "Blockquote" && !CALLOUT_LINE.test(doc.lineAt(n.from).text)) depth--;
    },
  });

  // 인용 기호는 줄마다 한 덩어리로(">> " 처럼 겹친 것도): 첫 QuoteMark 부터 마지막 QuoteMark 뒤 공백 하나까지
  for (const [line, d] of quoteDepth) {
    out.push({ kind: "quoteLine", line, depth: d });
    if (active.has(line)) continue;
    const q = quoteMarks.get(line);
    if (q) out.push({ kind: "hide", from: q.from, to: state.sliceDoc(q.to, q.to + 1) === " " ? q.to + 1 : q.to });
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
