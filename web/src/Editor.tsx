import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  codeFolding,
  defaultHighlightStyle,
  ensureSyntaxTree,
  foldable,
  foldAll,
  foldCode,
  foldEffect,
  foldedRanges,
  foldGutter,
  foldNodeProp,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
  unfoldAll,
  unfoldCode,
  unfoldEffect,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type ChangeSet, type StateEffect } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, type MutableRefObject } from "react";
import { findBar, findKeymap } from "./findBar";
import { codeFont, frontmatterFold, livePreview } from "./livePreview";
import type { LiveRenderContext } from "./liveBlocks";
import { anchorsOf, CODE_FOLD_MIN_LINES, getFolds, onFoldsChange, resolveFolds, setFolds } from "./folds";
import { t } from "./i18n";
import { diffChange, mirrorSpec, outgoingChanges } from "./mirror";

export interface LinkCandidate {
  /** [[ ]] 안에 넣을 이름 */
  label: string;
  /** 폴더 등 보조 정보 */
  detail?: string;
  /** 마크다운 문서가 아니면(첨부) true */
  attachment?: boolean;
}

export interface EditorHandle {
  /** 이 에디터를 만든 문서(docKey). 칸의 배치가 바뀌어도 다시 만들기 전까지는 옛 문서의 것이다 */
  readonly docKey: string;
  /** 줄(1부터)의 할 일 체크 상태를 바꾼다. 에디터 실행 취소 기록에 남는다. */
  toggleTask(line: number, done: boolean): void;
  /** 그 줄(1부터)로 커서를 옮기고 보이게 한다. text가 그 줄(또는 가까운 줄)에 있으면 그 글을 고른다 */
  gotoLine(line: number, text?: string): void;
  /** 커서 자리에 글을 넣는다(템플릿 넣기). keepSelection이면 고른 글을 지우지 않고 그 뒤에 넣는다(첨부 넣기) */
  insertText(text: string, opts?: { keepSelection?: boolean; ownLine?: boolean }): void;
  /** 내용을 바꾼다(속성 입력 화면). 달라진 부분만 바꿔 커서·실행 취소 기록을 지킨다 */
  setContent(next: string): void;
  /** 같은 문서를 연 다른 칸의 변경을 받는다. 이 칸의 실행 취소 기록에는 남기지 않는다. 길이가 어긋나면 fallback 내용으로 맞춘다 */
  applyChanges(changes: ChangeSet, fallback: string): void;
  focus(): void;
  /** 본문 바깥을 눌렀을 때: 본문 위쪽이면 아무것도 안 하고 false. 본문 아래면 끝에, 옆이면 그 줄에 커서를 두고 포커스 */
  focusAt(x: number, y: number): boolean;
  hasFocus(): boolean;
  /** 접기: 지금 위치 접기·펴기, 모두 접기·펴기, 이 수준 제목만 보기, 그 줄(1부터) 접기 바꾸기 */
  fold(what: "here" | "unfold-here" | "all" | "unfold-all" | "level"): void;
  toggleFoldLine(line: number): void;
  /** 접힌 블록의 첫 줄 번호들 */
  foldedLines(): number[];
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
  /** 이 칸에서 친 뒤의 내용과 그 뷰의 docKey. 받는 쪽은 docKey 가 지금 판일 때만 초안으로 받는다 */
  onChange: (value: string, docKey: string) => void;
  /** 이 칸에서 생긴 변경(다른 칸에서 받은 것은 빼고). 같은 문서를 연 다른 칸에 전달한다 */
  onChanges?: (changes: ChangeSet, docKey: string) => void;
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
  /** 프런트매터를 한 줄로 접는다("속성 N개 — 오른쪽 패널에서 보기") */
  foldFrontmatter?: boolean;
  /** 접힌 프런트매터 줄을 누르면: 오른쪽 패널 속성 탭 열기 */
  onShowProps?: () => void;
  /** 접힌 상태를 기억할 문서 경로(이 기기). 없으면 기억하지 않는다 */
  foldKey?: string;
  /** Live Preview가 블록(콜아웃·수식·임베드…)을 그릴 때 쓸 링크 해석 */
  renderContext?: () => LiveRenderContext | null;
  /** 만들어질 때 포커스를 가져갈지(기본 true). 두 칸이면 활성 칸의 것만 — 아니면 나중에 만든 칸이 활성 칸을 빼앗는다 */
  autoFocus?: boolean;
}

/** 블록의 접힌 줄들(접힌 범위가 시작하는 줄) */
function foldedLineNumbers(state: EditorState): number[] {
  const out: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).number);
  });
  return out;
}

