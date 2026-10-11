/**
 * 가운데 칸 하나: 문서 머리(빵부스러기·보기 모드·도구)·배너·제목·에디터·미리보기.
 * 칸마다 하나씩 그린다. 문서의 원본(초안·저장 상태·충돌)은 Workspace 의 저장소에 있고, 여기는 그 문서를 보는 자리의 것
 * (보기 모드·과거 판·커서·미리보기·위젯·접힘 표시)만 갖는다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Columns2, Ellipsis, Eye, ListTree, Pencil, SlidersHorizontal, SmilePlus } from "lucide-react";
import type { ChangeSet } from "@codemirror/state";
import { blockRange, dailyOfPath, friendlyDate, headings, parseFrontmatter, stripMd, type DailyLookup, type DailyNote } from "@keyring-notes/core";
import { api, type CommitInfo, type SourcesInfo } from "./api";
import { confirmDialog } from "./dialog";
import { Editor, type EditorHandle, type LinkCandidate } from "./Editor";
import { enhance } from "./enhance";
import { onFoldsChange } from "./folds";
import { fmtDateTime, t } from "./i18n";
import { DocIcon } from "./IconPicker";
import { References } from "./Links";
import { LinkResolver, renderMarkdown } from "./markdown";
import type { DocEntry } from "./openDocs";
import type { ViewMode } from "./panes";
import type { Prefs } from "./prefs";
import { applyPreviewFolds, revealInPreview, togglePreviewFold } from "./previewFolds";
import { formatCombo } from "./shortcuts";
import { tipProps } from "./Tooltip";
import { invalidNameReason, stemOf } from "./Tree";
import { IconButton, Segmented } from "./ui";
import { Widget } from "./Widget";

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

/** 칸이 밖(링크 따라가기·개요)에 내주는 동작 */
export interface PaneHandle {
  scrollToAnchor(anchor: { heading?: string; block?: string }): void;
}

/** 문서 초안의 속성(프런트매터)·속성 개수·아이콘 */
export function docMeta(draft: string): { fm: Record<string, unknown> | null; propCount: number; icon: string | null } {
  const block = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(draft)?.[0] ?? "";
  const fm = block ? parseFrontmatter(block).data : null;
  return { fm, propCount: fm ? Object.keys(fm).length : 0, icon: typeof fm?.icon === "string" && fm.icon.trim() ? fm.icon.trim() : null };
}

/** Workspace 가 칸마다 똑같이 넘기는 값·동작 묶음 */
export interface PaneContext {
  prefs: Prefs;
  lang: string;
  local: boolean;
  resolver: LinkResolver;
  resolverRef: { current: LinkResolver };
  daily: DailyLookup;
  linkCandidates: LinkCandidate[];
  vaultVersion: number;
  assetVersion: number;
  iconOf: (p: string) => string | null;
  docLabel: (path: string, opts?: { plain?: boolean }) => ReactNode;
  keyOf: (id: string) => string | undefined;
  open: (path: string, opts?: { newTab?: boolean; pane?: number }) => Promise<void>;
  openNode: (node: string) => void;
  load: (path: string) => Promise<boolean>;
  save: (path: string, opts?: { auto?: boolean }) => Promise<boolean>;
  onDraft: (path: string, draft: string) => void;
  /** 이 칸에서 생긴 에디터 변경(같은 문서를 연 다른 칸에 전달) */
  onChanges: (pane: number, path: string, changes: ChangeSet, docKey: string) => void;
  uploadFiles: (files: File[], from: string) => Promise<string[]>;
  renameNode: (node: string, name: string) => Promise<boolean>;
  setIconPick: (p: { x: number; y: number; node: string }) => void;
  followLinkEl: (a: HTMLAnchorElement, mod: boolean) => void;
  onWidgetChanged: (path: string) => void;
  showRight: (tab: Prefs["rightTab"]) => void;
  toggleRight: (tab?: Prefs["rightTab"]) => void;
  /** 오른쪽 패널 상태(활성 칸의 문서 것) */
  propsShown: boolean;
  rightOpen: boolean;
  linkCount: number;
  setRevision: (pane: number, r: RevisionView | null) => void;
  saveConflictCopy: (path: string) => Promise<void>;
  rollback: (pane: number) => Promise<void>;
  setMode: (pane: number, m: ViewMode) => void;
  setCursor: (pane: number, c: { line: number; col: number }) => void;
  setDocMenu: (at: { x: number; y: number }) => void;
  dailyStep: (dir: -1 | 1) => void;
  openDaily: (offset?: number) => void;
  clearTitleFocus: () => void;
  setPendingAnchor: (a: PendingAnchor | null) => void;
}

