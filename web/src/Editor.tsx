import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, type MutableRefObject } from "react";
import { livePreview } from "./livePreview";

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
  /** 그 줄(1부터)로 커서를 옮기고 보이게 한다 */
  gotoLine(line: number): void;
  /** 커서 자리에 글을 넣는다(템플릿 넣기) */
  insertText(text: string): void;
  /** 내용을 바꾼다(속성 입력 화면). 달라진 부분만 바꿔 커서·실행 취소 기록을 지킨다 */
  setContent(next: string): void;
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
}

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

export function Editor({ docKey, initial, onChange, onSave, linkCandidates, handle, readOnly = false, onFiles, live = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveSlot = useRef(new Compartment());
  const liveRef = useRef(live);
  liveRef.current = live;
  const callbacks = useRef({ onChange, onSave, linkCandidates, onFiles });
  callbacks.current = { onChange, onSave, linkCandidates, onFiles };

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
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          autocompletion({ override: [wikilinkSource(() => callbacks.current.linkCandidates())], icons: false }),
          EditorView.lineWrapping,
          liveSlot.current.of(liveRef.current ? livePreview() : []),
          EditorState.readOnly.of(readOnly),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (callbacks.current.onSave(), true) },
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
        gotoLine(lineNo) {
          const n = Math.min(Math.max(lineNo, 1), view.state.doc.lines);
          const line = view.state.doc.line(n);
          view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 40 }) });
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

  // 편집 중 렌더링 켜고 끄기(에디터를 다시 만들지 않는다)
  useEffect(() => {
    viewRef.current?.dispatch({ effects: liveSlot.current.reconfigure(live ? livePreview() : []) });
  }, [live]);

  return <div className={`editor${live ? " live" : ""}`} ref={host} />;
}
