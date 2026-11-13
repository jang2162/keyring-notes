/**
 * 가운데 칸 하나: 문서 머리(빵부스러기·보기 모드·도구)·배너·제목·에디터·미리보기.
 * 칸마다 하나씩 그린다. 문서의 원본(초안·저장 상태·충돌)은 Workspace 의 저장소에 있고, 여기는 그 문서를 보는 자리의 것
 * (보기 모드·과거 판·커서·미리보기·위젯·접힘 표시)만 갖는다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Columns2, Ellipsis, Eye, ListTree, Pencil, SlidersHorizontal, SmilePlus } from "lucide-react";
import type { ChangeSet } from "@codemirror/state";
import { blockRange, dailyOfPath, friendlyDate, headings, parseFrontmatter, stripMd, workspaceOf, type DailyLookup, type DailyNote } from "@keyring-notes/core";
import { api, type CommitInfo, type SourcesInfo } from "./api";
import { confirmDialog } from "./dialog";
import { Editor, type EditorHandle, type LinkCandidate } from "./Editor";
import { enhance } from "./enhance";
import { onFoldsChange } from "./folds";
import { fmtDateTime, t } from "./i18n";
import { DocIcon } from "./IconPicker";
import { References } from "./Links";
import { LinkResolver, renderMarkdown, type Rendered } from "./markdown";
import { docKeyOf, type DocEntry } from "./openDocs";
import { shownModeOf, type ViewMode } from "./panes";
import type { Prefs } from "./prefs";
import { applyPreviewFolds, revealInPreview, togglePreviewFold } from "./previewFolds";
import { selectPreviewBody, takesPreviewSelectAll } from "./previewSelect";
import { previewFoldSource, previewPlan, usePreviewSource } from "./previewSource";
import { RenderBoundary } from "./RenderBoundary";
import { safeDecode } from "./safeDecode";
import { formatCombo } from "./shortcuts";
import { tipProps } from "./Tooltip";
import { crumbNodes } from "./topbar";
import { invalidNameReason, stemOf } from "./Tree";
import { IconButton, Segmented } from "./ui";
import { Widget } from "./Widget";
import { withoutWorkspaceBacklinks } from "./workspaceNote";
import { isAppField } from "./childSortUi";
import { editorAutoFocus } from "./editorFocus";
import { isTouch } from "./touch";
import { TitleDraft, type TitleHandle, type TitleOutcome } from "./titleEdit";
import { DRAG_REGION } from "./windowChrome";
import { flushDataFiles } from "./widgets/dataFile";
import { PreviewKeyringWidget } from "./widgets/PreviewKeyringWidget";

export interface RevisionView {
  /** 이 과거 판의 문서. 칸이 다른 문서로 바뀌면 버린다 */
  path: string;
  commit: CommitInfo;
  content: string | null;
}

/** 열면서 갈 자리(제목·블록 링크, 검색 결과의 줄) */
export interface PendingAnchor {
  path: string;
  heading?: string;
  block?: string;
  line?: number;
  text?: string;
}

/** 미리보기가 안 보이는 칸의 렌더 결과(위젯 자리도 없다) */
const NO_PREVIEW: Rendered = { html: "", widgets: [], keyringWidgets: [] };

/** 칸이 밖(링크 따라가기·개요, 탭 닫기 전 제목 확정)에 내주는 동작 */
export interface PaneHandle extends TitleHandle {
  scrollToAnchor(anchor: { heading?: string; block?: string }): void;
}

/** 문서 초안의 속성(프런트매터)·속성 개수·아이콘 */
export function docMeta(draft: string): { fm: Record<string, unknown> | null; propCount: number; icon: string | null } {
  const fm = parseFrontmatter(draft).data;
  return {
    fm,
    propCount: fm ? Object.keys(fm).filter((k) => !isAppField(k)).length : 0,
    icon: typeof fm?.icon === "string" && fm.icon.trim() ? fm.icon.trim() : null,
  };
}