/** 그 줄에서 시작하는 접힌 범위를 펴거나, 접을 수 있으면 접는다 */
function toggleLine(view: EditorView, lineNo: number): boolean {
  if (lineNo < 1 || lineNo > view.state.doc.lines) return false;
  const line = view.state.doc.line(lineNo);
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(line.from, line.to, (from, to) => {
    if (view.state.doc.lineAt(from).number === lineNo) effects.push(unfoldEffect.of({ from, to }));
  });
  if (!effects.length) {
    const r = foldable(view.state, line.from, line.to);
    if (r) effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
}

/** 그 위치를 덮는 접힌 범위를 편다(검색 결과·제목 링크로 갈 때) */
function revealPos(view: EditorView, pos: number) {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(pos, pos, (from, to) => {
    if (from <= pos && pos <= to) effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) view.dispatch({ effects });
}

/** 이 수준 제목만 보기: 커서가 든 섹션의 제목 수준과 같은 제목을 모두 접는다 */
function foldLevel(view: EditorView) {
  const { state } = view;
  ensureSyntaxTree(state, state.doc.length, 300);
  const head = state.selection.main.head;
  let level = 0;
  const heads: { level: number; line: number }[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      const m = /^(?:ATX|Setext)Heading(\d)$/.exec(n.name);
      if (!m) return;
      heads.push({ level: Number(m[1]), line: state.doc.lineAt(n.from).number });
      if (n.from <= head) level = Number(m[1]);
      return false;
    },
  });
  if (!level) level = Math.min(...heads.map((h) => h.level), 6);
  const effects: StateEffect<unknown>[] = [];
  for (const h of heads) {
    if (h.level !== level) continue;
    const line = state.doc.line(h.line);
    const r = foldable(state, line.from, line.to);
    if (r) effects.push(foldEffect.of(r));
  }
  if (effects.length) view.dispatch({ effects });
}

/** 코드 블록은 길 때만 접는다(짧은 블록은 단추도 없다) */
const codeFoldProp = foldNodeProp.add({
  FencedCode: (node, state) => {
    const a = state.doc.lineAt(node.from);
    const b = state.doc.lineAt(node.to);
    return b.number - a.number + 1 >= CODE_FOLD_MIN_LINES ? { from: a.to, to: node.to } : null;
  },
});

/** ▸/▾ 접기 단추(제목·목록·콜아웃·긴 코드·표 왼쪽) */
const foldMarkers = foldGutter({
  markerDOM: (open) => {
    const el = document.createElement("span");
    el.className = `cm-fold-marker ${open ? "open" : "closed"}`;
    el.textContent = open ? "▾" : "▸";
    el.title = open ? t("fold.fold") : t("fold.unfold");
    return el;
  },
});

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