export interface DocPaneProps {
  pane: number;
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
  onDone,
}: {
  path: string;
  readOnly: boolean;
  focusSignal: number;
  daily: DailyNote | null;
  icon: string | null;
  onIcon?: (at: { x: number; y: number }) => void;
  onFocused: () => void;
  onRename: (stem: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const stem = stemOf(path);
  const [full, setFull] = useState(false);
  const split = !!daily && !full;
  const initial = split ? daily!.title : stem;
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
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
  const commit = async () => {
    if (busy || next === stem) {
      setV(initial);
      setFull(false);
      return;
    }
    if (err) return;
    setBusy(true);
    const ok = await onRename(next);
    setBusy(false);
    if (!ok) setV(initial);
    setFull(false);
  };
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
          onChange={(e) => setV(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" || (e.key === "ArrowDown" && !err)) {
              e.preventDefault();
              void commit().then(onDone);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
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

export function DocPane({ pane, entry, mode, focused, revision, handle, paneApi, titleFocus, pendingAnchor, ctx, extra }: DocPaneProps) {
  const { prefs, resolver, lang, local } = ctx;
  const { doc, conflict } = entry;
  const live = prefs.live;
  const previewRef = useRef<HTMLDivElement>(null);
  const [widgetSlots, setWidgetSlots] = useState<HTMLElement[]>([]);
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
  const shownMode = revision ? "preview" : mode;

  // 문서 끝 백링크(설정을 켰을 때만): 이 칸의 문서 것을 따로 받는다
  useEffect(() => {
    if (!prefs.backlinksInDoc || doc.virtual) return setRefs(null);
    let alive = true;
    api
      .sources(doc.path)
      .then((r) => alive && setRefs(r))
      .catch(() => alive && setRefs(null));
    return () => {
      alive = false;
    };
  }, [prefs.backlinksInDoc, doc.path, doc.virtual, ctx.vaultVersion]);

  const previewSource = revision ? (revision.content ?? "") : doc.draft;
  const rendered = useMemo(
    // 속성 화면이 열려 있으면 미리보기에서는 프런트매터 상자를 빼고 본다(같은 내용을 두 번 보이지 않게)
    () => renderMarkdown(previewSource, { resolver, docPath: doc.path, hideFrontmatter: !prefs.propsInDoc }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewSource, resolver, doc.path, ctx.assetVersion, prefs.propsInDoc],
  );

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
    for (let i = 0; i < 6 && !stateRef.current.revision && revealInPreview(el, cur.path, cur.draft); i++) {
      applyPreviewFolds(root, cur.path, cur.draft);
      el = find() ?? el;
    }
    el.scrollIntoView({ block: "start" });
    el.classList.add("anchor-flash");
    setTimeout(() => el!.classList.remove("anchor-flash"), 1600);
  };
  paneApi.current = { scrollToAnchor };

  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
    const fold = (e.target as HTMLElement).closest<HTMLElement>(".pv-fold");
    if (fold && !revision) {
      e.preventDefault();
      togglePreviewFold(doc.path, doc.draft, Number(fold.dataset.foldLine));
      return;
    }
    const box = (e.target as HTMLElement).closest<HTMLInputElement>("input.task[data-task-line]");
    if (box) {
      // 체크박스는 편집 중인 초안을 바꾼다(저장해야 반영). 과거 버전 보기에서는 바꾸지 않는다.
      if (revision || !handle.current) {
        e.preventDefault();
        return;
      }
      handle.current.toggleTask(Number(box.dataset.taskLine), box.checked);
      return;
    }
    // 각주 등 문서 안 앵커(#fn1): 주소의 #/문서 경로를 건드리지 않고 그 위치로 스크롤
    const localA = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]:not([data-wikilink])');
    if (localA) {
      const id = decodeURIComponent(localA.getAttribute("href")!.slice(1));
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

  // 수식·다이어그램·문서 임베드는 그린 뒤에 채운다(enhance.ts)
  useEffect(() => {
    if (!previewRef.current) return;
    return enhance(previewRef.current, { resolver, docPath: doc.path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode]);

  // 접기: 미리보기에 단추를 달고 기억한 대로 접는다. 에디터·개요·다른 칸에서 바꾸면 따라간다
  useEffect(() => onFoldsChange((path) => path === docRef.current.path && setFoldVersion((v) => v + 1)), []);
  useLayoutEffect(() => {
    if (!previewRef.current || revision) return;
    applyPreviewFolds(previewRef.current, doc.path, doc.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode, foldVersion, revision]);

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
  }, [rendered.html, doc.path, pendingAnchor]);

  // innerHTML이 바뀐 뒤 위젯 자리를 찾아 React 포털로 위젯을 그린다.
  useLayoutEffect(() => {
    setWidgetSlots(Array.from(previewRef.current?.querySelectorAll<HTMLElement>(".widget-slot") ?? []));
  }, [rendered.html, mode]);

  /** 빵부스러기: 상위 노드들(누르면 그 노드를 연다) */
  const crumbs = docNode
    .split("/")
    .slice(0, -1)
    .map((_, i, all) => all.slice(0, i + 1).join("/"));
  const toggleKey = formatCombo(ctx.keyOf("toggle-mode"));

  return (
    <>
      <header className="doc-head">
        <nav className="crumbs" aria-label={t("doc.crumbs")}>
          {crumbs.map((c) => (
            <span key={c} className="crumb">
              <button className="crumb-btn" onClick={() => ctx.openNode(c)}>
                {ctx.iconOf(`${c}.md`) && <DocIcon icon={ctx.iconOf(`${c}.md`)} />}
                {stemOf(c)}
              </button>
              <ChevronRight size={12} aria-hidden />
            </span>
          ))}
          <span className="crumb current">{stemOf(doc.path)}</span>
        </nav>
        {docDaily && (
          <span className="daily-nav" aria-label={t("daily.nav")}>
            <IconButton icon={ChevronLeft} label={t("cmd.dailyPrev")} onClick={() => ctx.dailyStep(-1)} size={16} />
            <button type="button" className="daily-nav-date" {...tipProps({ label: t("cmd.daily") })} onClick={() => ctx.openDaily(0)}>
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
              { value: "split", label: <Columns2 size={15} aria-label={t("cmd.modeSplitShort")} />, title: t("cmd.modeSplit") },
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
            badge={!(focused && ctx.propsShown) && propCount ? propCount : undefined}
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
          <div className="pane edit-pane">
            <div className="page">
              <InlineTitle
                path={doc.path}
                readOnly={doc.generated || !!revision || isWsDoc}
                focusSignal={titleFocus}
                daily={docDaily}
                icon={docIcon}
                onIcon={doc.generated || revision ? undefined : (at) => ctx.setIconPick({ ...at, node: docNode })}
                onFocused={ctx.clearTitleFocus}
                onRename={(stem) => ctx.renameNode(docNode, stem)}
                onDone={() => handle.current?.focus()}
              />
              <Editor
                docKey={`${doc.path}#${doc.seq}`}
                initial={doc.draft}
                onChange={(draft) => ctx.onDraft(doc.path, draft)}
                onChanges={(changes, key) => ctx.onChanges(pane, doc.path, changes, key)}
                onSave={() => void ctx.save(doc.path)}
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
                autoFocus={focused}
                onCursor={(line, col) => ctx.setCursor(pane, { line, col })}
                onBlur={() => prefs.autosave && void ctx.save(doc.path, { auto: true })}
              />
            </div>
          </div>
          <div className="pane preview-pane" onClick={onPreviewClick}>
            <div className="page">
              {(mode === "preview" || revision) && (
                <h1 className="inline-title static">
                  {prefs.showIcons && <DocIcon icon={docIcon} />}
                  {ctx.docLabel(doc.path, { plain: true })}
                </h1>
              )}
              <div className="markdown-body" ref={previewRef} dangerouslySetInnerHTML={{ __html: rendered.html }} />
              {widgetSlots.map((el, i) =>
                rendered.widgets[i] === undefined
                  ? null
                  : createPortal(
                      <Widget source={rendered.widgets[i]} onOpen={(p) => void ctx.open(p)} onChanged={ctx.onWidgetChanged} />,
                      el,
                      `${i}:${rendered.widgets[i]}`,
                    ),
              )}
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