/** Workspace 가 칸마다 똑같이 넘기는 값·동작 묶음 */
export interface PaneContext {
  prefs: Prefs;
  lang: string;
  local: boolean;
  /** 좁은 화면(800px 이하) */
  narrow: boolean;
  /** 모든 워크스페이스 모드: 브레드크럼에 워크스페이스 칸을 남긴다(crumbNodes) */
  allWorkspaces: boolean;
  /** 사이드바를 접어 브레드크럼 첫 칸에 둘 워크스페이스 전환기(칸 id 를 받는다. 아니면 null — switcherSpot) */
  wsSwitcher: ((pane: string) => ReactNode) | null;
  resolver: LinkResolver;
  resolverRef: { current: LinkResolver };
  daily: DailyLookup;
  linkCandidates: LinkCandidate[];
  vaultVersion: number;
  assetVersion: number;
  iconOf: (p: string) => string | null;
  docLabel: (path: string, opts?: { plain?: boolean }) => ReactNode;
  keyOf: (id: string) => string | undefined;
  open: (path: string, opts?: { newTab?: boolean; pane?: string }) => Promise<void>;
  openNode: (node: string) => void;
  load: (path: string) => Promise<boolean>;
  save: (path: string, opts?: { auto?: boolean }) => Promise<boolean>;
  /** 이 칸의 에디터에서 포커스가 빠졌다(이탈 저장). 같은 문서를 연 다른 칸의 에디터로 간 것이면 저장하지 않는다 */
  onEditorBlur: (pane: string, path: string) => void;
  /** 에디터가 친 초안. docKey 는 그 에디터의 판 — 저장소의 판과 다르면(다시 읽은 직후의 옛 뷰) 버린다 */
  onDraft: (path: string, draft: string, docKey: string) => void;
  /** 이 칸에서 생긴 에디터 변경(같은 문서를 연 다른 칸에 전달) */
  onChanges: (pane: string, path: string, changes: ChangeSet, docKey: string) => void;
  uploadFiles: (files: File[], from: string) => Promise<string[]>;
  renameNode: (node: string, name: string) => Promise<boolean>;
  /** 제목 칸에 입력했다(확정 전). 비어 있는 새 노트 지우기에서 손댄 노트로 친다 */
  typedNote: (path: string) => void;
  /** 제목 칸에서 Esc 로 원래 이름에 돌아갔다 — 입력만으로 손댄 새 노트면 다시 지울 수 있게 한다(emptyNote.ts 의 CreatedNotes) */
  untypedNote: (path: string) => void;
  setIconPick: (p: { x: number; y: number; node: string }) => void;
  followLinkEl: (a: HTMLAnchorElement, mod: boolean) => void;
  onWidgetChanged: (path: string) => void;
  showRight: (tab: Prefs["rightTab"]) => void;
  toggleRight: (tab?: Prefs["rightTab"]) => void;
  /** 오른쪽 패널 상태(활성 칸의 문서 것) */
  propsShown: boolean;
  rightOpen: boolean;
  linkCount: number;
  setRevision: (pane: string, r: RevisionView | null) => void;
  saveConflictCopy: (path: string) => Promise<void>;
  rollback: (pane: string) => Promise<void>;
  setMode: (pane: string, m: ViewMode) => void;
  setCursor: (pane: string, c: { line: number; col: number }) => void;
  setDocMenu: (at: { x: number; y: number }) => void;
  dailyStep: (dir: -1 | 1) => void;
  /** w: 그 워크스페이스로(없으면 보기에 따라 — 모든 워크스페이스 보기는 고른다) */
  openDaily: (offset?: number, w?: string) => void;
  clearTitleFocus: () => void;
  setPendingAnchor: (a: PendingAnchor | null) => void;
}

export interface DocPaneProps {
  /** 칸 id(panes.ts) */
  pane: string;
  entry: DocEntry;
  mode: ViewMode;
  focused: boolean;
  revision: RevisionView | null;
  handle: MutableRefObject<EditorHandle | null>;
  paneApi: MutableRefObject<PaneHandle | null>;
  /** 제목 칸에 커서를 둘 신호(활성 칸이고 문서가 맞을 때만, 아니면 0) */
  titleFocus: number;
  /** 활성 칸에만 넘긴다 */
  pendingAnchor: PendingAnchor | null;
  ctx: PaneContext;
  /** 문서 칸 오른쪽에 붙일 것 */
  extra?: ReactNode;
}

/**
 * 문서 위 큰 제목 칸: 고치고 Enter나 포커스 이탈 때 노드 이름을 바꾼다(노트와 하위를 같이). 앞에 아이콘(누르면 고르기).
 * 데일리 노트는 날짜 부분을 고정된 앞머리(흐린 글자)로 보이고 그 뒤 제목만 고친다. 날짜를 누르면 전체 이름을 고친다.
 * 키보드로 닫거나 갈아 끼우면 blur 없이 칸이 사라지거나 다른 노트를 보이므로, Workspace 가 그 전에 handle 로 확정을 부른다(titleEdit.ts).
 * 그 밖의 길(탭 옮기기·칸 합치기 등)로 칸이 다른 노트로 바뀌거나 사라질 때도 확정한다
 */
