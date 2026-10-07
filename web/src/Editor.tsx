import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, type MutableRefObject } from "react";
import { codeFont, frontmatterFold, livePreview } from "./livePreview";

export interface LinkCandidate {
  /** [[ ]] 안에 넣을 이름 */
  label: string;
  /** 폴더 등 보조 정보 */
  detail?: string;
  /** 마크다운 문서가 아니면(첨부) true */
  attachment?: boolean;
}

export interface EditorHandle {
  /** 줄(1부터)의 할 일 체크 상태를 바꾼다. 에디터 실행 취소 기록에 남는다. */
  toggleTask(line: number, done: boolean): void;
  /** 그 줄(1부터)로 커서를 옮기고 보이게 한다. text가 그 줄(또는 가까운 줄)에 있으면 그 글을 고른다 */
  gotoLine(line: number, text?: string): void;
  /** 커서 자리에 글을 넣는다(템플릿 넣기) */
  insertText(text: string): void;
  /** 내용을 바꾼다(속성 입력 화면). 달라진 부분만 바꿔 커서·실행 취소 기록을 지킨다 */
  setContent(next: string): void;
  focus(): void;
}

/** 선택을 기호로 감싼다(이미 감싸여 있으면 벗긴다). 선택이 없으면 기호 사이에 커서 */
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

/** 링크: 선택한 글을 [글](|)로, 선택이 없으면 [[|]] */
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

/** 할 일: 줄이 - [ ]이면 체크를 바꾸고, 목록이면 - [ ]를 붙이고, 아니면 - [ ]로 시작하게 */
function toggleTaskLine(view: EditorView): boolean {
  const changes = [];
  const seen = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    const task = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text);
    const list = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line.text);
    if (task) {
      const at = line.from + task[1].length + 1;
      changes.push({ from: at, to: at + 1, insert: task[2] === " " ? "x" : " " });
    } else if (list) changes.push({ from: line.from + list[1].length, insert: "[ ] " });
    else {
      const indent = /^\s*/.exec(line.text)![0].length;
      changes.push({ from: line.from + indent, insert: "- [ ] " });
    }
  }
  view.dispatch({ changes, userEvent: "input" });
  return true;
}

interface Props {
  /** 문서가 바뀔 때마다 달라지는 키. 같은 키 동안에는 에디터 내용을 밖에서 덮어쓰지 않는다. */
  docKey: string;
  initial: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** 위키링크 자동완성 후보. 호출 시점의 최신 목록을 돌려준다. */
  linkCandidates: () => LinkCandidate[];
  handle?: MutableRefObject<EditorHandle | null>;
  readOnly?: boolean;
  /** 붙여넣거나 끌어 놓은 파일을 첨부로 올리고, 그 자리에 넣을 마크다운(링크)을 돌려준다 */
  onFiles?: (files: File[]) => Promise<string[]>;
  /** 편집 중 렌더링: 커서 없는 줄의 마크업 기호를 숨긴다 */
  live?: boolean;
  lineNumbers?: boolean;
  /** 커서 위치(줄·열, 1부터)가 바뀔 때 */
  onCursor?: (line: number, col: number) => void;
  /** 에디터에서 포커스가 빠질 때(자동 저장) */
  onBlur?: () => void;
  /** 프런트매터를 한 줄로 접는다(속성 칸이 열려 있을 때) */
  foldFrontmatter?: boolean;
}

/** 제목: 밑줄 없이 굵게(기본 강조 모양은 밑줄을 긋는다) */
const headingStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", textDecoration: "none" },
  { tag: tags.heading1, fontSize: "1.6em" },
  { tag: tags.heading2, fontSize: "1.35em" },
  { tag: tags.heading3, fontSize: "1.18em" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
]);

/** `[[` 또는 `![[` 뒤에서 문서·첨부 이름을 제안하고, 고르면 `]]`까지 닫아 준다. */
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