export function Editor({
  docKey,
  initial,
  onChange,
  onChanges,
  onSave,
  linkCandidates,
  handle,
  readOnly = false,
  onFiles,
  live = false,
  lineNumbers: showLines = false,
  onCursor,
  onBlur,
  foldFrontmatter = false,
  onShowProps,
  foldKey,
  renderContext,
  autoFocus = true,
}: Props) {
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
  const ctxRef = useRef(renderContext);
  ctxRef.current = renderContext;
  const getCtx = () => ctxRef.current?.() ?? null;
  const foldKeyRef = useRef(foldKey);
  foldKeyRef.current = foldKey;
  const autoFocusRef = useRef(autoFocus);
  autoFocusRef.current = autoFocus;
  const docKeyRef = useRef(docKey);
  docKeyRef.current = docKey;
  const callbacks = useRef({ onChange, onChanges, onSave, linkCandidates, onFiles, onCursor, onBlur, onShowProps });
  callbacks.current = { onChange, onChanges, onSave, linkCandidates, onFiles, onCursor, onBlur, onShowProps };
  const showProps = () => callbacks.current.onShowProps?.();

  /** 올리는 동안 자리 표시를 넣었다가 링크로 바꾼다(실패하면 지운다) */
  const insertFiles = async (view: EditorView, files: File[], from: number, to: number) => {
    const placeholder = `<!-- ${t("editor.uploading")} -->`;
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
    /** 이 뷰를 만든 문서. 다시 그려 docKey 가 바뀌면 이 뷰는 곧 없어질 낡은 뷰다 */
    const createdKey = docKey;
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
          findBar(),
          syntaxHighlighting(headingStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          foldSlot.current.of(foldRef.current ? frontmatterFold(showProps) : []),
          markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [{ props: [codeFoldProp] }] }),
          codeFolding({ placeholderText: "…" }),
          foldMarkers,
          autocompletion({ override: [wikilinkSource(() => callbacks.current.linkCandidates())], icons: false }),
          EditorView.lineWrapping,
          codeFont(),
          liveSlot.current.of(liveRef.current ? livePreview(getCtx) : []),
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
            ...findKeymap,
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
            // 이 칸에서 친 변경만, 이 뷰가 아직 지금 문서의 것일 때만 내보낸다(판정은 mirror.ts outgoingChanges)
            const own = outgoingChanges(u.transactions, createdKey, docKeyRef.current);
            if (own.length) {
              // 초안을 먼저 고친다: 다른 칸이 변경을 못 맞추면 이 최신 초안으로 맞춘다
              callbacks.current.onChange(u.state.doc.toString(), createdKey);
              for (const changes of own) callbacks.current.onChanges?.(changes, createdKey);
            }
            // 접은 것을 이 기기에 기억한다(내용이 바뀌어 줄이 밀리면 새 줄로)
            const foldChanged = u.transactions.some((t) => t.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)));
            if (foldKeyRef.current && (foldChanged || (u.docChanged && foldedRanges(u.state).size))) {
              setFolds(foldKeyRef.current, anchorsOf(u.state.doc.toString().split("\n"), foldedLineNumbers(u.state)), view);
            }
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
        docKey: createdKey,
        toggleTask(lineNo, done) {
          if (lineNo < 1 || lineNo > view.state.doc.lines) return;
          const line = view.state.doc.line(lineNo);
          const m = /\[([ xX])\]/.exec(line.text);
          if (!m) return;
          const at = line.from + m.index + 1;
          view.dispatch({ changes: { from: at, to: at + 1, insert: done ? "x" : " " } });
        },
        insertText(text, opts) {
          const r = view.state.selection.main;
          const from = opts?.keepSelection ? r.to : r.from;
          // ownLine: 앞뒤 글과 붙지 않게 자기 줄에(그림 embed는 줄 하나를 차지해야 그려진다)
          const before = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
          const after = r.to < view.state.doc.length && view.state.sliceDoc(r.to, r.to + 1) !== "\n" ? "\n" : "";
          const insert = opts?.ownLine ? before + text + after : text;
          view.dispatch({
            changes: { from, to: r.to, insert },
            selection: { anchor: from + (opts?.ownLine ? before.length + text.length : text.length) },
            scrollIntoView: true,
          });
          view.focus();
        },
        setContent(next) {
          const changes = diffChange(view.state.doc.toString(), next);
          if (changes) view.dispatch({ changes });
        },
        applyChanges(changes, fallback) {
          const spec = mirrorSpec(view.state, changes, fallback);
          if (spec) view.dispatch(spec);
        },
        focus() {
          view.focus();
        },
        focusAt(x, y) {
          const r = view.contentDOM.getBoundingClientRect();
          if (y < r.top) return false;
          const anchor =
            y >= r.bottom
              ? view.state.doc.length
              : (view.posAtCoords({ x: Math.min(Math.max(x, r.left + 1), r.right - 1), y }, false) ?? view.state.doc.length);
          view.dispatch({ selection: { anchor }, scrollIntoView: true });
          view.focus();
          return true;
        },
        hasFocus() {
          return view.hasFocus;
        },
        fold(what) {
          if (what === "here") foldCode(view);
          else if (what === "unfold-here") unfoldCode(view);
          else if (what === "all") {
            ensureSyntaxTree(view.state, view.state.doc.length, 300);
            foldAll(view);
          } else if (what === "unfold-all") unfoldAll(view);
          else foldLevel(view);
        },
        toggleFoldLine(lineNo) {
          ensureSyntaxTree(view.state, view.state.doc.length, 300);
          toggleLine(view, lineNo);
        },
        foldedLines() {
          return foldedLineNumbers(view.state);
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
          revealPos(view, sel.main.from);
          view.dispatch({ selection: sel, effects: EditorView.scrollIntoView(sel.main.from, { y: "center" }) });
          view.focus();
        },
      };
    }
    // 이 문서에서 접어 두었던 곳을 다시 접는다. 미리보기·개요에서 바꾸면 따라간다
    const applyFolds = () => {
      const key = foldKeyRef.current;
      if (!key) return;
      ensureSyntaxTree(view.state, view.state.doc.length, 500);
      const want = resolveFolds(view.state.doc.toString().split("\n"), getFolds(key));
      const have = new Set(foldedLineNumbers(view.state));
      const effects: StateEffect<unknown>[] = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        if (!want.has(view.state.doc.lineAt(from).number)) effects.push(unfoldEffect.of({ from, to }));
      });
      for (const n of want) {
        if (have.has(n) || n > view.state.doc.lines) continue;
        const line = view.state.doc.line(n);
        const r = foldable(view.state, line.from, line.to);
        if (r) effects.push(foldEffect.of(r));
      }
      if (effects.length) view.dispatch({ effects });
    };
    applyFolds();
    const offFolds = onFoldsChange((path, source) => {
      if (source !== view && path === foldKeyRef.current) applyFolds();
    });
    viewRef.current = view;
    if (!readOnly && autoFocusRef.current) view.focus();
    return () => {
      offFolds();
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
    viewRef.current?.dispatch({ effects: foldSlot.current.reconfigure(foldFrontmatter ? frontmatterFold(showProps) : []) });
  }, [foldFrontmatter]);

  // 편집 중 렌더링 켜고 끄기(에디터를 다시 만들지 않는다)
  useEffect(() => {
    viewRef.current?.dispatch({ effects: liveSlot.current.reconfigure(live ? livePreview(getCtx) : []) });
  }, [live]);

  return <div className={`editor${live ? " live" : ""}${showLines ? " lines" : ""}`} ref={host} />;
}