function InlineTitle({
  path,
  readOnly,
  focusSignal,
  daily,
  icon,
  onIcon,
  onFocused,
  onRename,
  onTyped,
  onUntyped,
  onDone,
  handle,
}: {
  path: string;
  readOnly: boolean;
  focusSignal: number;
  daily: DailyNote | null;
  icon: string | null;
  onIcon?: (at: { x: number; y: number }) => void;
  onFocused: () => void;
  onRename: (path: string, stem: string) => Promise<boolean>;
  /** 칸의 글을 고쳤다(확정 전). 키보드로 탭을 닫으면 blur 없이 칸이 사라져 commit 이 돌지 않는다 */
  onTyped: (path: string) => void;
  /** Esc 로 원래 이름에 돌아갔다 — 입력만으로 손댄 것이었으면 되돌린다 */
  onUntyped: (path: string) => void;
  onDone: () => void;
  /** 닫기 전에 Workspace 가 부르는 확정(PaneHandle 로 나간다) */
  handle: MutableRefObject<TitleHandle | null>;
}) {
  const stem = stemOf(path);
  const [full, setFull] = useState(false);
  const split = !!daily && !full;
  const initial = split ? daily!.title : stem;
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  /** 아직 반영 안 한 고침(어느 노트의 제목을 무슨 이름으로)과 진행 중인 이름 바꾸기 */
  const [draft] = useState(() => new TitleDraft());
  useEffect(() => setV(initial), [initial]);
  useEffect(() => setFull(false), [path]);
  useEffect(() => {
    if (!focusSignal) return;
    // 에디터가 열리며 포커스를 가져간 뒤에 잡는다
    const timer = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
      onFocused();
    }, 30);
    return () => clearTimeout(timer);
  }, [focusSignal]);
  /** 칸의 글 → 새 이름(확장자 없이) */
  const nameOf = (text: string) => (split ? (text.trim() ? `${daily!.datePart}${daily!.sep || " "}${text.trim()}` : daily!.datePart) : text.trim());
  const next = nameOf(v);
  const err = next === stem ? null : invalidNameReason(next);
  // 전체 이름을 고치다 날짜를 지우면 데일리 노트가 아니게 된다
  const warn = daily && full && !next.startsWith(daily.datePart) ? t("title.dailyWarn") : null;
  /** shown: 칸이 보이는 노트. 칸이 사라지며 하는 확정은 null(실패해도 입력을 남기지 않는다) */
  const commit = async (shown: string | null = path): Promise<TitleOutcome> => {
    // 노트가 바뀌며 포커스를 잃으면 이미 새 노트의 path 로 그려진 뒤라, 고친 글이 속한 노트는 입력 때 적어 둔 것을 따른다
    const o = await draft.commit(shown, { invalid: invalidNameReason, rename: onRename });
    // 잘못된 이름(칸에 오류)과 실패한 이름 바꾸기(알림은 이름 바꾸기가 띄운다)는 입력을 칸에 남긴다 — 확정 대기로 남아 닫기가 다시 확정한다
    const kept = draft.pending() === path;
    if (!kept && o.kind !== "renamed") setV(initial);
    if (!kept) setFull(false);
    return o;
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const [mine] = useState<TitleHandle>(() => ({
    titlePending: () => draft.pending(),
    commitTitle: async (p) => {
      if (draft.pending() !== p) return { kind: "none", path: p };
      const o = await commitRef.current();
      // 닫지 않고 남긴 칸: 고치거나 Esc 를 누를 수 있게 칸으로 돌아간다
      if (o.kind === "invalid" || o.kind === "failed") ref.current?.focus();
      return o;
    },
  }));
  handle.current = mine;
  // 칸이 다른 노트를 보이게 됐는데(탭 옮기기 등) 앞 노트의 입력이 남아 있으면 바로 확정한다 — 칸에는 이미 새 노트의 이름이 보인다
  useEffect(() => {
    draft.shows(path);
    const p = draft.pending();
    if (p && p !== path) void commitRef.current();
  }, [path, draft]);
  // 칸이 사라질 때(탭 옮기기·칸 합치기 등 Workspace 가 미리 확정하지 않은 길): 남은 입력을 확정하고 핸들을 비운다.
  // 보여 줄 칸이 없으니 실패해도 입력을 남기지 않는다(알림만 남는다). 핸들은 확정이 끝난 뒤에 비운다 —
  // 그 사이 다른 칸의 닫기가 이 이름 바꾸기를 기다리게. 비우지 않으면 Workspace 의 titleHandles() 가 사라진 칸에 계속 닿는다
  useEffect(() => {
    handle.current = mine;
    return () => {
      const clear = () => {
        if (handle.current === mine) handle.current = null;
      };
      if (draft.pending()) void commitRef.current(null).finally(clear);
      else clear();
    };
  }, [draft, handle, mine]);
  return (
    <div className="inline-title-wrap">
      <div className="inline-title-row">
        {onIcon || icon ? (
          <button
            type="button"
            className={`title-icon${icon ? "" : " empty"}`}
            aria-disabled={!onIcon || undefined}
            {...tipProps({ label: icon ? t("title.changeIcon") : t("title.addIcon") })}
            aria-label={icon ? t("title.changeIconOf", { icon }) : t("title.addIcon")}
            onClick={(e) => {
              if (!onIcon) return;
              const r = e.currentTarget.getBoundingClientRect();
              onIcon({ x: r.left, y: r.bottom + 4 });
            }}
          >
            {icon ?? <SmilePlus size={22} strokeWidth={1.5} aria-hidden />}
          </button>
        ) : null}
        {split && (
          <button
            type="button"
            className="title-date"
            disabled={readOnly}
            {...tipProps({ label: t("title.dailyDate") })}
            onClick={() => {
              setFull(true);
              setTimeout(() => ref.current?.focus(), 0);
            }}
          >
            {daily!.datePart}
          </button>
        )}
        <input
          ref={ref}
          className="inline-title"
          value={v}
          readOnly={readOnly}
          placeholder={split ? t("title.dailyPlaceholder") : undefined}
          aria-label={split ? t("title.dailyLabel") : t("title.label")}
          aria-invalid={!!err}
          spellCheck={false}
          onChange={(e) => {
            setV(e.target.value);
            draft.typed({ path, name: nameOf(e.target.value) });
            onTyped(path);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" || (e.key === "ArrowDown" && !err)) {
              e.preventDefault();
              void commit().then(onDone);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              // 이 칸이 이번에 입력했을 때만 손댐을 되돌린다 — 입력하지 않은 칸의 Esc 는 취소할 입력이 없다
              if (draft.cancel() === path) onUntyped(path);
              setV(initial);
              setFull(false);
              onDone();
            }
          }}
        />
      </div>
      {(err || warn) && (
        <p className={err ? "inline-title-error" : "inline-title-warn"} role="alert">
          {err ?? warn}
        </p>
      )}
    </div>
  );
}