export function Editor({ docKey, initial, onChange, onSave, linkCandidates, handle, readOnly = false, onFiles, live = false, lineNumbers: showLines = false, onCursor, onBlur, foldFrontmatter = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveSlot = useRef(new Compartment());
  const linesSlot = useRef(new Compartment());
  const foldSlot = useRef(new Compartment());
  const foldRef = useRef(foldFrontmatter);
  foldRef.current = foldFrontmatter;
  const linesRef = useRef(showLines);
  linesRef.current = showLines;
  const liveRef = useRef(live);
  liveRef.current = live;
  const callbacks = useRef({ onChange, onSave, linkCandidates, onFiles, onCursor, onBlur });
  callbacks.current = { onChange, onSave, linkCandidates, onFiles, onCursor, onBlur };

  /** 올리는 동안 자리 표시를 넣었다가 링크로 바꾼다(실패하면 지운다) */
  const insertFiles = async (view: EditorView, files: File[], from: number, to: number) => {
    const placeholder = `<!-- 첨부 올리는 중… -->`;
    view.dispatch({ changes: { from, to, insert: placeholder } });
    let text = "";
    try {
      text = (await callbacks.current.onFiles!(files)).join("\n");
    } finally {
      const at = view.state.doc.toString().indexOf(placeholder);
      if (at >= 0) view.dispatch({ changes: { from: at, to: at + placeholder.length, insert: text }, selection: { anchor: at + text.length } });
    }
  };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          linesSlot.current.of(linesRef.current ? lineNumbers() : []),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(headingStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          foldSlot.current.of(foldRef.current ? frontmatterFold() : []),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          autocompletion({ override: [wikilinkSource(() => callbacks.current.linkCandidates())], icons: false }),
          EditorView.lineWrapping,
          codeFont(),
          liveSlot.current.of(liveRef.current ? livePreview() : []),
          EditorState.readOnly.of(readOnly),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (callbacks.current.onSave(), true) },
            { key: "Mod-b", preventDefault: true, run: (v) => !readOnly && wrapSelection(v, "**") },
            { key: "Mod-i", preventDefault: true, run: (v) => !readOnly && wrapSelection(v, "*") },
            { key: "Mod-k", preventDefault: true, run: (v) => !readOnly && insertLink(v) },
            { key: "Mod-Shift-h", preventDefault: true, run: (v) => !readOnly && wrapSelection(v, "==") },
            { key: "Mod-Enter", preventDefault: true, run: (v) => !readOnly && toggleTaskLine(v) },
            ...completionKeymap,
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          // 파일 붙여넣기·끌어놓기: 첨부로 올린 뒤 그 자리(놓은 곳)에 링크를 넣는다
          EditorView.domEventHandlers({
            paste(e, view) {
              const files = [...(e.clipboardData?.files ?? [])];
              if (!files.length || !callbacks.current.onFiles || readOnly) return false;
              e.preventDefault();
              void insertFiles(view, files, view.state.selection.main.from, view.state.selection.main.to);
              return true;
            },
            drop(e, view) {
              const files = [...(e.dataTransfer?.files ?? [])];
              if (!files.length || !callbacks.current.onFiles || readOnly) return false;
              e.preventDefault();
              const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
              void insertFiles(view, files, at, at);
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              callbacks.current.onCursor?.(line.number, head - line.from + 1);
            }
            if (u.focusChanged && !u.view.hasFocus) callbacks.current.onBlur?.();
          }),
        ],
      }),
    });
    if (handle) {
      handle.current = {
        toggleTask(lineNo, done) {
          if (lineNo < 1 || lineNo > view.state.doc.lines) return;
          const line = view.state.doc.line(lineNo);
          const m = /\[([ xX])\]/.exec(line.text);
          if (!m) return;
          const at = line.from + m.index + 1;
          view.dispatch({ changes: { from: at, to: at + 1, insert: done ? "x" : " " } });
        },
        insertText(text) {
          const r = view.state.selection.main;
          view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length }, scrollIntoView: true });
          view.focus();
        },
        setContent(next) {
          const cur = view.state.doc.toString();
          if (cur === next) return;
          let a = 0;
          while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
          let b = 0;
          while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
          view.dispatch({ changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) } });
        },
        focus() {
          view.focus();
        },
        gotoLine(lineNo, text) {
          const n = Math.min(Math.max(lineNo, 1), view.state.doc.lines);
          const line = view.state.doc.line(n);
          let sel = EditorSelection.single(line.from);
          if (text) {
            // 검색 결과 줄 번호가 조금 어긋나도(프런트매터 등) 가까운 줄에서 찾는다
            const q = text.toLowerCase();
            for (const d of [0, 1, -1, 2, -2, 3, -3]) {
              const k = n + d;
              if (k < 1 || k > view.state.doc.lines) continue;
              const l = view.state.doc.line(k);
              const at = l.text.toLowerCase().indexOf(q);
              if (at >= 0) {
                sel = EditorSelection.single(l.from + at, l.from + at + q.length);
                break;
              }
            }
          }
          view.dispatch({ selection: sel, effects: EditorView.scrollIntoView(sel.main.from, { y: "center" }) });
          view.focus();
        },
      };
    }
    viewRef.current = view;
    if (!readOnly) view.focus();
    return () => {
      viewRef.current = null;
      if (handle) handle.current = null;
      view.destroy();
    };
    // initial은 docKey가 바뀔 때만 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: linesSlot.current.reconfigure(showLines ? lineNumbers() : []) });
  }, [showLines]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: foldSlot.current.reconfigure(foldFrontmatter ? frontmatterFold() : []) });
  }, [foldFrontmatter]);

  // 편집 중 렌더링 켜고 끄기(에디터를 다시 만들지 않는다)
  useEffect(() => {
    viewRef.current?.dispatch({ effects: liveSlot.current.reconfigure(live ? livePreview() : []) });
  }, [live]);

  return <div className={`editor${live ? " live" : ""}${showLines ? " lines" : ""}`} ref={host} />;
}