/**
 * 미리보기 본문: 노트를 HTML 로 그리고 그 안의 자리(수식·다이어그램·문서 임베드·위젯·접기)를 채운다.
 * 그리기와 채우기를 DocPane 이 아니라 여기에 둔다 — 여기서 던진 예외는 이 컴포넌트를 감싼 RenderBoundary 에서 멈춰
 * 편집기·제목·다른 칸이 남는다. DocPane 이 직접 그리면 DocPane 이 통째로 내려간다(경계는 자식이 던진 것만 받는다).
 */
function PreviewBody({
  source,
  doc,
  mode,
  revision,
  handle,
  ctx,
  bodyRef,
  drawnRef,
  foldVersion,
  onWrote,
}: {
  /** 그릴 본문. 미리보기가 안 보이는 칸은 null(previewSource.ts) */
  source: string | null;
  doc: DocEntry["doc"];
  mode: ViewMode;
  revision: RevisionView | null;
  handle: MutableRefObject<EditorHandle | null>;
  ctx: PaneContext;
  /** 그린 본문의 DOM(DocPane 이 스크롤·누름 처리에 쓴다). 대체 화면이 떠 있는 동안은 null 이다 */
  bodyRef: RefObject<HTMLDivElement | null>;
  /** 미리보기 DOM 의 줄 번호가 가리키는 본문(DocPane 의 drawnRef) */
  drawnRef: { readonly current: string };
  foldVersion: number;
  /** 미리보기 위젯의 쓰기가 성공했다(previewSource.ts usePreviewSource 의 wrote) */
  onWrote: () => void;
}) {
  const { prefs, resolver } = ctx;
  const [widgetSlots, setWidgetSlots] = useState<HTMLElement[]>([]);
  const [kwSlots, setKwSlots] = useState<HTMLElement[]>([]);
  const rendered = useMemo(
    // 속성 화면이 열려 있으면 미리보기에서는 프런트매터 상자를 빼고 본다(같은 내용을 두 번 보이지 않게)
    () => (source === null ? NO_PREVIEW : renderMarkdown(source, { resolver, docPath: doc.path, hideFrontmatter: !prefs.propsInDoc })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, resolver, doc.path, ctx.assetVersion, prefs.propsInDoc],
  );

  // 수식·다이어그램·문서 임베드는 그린 뒤에 채운다(enhance.ts)
  useEffect(() => {
    if (!bodyRef.current) return;
    return enhance(bodyRef.current, { resolver, docPath: doc.path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode]);

  // 접기: 미리보기에 단추를 달고 기억한 대로 접는다
  useLayoutEffect(() => {
    if (!bodyRef.current || revision) return;
    applyPreviewFolds(bodyRef.current, doc.path, drawnRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode, foldVersion, revision]);

  // innerHTML이 바뀐 뒤 위젯 자리를 찾아 React 포털로 위젯을 그린다.
  useLayoutEffect(() => {
    setWidgetSlots(Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(".widget-slot") ?? []));
    setKwSlots(Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(".kw-slot") ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode]);

  return (
    <>
      <div className="markdown-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: rendered.html }} />
      {widgetSlots.map((el, i) =>
        rendered.widgets[i] === undefined
          ? null
          : createPortal(
              <Widget source={rendered.widgets[i]} onOpen={(p) => void ctx.open(p)} onChanged={ctx.onWidgetChanged} />,
              el,
              `${i}:${rendered.widgets[i]}`,
            ),
      )}
      {kwSlots.map((el, i) => {
        const w = rendered.keyringWidgets[i];
        if (!w) return null;
        // 이력 보기·생성 문서·편집기가 없는 칸에서는 쓰지 않는다(설계 「상태가 바뀌는 길」)
        const ro = !!revision || !!doc.generated || !handle.current;
        return createPortal(
          <PreviewKeyringWidget el={el} body={w.body} line={w.line} readOnly={ro} history={!!revision} owner={doc.path} handle={handle} onWrote={onWrote} />,
          el,
          `${i}:${w.line}:${w.body}`,
        );
      })}
    </>
  );
}

export function DocPane({ pane, entry, mode, focused, revision, handle, paneApi, titleFocus, pendingAnchor, ctx, extra }: DocPaneProps) {
  const { prefs, lang, local } = ctx;
  const { doc, conflict } = entry;
  const live = prefs.live;
  const previewRef = useRef<HTMLDivElement>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  /** 제목 칸의 확정(InlineTitle 이 채운다) */
  const titleHandle = useRef<TitleHandle | null>(null);
  /** 접힌 상태가 바뀔 때 올린다(미리보기를 다시 맞춘다) */
  const [foldVersion, setFoldVersion] = useState(0);
  const [refs, setRefs] = useState<SourcesInfo | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const stateRef = useRef({ mode, revision });
  stateRef.current = { mode, revision };

  const docNode = stripMd(doc.path);
  const isWsDoc = !doc.path.includes("/");
  const docDaily: DailyNote | null = dailyOfPath(doc.path, ctx.daily);
  const { propCount, icon: docIcon } = useMemo(() => docMeta(doc.draft), [doc.draft]);
  const shownMode = shownModeOf(mode, { revision: !!revision, narrow: ctx.narrow });

  // 미리보기가 보일 때(미리보기·나란히 보기) 전체 선택은 이 칸 미리보기 본문만. 편집기에 포커스가 있으면 편집기가 받는다(selectBody). 칸이 여럿이면 지금 칸만
  useEffect(() => {
    if (!focused || shownMode === "edit") return;
    const onKey = (e: KeyboardEvent) => {
      if (!previewRef.current || !takesPreviewSelectAll(e, previewPaneRef.current)) return;
      e.preventDefault();
      selectPreviewBody(previewRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focused, shownMode]);

  // 문서 끝 백링크(설정을 켰을 때만): 이 칸의 문서 것을 따로 받는다
  useEffect(() => {
    if (!prefs.backlinksInDoc || doc.virtual) return setRefs(null);
    let alive = true;
    api
      .sources(doc.path)
      .then((r) => alive && setRefs(withoutWorkspaceBacklinks(r)))
      .catch(() => alive && setRefs(null));
    return () => {
      alive = false;
    };
  }, [prefs.backlinksInDoc, doc.path, doc.virtual, ctx.vaultVersion]);

  // 편집만 보이는 칸은 그리지 않고, 나란히 보기는 입력이 멈춘 뒤 그린다(previewSource.ts)
  const {
    text: previewSource,
    settleNow: settlePreview,
    wrote: previewWrote,
  } = usePreviewSource(
    previewPlan(shownMode, !!revision),
    revision ? `${docKeyOf(doc)}@${revision.commit.rev}` : docKeyOf(doc),
    revision ? (revision.content ?? "") : doc.draft,
  );
  /** 미리보기 DOM 의 줄 번호(data-line·data-task-line)가 가리키는 본문 — 나란히 보기에서 낡은 동안은 지금 초안이 아니다 */
  const drawnRef = useRef("");
  drawnRef.current = previewFoldSource(previewSource, doc.draft);

  /**
   * [[문서#제목]]·[[문서#^블록]]: 그 위치로 가서 잠깐 표시한다. 접혀 있으면 편다.
   * 편집 화면이면 에디터의 그 줄로, 미리보기면 미리보기의 그 블록으로.
   */
  const scrollToAnchor = (anchor: { heading?: string; block?: string }) => {
    const cur = docRef.current;
    const { mode: m, revision: rev } = stateRef.current;
    if (m !== "preview" && !rev) {
      let line = 0;
      if (anchor.block) line = blockRange(cur.draft, anchor.block)?.start ?? 0;
      else line = headings(cur.draft).find((h) => h.text.toLowerCase() === (anchor.heading ?? "").toLowerCase())?.line ?? 0;
      if (line) return handle.current?.gotoLine(line);
    }
    const root = previewRef.current;
    if (!root) return;
    const find = () =>
      anchor.block
        ? root.querySelector<HTMLElement>(`[data-block="${CSS.escape(anchor.block)}"]`)
        : root.querySelector<HTMLElement>(`[data-heading="${CSS.escape(anchor.heading ?? "")}"]`);
    let el = find();
    if (!el) return;
    // 접힌 곳 안이면 편다(겹쳐 접힌 것까지)
    for (let i = 0; i < 6 && !stateRef.current.revision && revealInPreview(el, cur.path, drawnRef.current); i++) {
      applyPreviewFolds(root, cur.path, drawnRef.current);
      el = find() ?? el;
    }
    el.scrollIntoView({ block: "start" });
    el.classList.add("anchor-flash");
    setTimeout(() => el!.classList.remove("anchor-flash"), 1600);
  };
  paneApi.current = {
    scrollToAnchor,
    titlePending: () => titleHandle.current?.titlePending() ?? null,
    commitTitle: (p) => titleHandle.current?.commitTitle(p) ?? Promise.resolve({ kind: "none", path: p }),
  };

  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
    const fold = (e.target as HTMLElement).closest<HTMLElement>(".pv-fold");
    if (fold && !revision) {
      e.preventDefault();
      togglePreviewFold(doc.path, drawnRef.current, Number(fold.dataset.foldLine));
      return;
    }
    const box = (e.target as HTMLElement).closest<HTMLInputElement>("input.task[data-task-line]");
    if (box) {
      // 체크박스는 편집 중인 초안을 바꾼다(저장해야 반영). 과거 버전 보기에서는 바꾸지 않는다.
      if (revision || !handle.current) {
        e.preventDefault();
        return;
      }
      // 그린 때의 줄 글과 지금 줄이 다르면 편집기가 쓰지 않는다 — 체크 표시도 되돌린다
      const line = Number(box.dataset.taskLine);
      if (!handle.current.toggleTask(line, box.checked, drawnRef.current.split("\n")[line - 1])) e.preventDefault();
      else previewWrote();
      return;
    }
    // 각주 등 문서 안 앵커(#fn1): 주소의 #/문서 경로를 건드리지 않고 그 위치로 스크롤
    const localA = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]:not([data-wikilink])');
    if (localA) {
      const id = safeDecode(localA.getAttribute("href")!.slice(1));
      if (!id.startsWith("/")) {
        e.preventDefault();
        const el = id ? previewRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null;
        el?.scrollIntoView({ block: "center" });
        return;
      }
    }
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wikilink]");
    if (!a) return;
    e.preventDefault();
    ctx.followLinkEl(a, e.ctrlKey || e.metaKey);
  };

  // 접기: 에디터·개요·다른 칸에서 바꾸면 미리보기가 따라간다(맞추는 것은 PreviewBody)
  useEffect(() => onFoldsChange((path) => path === docRef.current.path && setFoldVersion((v) => v + 1)), []);

  // 다른 문서의 제목·블록 링크나 검색 결과로 왔으면 그 위치로
  useEffect(() => {
    if (!pendingAnchor || doc.path !== pendingAnchor.path) return;
    const anchor = pendingAnchor;
    ctx.setPendingAnchor(null);
    // 그린 직후(임베드·다이어그램이 자리를 잡을 틈을 조금 두고)
    setTimeout(() => {
      if (anchor.line) handle.current?.gotoLine(anchor.line, anchor.text);
      else scrollToAnchor(anchor);
    }, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, pendingAnchor]);

  /** 빵부스러기: 상위 노드들(누르면 그 노드를 연다) */
  const crumbs = crumbNodes(docNode, ctx.allWorkspaces);
  // 좁은 화면에서는 빵부스러기가 옆으로 밀린다 — 처음과 노트가 바뀔 때 오른쪽 끝(지금 노트)을 보인다
  const crumbsRef = useRef<HTMLElement>(null);
  const crumbsKey = crumbs.join("/");
  useLayoutEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [doc.path, crumbsKey]);
  const toggleKey = formatCombo(ctx.keyOf("toggle-mode"));

  return (
    <>
      {/* 좁은 화면에는 위쪽 탭 줄이 없어 이 줄이 창 맨 위다 — 창을 여기서 끈다 */}
      <header className="doc-head" {...(ctx.narrow ? DRAG_REGION : {})}>
        <nav ref={crumbsRef} className="crumbs" aria-label={t("doc.crumbs")}>
          {ctx.wsSwitcher && (
            <span className="crumb">
              {ctx.wsSwitcher(pane)}
              <ChevronRight size={12} aria-hidden />
            </span>
          )}
          {crumbs.map((c) => (
            <span key={c} className="crumb">
              {/* 워크스페이스 칸(모든 워크스페이스 모드)은 그 노트를 열지 않으므로(workspaceNote.ts) 글자만 */}
              {c.includes("/") ? (
                <button className="crumb-btn" onClick={() => ctx.openNode(c)}>
                  {ctx.iconOf(`${c}.md`) && <DocIcon icon={ctx.iconOf(`${c}.md`)} />}
                  {stemOf(c)}
                </button>
              ) : (
                <span className="crumb-text">
                  {ctx.iconOf(`${c}.md`) && <DocIcon icon={ctx.iconOf(`${c}.md`)} />}
                  {c}
                </span>
              )}
              <ChevronRight size={12} aria-hidden />
            </span>
          ))}
          <span className="crumb current">{stemOf(doc.path)}</span>
        </nav>
        {docDaily && (
          <span className="daily-nav" aria-label={t("daily.nav")}>
            <IconButton icon={ChevronLeft} label={t("cmd.dailyPrev")} onClick={() => ctx.dailyStep(-1)} size={16} />
            <button
              type="button"
              className="daily-nav-date"
              {...tipProps({ label: t("cmd.daily") })}
              onClick={() => ctx.openDaily(0, workspaceOf(doc.path) ?? undefined)}
            >
              {friendlyDate(docDaily.date, new Date(), lang)}
            </button>
            <IconButton icon={ChevronRight} label={t("cmd.dailyNext")} onClick={() => ctx.dailyStep(1)} size={16} />
          </span>
        )}
        <div className="doc-tools">
          <Segmented
            label={t("doc.view")}
            value={shownMode}
            onChange={(m) => ctx.setMode(pane, m)}
            options={[
              {
                value: "edit",
                label: <Pencil size={15} aria-label={t("cmd.modeEditShort")} />,
                title: `${t("cmd.modeEditShort")} (${toggleKey})`,
              },
              // 좁은 화면에는 나란히 놓을 폭이 없다(shownModeOf)
              ...(ctx.narrow
                ? []
                : [{ value: "split" as const, label: <Columns2 size={15} aria-label={t("cmd.modeSplitShort")} />, title: t("cmd.modeSplit") }]),
              {
                value: "preview",
                label: <Eye size={15} aria-label={t("cmd.modePreviewShort")} />,
                title: `${t("cmd.modePreviewShort")} (${toggleKey})`,
              },
            ]}
          />
          <IconButton
            icon={SlidersHorizontal}
            label={propCount ? t("doc.propsCount", { count: propCount }) : t("doc.props")}
            active={focused && ctx.propsShown}
            onClick={() => ctx.toggleRight("props")}
            size={16}
          />
          <IconButton
            icon={ListTree}
            label={t("doc.rightPanel")}
            keys={ctx.keyOf("right")}
            active={ctx.rightOpen}
            badge={focused && !ctx.rightOpen && ctx.linkCount ? ctx.linkCount : undefined}
            onClick={() => ctx.toggleRight()}
            size={16}
          />
          <IconButton
            icon={Ellipsis}
            label={t("doc.menu")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              ctx.setDocMenu({ x: r.right - 220, y: r.bottom + 4 });
            }}
            size={16}
          />
        </div>
      </header>

      {doc.cachedOffline && <div className="banner info">{t("doc.cachedOffline")}</div>}
      {doc.virtual && <div className="banner info">{t("node.emptyBanner")}</div>}
      {doc.generated && <div className="banner generated">{local ? t("doc.generatedApp") : t("doc.generatedServer")}</div>}
      {conflict && (
        <div className="banner conflict" role="alert">
          {conflict.currentHash === null ? t("doc.deletedElsewhere") : local ? t("doc.conflictLocal") : t("doc.conflictServer")}
          <button onClick={() => void ctx.saveConflictCopy(doc.path)}>{t("doc.saveCopy")}</button>
          {conflict.currentHash !== null && (
            <button
              onClick={async () => (await confirmDialog(local ? t("doc.reloadAskLocal") : t("doc.reloadAskServer"), t("doc.reload"))) && ctx.load(doc.path)}
            >
              {local ? t("doc.reloadLocal") : t("doc.reloadServer")}
            </button>
          )}
        </div>
      )}
      {revision && (
        <div className="banner revision">
          {t("history.viewing", { rev: revision.commit.rev.slice(0, 7), author: revision.commit.author, date: fmtDateTime(revision.commit.date) })}
          {revision.content !== null && <button onClick={() => void ctx.rollback(pane)}>{t("history.rollbackThis")}</button>}
          <button onClick={() => ctx.setRevision(pane, null)}>{t("common.close")}</button>
        </div>
      )}

      <div className="doc-area">
        <div
          className={`panes mode-${shownMode}${prefs.readableWidth ? " readable" : ""} font-${prefs.editorFont}`}
          style={{ ["--editor-size" as string]: `${prefs.editorSize}px` }}
        >
          <div
            className="pane edit-pane"
            onMouseDown={(e) => {
              // 제목·본문 바깥(본문 아래 여백, 좌우 여백)을 눌러도 본문에 커서를 둔다. 안 그러면 포커스가 칸으로 가서 친 글이 사라진다
              if (e.button !== 0 || (e.target as HTMLElement).closest(".inline-title-wrap, .cm-editor, .properties, button, input, a")) return;
              if (doc.generated || revision || !handle.current?.focusAt(e.clientX, e.clientY)) return;
              e.preventDefault();
            }}
          >
            <div className="page">
              <InlineTitle
                path={doc.path}
                readOnly={doc.generated || !!revision || isWsDoc}
                focusSignal={titleFocus}
                daily={docDaily}
                icon={docIcon}
                onIcon={doc.generated || revision ? undefined : (at) => ctx.setIconPick({ ...at, node: docNode })}
                onFocused={ctx.clearTitleFocus}
                onRename={(p, stem) => ctx.renameNode(stripMd(p), stem)}
                onTyped={ctx.typedNote}
                onUntyped={ctx.untypedNote}
                onDone={() => handle.current?.focus()}
                handle={titleHandle}
              />
              <Editor
                docKey={docKeyOf(doc)}
                initial={doc.draft}
                onChange={(draft, key) => ctx.onDraft(doc.path, draft, key)}
                onChanges={(changes, key) => ctx.onChanges(pane, doc.path, changes, key)}
                onSave={() => {
                  // 편집기의 Mod+S: 노트와 그림(데이터 파일)을 함께
                  void ctx.save(doc.path);
                  void flushDataFiles();
                }}
                linkCandidates={() => ctx.linkCandidates}
                handle={handle}
                onFiles={(files) => ctx.uploadFiles(files, doc.path)}
                live={live}
                lineNumbers={prefs.lineNumbers}
                foldFrontmatter
                onShowProps={() => ctx.showRight("props")}
                foldKey={revision ? undefined : doc.path}
                renderContext={() => ({ resolver: ctx.resolverRef.current, docPath: docRef.current.path, onLink: ctx.followLinkEl })}
                readOnly={doc.generated}
                autoFocus={editorAutoFocus({ touch: isTouch(), focused })}
                onCursor={(line, col) => ctx.setCursor(pane, { line, col })}
                onBlur={() => ctx.onEditorBlur(pane, doc.path)}
              />
            </div>
          </div>
          <div
            className="pane preview-pane"
            ref={previewPaneRef}
            onClick={onPreviewClick}
            // 낡은 미리보기의 줄 번호로 편집기를 고치지 않게(previewSource.ts usePreviewSource)
            onPointerDownCapture={settlePreview}
            onFocusCapture={settlePreview}
          >
            <div className="page">
              {(mode === "preview" || revision) && (
                <h1 className="inline-title static">
                  {prefs.showIcons && <DocIcon icon={docIcon} />}
                  {ctx.docLabel(doc.path, { plain: true })}
                </h1>
              )}
              <RenderBoundary resetKey={doc.path} source={previewSource ?? ""}>
                <PreviewBody
                  source={previewSource}
                  doc={doc}
                  mode={mode}
                  revision={revision}
                  handle={handle}
                  ctx={ctx}
                  bodyRef={previewRef}
                  drawnRef={drawnRef}
                  foldVersion={foldVersion}
                  onWrote={previewWrote}
                />
              </RenderBoundary>
              {prefs.backlinksInDoc && !revision && refs && (
                <References
                  refs={refs}
                  onOpen={(p, anchor) => {
                    if (anchor) ctx.setPendingAnchor({ path: p, ...(anchor.startsWith("^") ? { block: anchor.slice(1) } : { heading: anchor.toLowerCase() }) });
                    void ctx.open(p);
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {extra}
      </div>
    </>
  );
}
