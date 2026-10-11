import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BrushCleaning,
  CalendarDays,
  Check,
  ChevronRight,
  Columns2,
  Copy,
  Ellipsis,
  Eye,
  FilePlus,
  Files,
  FolderInput,
  History,
  House,
  Inbox,
  Keyboard,
  Layers,
  Link,
  Link2,
  Paperclip,
  ListChecks,
  ListTree,
  LocateFixed,
  LogOut,
  Menu as MenuIcon,
  Pencil,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SmilePlus,
  ChevronLeft,
  SlidersHorizontal,
  TableOfContents,
  Tag,
  Trash2,
  Waypoints,
  ChevronsDownUp,
  X,
} from "lucide-react";
import { api, ApiError, appMode, review, type CommitInfo, type SearchHit, type SourcesInfo, type TreeNode } from "./api";
import { Editor, type EditorHandle, type LinkCandidate } from "./Editor";
import { LintPanel, ReviewPanel } from "./Curation";
import { GraphView } from "./Graph";
import { IngestDialog } from "./Ingest";
import { invalidateWidgets, Widget } from "./Widget";
import { isNetworkError, offline } from "./offline";
import { LinkResolver, renderMarkdown } from "./markdown";
import { enhance, invalidateEmbeds } from "./enhance";
import { Palette, type PaletteItem } from "./Palette";
import {
  applyTemplate,
  attachmentDirFor,
  blockRange,
  buildNodeTree,
  countNode,
  dailyLookup,
  dailyNotePath,
  dailyNotes,
  dailyOfPath,
  findNode,
  flattenNodes,
  friendlyDate,
  headings,
  inWorkspace,
  isVaultSettingsPath,
  merge3,
  moveNodePath,
  nodeFiles,
  officialLangOf,
  orderWorkspaces,
  parentNode,
  parseFrontmatter,
  planDailyMigration,
  setFrontmatterField,
  sha256Hex,
  shiftDays,
  stripMd,
  templateDirFor,
  updateDailyTags,
  vaultText,
  withDailyTags,
  workspaceOf,
  workspacesOf,
  workspaceSettings,
  ymd,
  type DailyConfig,
  type DailyNote,
  type PropertyStat,
  type VaultNode,
} from "@keyring-notes/core";
import { Properties } from "./Properties";
import { PdfViewer } from "./PdfViewer";
import { localContext } from "./local/boot";
import { useSyncStatus } from "./Sync";
import { confirmDialog, promptDialog } from "./dialog";
import { mentionTarget, References, UnlinkedMentions } from "./Links";
import { DEFAULT_PREFS, setPrefs, usePrefs, type Prefs } from "./prefs";
import { errorText, toast, toastError, Toasts } from "./toast";
import { commandKey, formatCombo, keyCapture, matchCommand, type Command } from "./shortcuts";
import { IconButton, Menu, Resizer, Segmented, type MenuEntry } from "./ui";
import { invalidNameReason, parentOf, stemOf, Tree, type TreeActions, type TreeDecor, type TreeHandle } from "./Tree";
import { SettingsModal, KeySettings, type SettingsSection, type WorkspaceOps } from "./Settings";
import { attemptCloseTopModal, Modal } from "./Modal";
import {
  ensureVaultSettings,
  reloadVaultSettings,
  updateVaultSetting,
  useVaultSettings,
  vaultLang,
  vaultSettingsReady,
  getVaultSettings,
} from "./vaultSettings";
import { DocIcon, IconLookup, IconPicker } from "./IconPicker";
import { getFolds, moveFolds, onFoldsChange, resolveFolds } from "./folds";
import { applyPreviewFolds, revealInPreview, togglePreviewFold } from "./previewFolds";
import { AsidePreview, FileViewer } from "./Aside";
import { fmtDateTime, fmtNumber, missingPack, t, timeAgo, useLang } from "./i18n";
import { tipProps } from "./Tooltip";
import { AttachmentList } from "./Attachments";
import { isRecordOf, isString, isStringArray, readStored } from "./stored";
import type { Conflict, OpenDoc, SaveState } from "./openDocs";
import type { ViewMode } from "./panes";

interface RevisionView {
  commit: CommitInfo;
  content: string | null;
}

/** 설정 화면 주소: 파일 이름에 못 쓰는 ":"로 시작해 문서 경로와 겹치지 않는다 */
const SETTINGS_HASH = "#/:settings";

function pathFromLocation(): string | null {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (h.startsWith(":")) return null;
  return h || null;
}

function settingsFromLocation(): SettingsSection | null {
  if (!location.hash.startsWith(SETTINGS_HASH)) return null;
  return (location.hash.slice(SETTINGS_HASH.length + 1) || "general") as SettingsSection;
}

/**
 * 저장이 충돌(409)로 막혔을 때: 고치기 시작한 버전(base)을 기준으로 지금 저장된 버전과 3방향 병합한다.
 * 서로 다른 곳을 고쳤으면 합친 내용을 저장하고 돌려준다. 같은 곳이면 null(지금처럼 충돌 처리).
 */
async function saveMerged(path: string, base: string, mine: string): Promise<{ text: string; hash: string } | null> {
  const theirs = await api.read(path, { fresh: true });
  if (theirs.generated || theirs.pendingOffline || theirs.cachedOffline) return null;
  const m = merge3(base, mine, theirs.content);
  if (!m.ok) return null;
  if (m.text === theirs.content) return { text: m.text, hash: theirs.hash };
  const d = await api.write(path, m.text, theirs.hash);
  return { text: m.text, hash: d.hash };
}

function conflictCopyPath(path: string, label: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return path.replace(/\.md$/i, ` (${label} ${stamp}).md`);
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** 같은 이름이 있으면 " 2", " 3"… (노드 이름: 노트 A.md와 하위 폴더 A/가 모두 비어 있어야 한다) */
function uniquePath(dir: string, stem: string, taken: string[], ext = ".md"): string {
  const set = new Set(taken.map((p) => p.toLowerCase()));
  const dirs = new Set(taken.map((p) => parentOf(p).toLowerCase()));
  for (let i = 1; ; i++) {
    const name = `${stem}${i > 1 ? ` ${i}` : ""}`;
    const p = join(dir, `${name}${ext}`);
    if (!set.has(p.toLowerCase()) && (ext !== ".md" || !dirs.has(join(dir, name).toLowerCase()))) return p;
  }
}

/** 이 기기에 기억하는 값(localStorage JSON). 모양이 맞지 않는 저장값(예전 형식 등)은 버리고 initial로 시작한다. */
function useStored<T>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return readStored(localStorage.getItem(key), initial, valid);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [key, v]);
  return [v, setV];
}

/** 노드 경로가 들어 있는 경로 목록에서 그 노드가 있는지(노트 또는 하위) */
function nodeExists(node: string, paths: string[]): boolean {
  const lower = node.toLowerCase();
  return paths.some((p) => {
    const l = p.toLowerCase();
    return l === `${lower}.md` || l.startsWith(lower + "/");
  });
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

/** 탭·마지막 문서를 기억하는 범위 이름: 워크스페이스, 모든 워크스페이스면 "*" */
const scopeKeyOf = (all: boolean, ws: string) => (all ? "*" : ws);

export function Workspace({ onLogout }: { onLogout: () => void }) {
  const prefs = usePrefs();
  const lang = useLang();
  const local = appMode.local;
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  // 좁은 화면에서는 나란히 보기 대신 미리보기로 시작. Live Preview가 기본이라 넓은 화면은 편집으로
  const narrow = () => window.matchMedia?.("(max-width: 800px)").matches ?? false;
  const [isNarrow, setIsNarrow] = useState(narrow);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 800px)");
    if (!mq) return;
    const on = () => {
      setIsNarrow(mq.matches);
      setDrawer(null);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [mode, setMode] = useState<ViewMode>(() => (narrow() ? "preview" : "edit"));
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** 접힌 상태가 바뀔 때 올린다(미리보기·개요를 다시 맞춘다) */
  const [foldVersion, setFoldVersion] = useState(0);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [revision, setRevision] = useState<RevisionView | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<(SearchHit & { score?: number })[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [refs, setRefs] = useState<SourcesInfo | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [lintOpen, setLintOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [graphOpen, setGraphOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [outboxCount, setOutboxCount] = useState(0);
  /** 좁은 화면: 왼쪽·오른쪽 서랍 */
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const [semanticOn, setSemanticOn] = useState(false);
  const [searchMode, setSearchMode] = useState<"text" | "semantic">("text");
  /** 볼트 내용이 바뀔 때마다 올려 태그·백링크·위젯을 다시 불러온다. */
  const [vaultVersion, setVaultVersion] = useState(0);
  const editorHandle = useRef<EditorHandle | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<TreeHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [widgetSlots, setWidgetSlots] = useState<HTMLElement[]>([]);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(settingsFromLocation);
  const [keysOpen, setKeysOpen] = useState(false);
  const [aside, setAside] = useState<string | null>(null);
  const [fileView, setFileView] = useState<string | null>(null);
  const [docMenu, setDocMenu] = useState<{ x: number; y: number } | null>(null);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  /** 제목 칸에 커서를 둘 문서(새 문서·F2). 문서가 열린 뒤 에디터보다 늦게 잡는다 */
  const [titleFocus, setTitleFocus] = useState<{ path: string; n: number } | null>(null);
  const focusTitle = (path: string) => setTitleFocus({ path, n: Date.now() });
  const [now, setNow] = useState(Date.now());
  const tabCache = useRef(new Map<string, OpenDoc>());
  const closedTabs = useRef<string[]>([]);
  const [recent, setRecent] = useStored<string[]>("keyring:recent", [], isStringArray);
  /** 열어 본 문서 기록(뒤로·앞으로) */
  const nav = useRef<{ list: string[]; i: number }>({ list: [], i: -1 });
  const [palette, setPalette] = useState<"files" | "commands" | "templates" | "new-from-template" | "move" | "daily" | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ path: string; kind: "node" | "file" } | null>(null);
  const shared = useVaultSettings();
  const [propStats, setPropStats] = useState<PropertyStat[]>([]);
  const [pendingAnchor, setPendingAnchor] = useState<{ path: string; heading?: string; block?: string; line?: number; text?: string } | null>(null);
  // 앱 안 PDF 보기(주석 달기)
  const [pdfView, setPdfView] = useState<{ path: string; page?: number } | null>(null);
  /** 브라우저 로컬 볼트의 첨부(blob URL)가 준비되면 올려 미리보기를 다시 그린다 */
  const [assetVersion, setAssetVersion] = useState(0);
  const syncStatus = useSyncStatus(localContext);
  const docRef = useRef<OpenDoc | null>(null);
  docRef.current = doc;
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  // ── 워크스페이스: 볼트 루트 노드. 트리·빠른 열기·검색·태그·그래프·홈을 지금 워크스페이스로 좁힌다
  const wsNames = useMemo(() => orderWorkspaces(shared, workspacesOf(tree)), [shared, tree]);
  const ws = wsNames.includes(prefs.workspace) ? prefs.workspace : (wsNames[0] ?? "");
  const allWs = prefs.allWorkspaces || !ws;
  const scope = allWs ? "" : ws;
  const scopeKey = scopeKeyOf(allWs, ws);
  const scopeRef = useRef({ allWs, ws, scopeKey });
  scopeRef.current = { allWs, ws, scopeKey };
  const inScope = (p: string) => !scope || inWorkspace(p, scope);
  /** 워크스페이스마다 열린 탭·마지막 문서(이 기기) */
  const [tabsByScope, setTabsByScope] = useStored<Record<string, string[]>>("keyring:tabs", {}, isRecordOf(isStringArray));
  const [lastByScope, setLastByScope] = useStored<Record<string, string>>("keyring:last-doc", {}, isRecordOf(isString));
  const tabs = tabsByScope[scopeKey] ?? [];
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const setTabsFor = (key: string, fn: (t: string[]) => string[]) => setTabsByScope((m) => ({ ...m, [key]: fn(m[key] ?? []) }));
  const setTabs = (fn: (t: string[]) => string[]) => setTabsFor(scopeRef.current.scopeKey, fn);

  const uiLang = officialLangOf(lang);
  const daily = useMemo(() => dailyLookup(shared, () => wsNames, uiLang), [shared, wsNames, uiLang]);
  const live = prefs.live;
  const rightTab = prefs.rightTab;
  const rightOpen = prefs.rightOpen;
  const propsShown = ((rightOpen && !isNarrow) || drawer === "right") && rightTab === "props";

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!propsShown) return;
    api
      .properties()
      .then(setPropStats)
      .catch(() => undefined);
  }, [propsShown, vaultVersion]);

  const resolver = useMemo(() => new LinkResolver(tree, daily), [tree, daily]);

  // 다른 곳(다른 기기·탭·에이전트)에서 지워지거나 옮겨진 노트의 탭은 트리를 받은 뒤 정리한다(빈 노드의 탭은 폴더가 있으면 남긴다)
  useEffect(() => {
    if (!tree.length) return;
    const files = new Set(resolver.paths);
    const dirs = new Set(
      resolver.paths.flatMap((p) =>
        p
          .split("/")
          .slice(0, -1)
          .map((_, i, a) => a.slice(0, i + 1).join("/")),
      ),
    );
    // 지금 연 노트·저장 안 한 탭(오프라인에서 만든 것 포함)은 남긴다
    const keep = (p: string) => p === docRef.current?.path || (tabCache.current.get(p)?.draft ?? "") !== (tabCache.current.get(p)?.saved ?? "");
    const alive = (p: string) => files.has(p) || dirs.has(stripMd(p)) || keep(p);
    setTabsByScope((m) => {
      let changed = false;
      const next: Record<string, string[]> = {};
      for (const [k, list] of Object.entries(m)) {
        next[k] = list.filter(alive);
        if (next[k].length !== list.length) changed = true;
      }
      return changed ? next : m;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver]);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  /** 워크스페이스 첨부 폴더(트리에서 숨긴다) */
  const attachDirs = useMemo(() => new Set(wsNames.map((w) => attachmentDirFor(shared, w, uiLang))), [shared, wsNames, uiLang]);
  /** 노드 트리(공통 설정 파일·워크스페이스 첨부 폴더는 빼고) */
  const nodeTree = useMemo(
    () => buildNodeTree(tree, { hidden: (p, type) => isVaultSettingsPath(p) || (type === "dir" && attachDirs.has(p)) }),
    [tree, attachDirs],
  );
  const viewNodes = useMemo(() => (allWs ? nodeTree : (findNode(nodeTree, ws)?.children ?? [])), [nodeTree, allWs, ws]);
  const wsNode = (name: string) => findNode(nodeTree, name);

  const linkCandidates = useMemo<LinkCandidate[]>(() => {
    const paths = resolver.paths.filter((p) => !isVaultSettingsPath(p));
    const nameCount = new Map<string, number>();
    for (const p of paths) {
      const n = p.split("/").pop()!.replace(/\.md$/i, "").toLowerCase();
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    }
    return paths.map((p) => {
      const isMd = /\.md$/i.test(p);
      const name = p.split("/").pop()!;
      const base = isMd ? name.replace(/\.md$/i, "") : name;
      // 같은 이름이 여러 개면 경로로 구분한다
      const label = (nameCount.get(base.toLowerCase()) ?? 0) > 1 ? (isMd ? p.replace(/\.md$/i, "") : p) : base;
      return { label, detail: p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : undefined, attachment: !isMd };
    });
  }, [resolver]);
  const dirty = doc !== null && doc.draft !== doc.saved;

  // 지금 문서의 속성: 개수(오른쪽 패널 탭·접힌 프런트매터 줄)와 아이콘. 저장 전 초안 기준
  const docFm = useMemo(() => {
    const text = doc?.draft ?? "";
    const block = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text)?.[0] ?? "";
    return block ? parseFrontmatter(block).data : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.draft]);
  const propCount = docFm ? Object.keys(docFm).length : 0;
  const docIcon = typeof docFm?.icon === "string" && docFm.icon.trim() ? docFm.icon.trim() : null;
  const docDaily = doc ? dailyOfPath(doc.path, daily) : null;

  /** 노드 아이콘(트리에서 받은 노트의 icon, 지금 문서는 초안의 icon) */
  const iconMap = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (n.type === "dir") walk(n.children ?? []);
        else if (n.icon) m.set(n.path, n.icon);
      }
    };
    walk(tree);
    return m;
  }, [tree]);
  /** 문서(노드 노트) 경로 → 아이콘 */
  const iconOf = (path: string): string | null => {
    if (!prefs.showIcons) return null;
    if (doc && path === doc.path) return docIcon;
    return iconMap.get(path) ?? null;
  };
  const [iconPick, setIconPick] = useState<{ x: number; y: number; node: string } | null>(null);

  /** 문서 이름 보이기: 데일리 노트는 날짜를 흐리게·제목을 진하게(제목이 없으면 읽기 좋은 날짜) */
  const docLabel = (path: string, opts: { plain?: boolean } = {}): ReactNode => {
    if (!/\.md$/i.test(path)) return path.split("/").pop();
    const d = dailyOfPath(path, daily);
    if (!d) return stemOf(path);
    if (!d.title)
      return prefs.dailyFriendly && !opts.plain ? <span {...tipProps({ label: d.datePart })}>{friendlyDate(d.date, new Date(), lang)}</span> : d.datePart;
    return (
      <>
        <span className="daily-date">{d.datePart}</span>
        {d.sep.trim() ? ` ${d.sep.trim()} ` : " "}
        <span className="daily-title">{d.title}</span>
      </>
    );
  };

  const refreshTree = useCallback(
    () =>
      api
        .tree()
        .then((tr) => {
          setTree(tr);
          setTreeLoaded(true);
        })
        .catch(toastError),
    [],
  );

  const vaultChanged = useCallback(() => {
    invalidateWidgets();
    invalidateEmbeds();
    setVaultVersion((v) => v + 1);
    // 공통 설정 파일이 바뀌었을 수 있다(다른 탭·동기화·직접 고침)
    void reloadVaultSettings();
    // 위키 index·log를 열어 두었다면 서버가 새로 만든 내용으로 바꾼다.
    const cur = docRef.current;
    if (cur?.generated) setTimeout(() => void load(cur.path), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 자동 저장 뒤에는 잠시 모아서 알린다(위젯·백링크를 몇 초마다 다시 읽지 않게) */
  const lazyChanged = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vaultChangedSoon = useCallback(() => {
    if (lazyChanged.current) clearTimeout(lazyChanged.current);
    lazyChanged.current = setTimeout(() => {
      lazyChanged.current = null;
      vaultChanged();
    }, 4000);
  }, [vaultChanged]);

  useEffect(() => {
    api
      .tags(scope || undefined)
      .then(setTags)
      .catch(() => undefined);
  }, [vaultVersion, scope]);

  // 검토 대기 수: 볼트가 바뀔 때와 1분마다
  useEffect(() => {
    if (local) return;
    const loadCount = () =>
      review
        .list("pending")
        .then((l) => setPendingCount(l.length))
        .catch(() => undefined);
    void loadCount();
    const timer = setInterval(loadCount, 60_000);
    return () => clearInterval(timer);
  }, [vaultVersion]);

  useEffect(() => {
    if (!doc?.path || doc.virtual) return setRefs(null);
    api
      .sources(doc.path)
      .then(setRefs)
      .catch(() => setRefs(null));
  }, [doc?.path, doc?.virtual, vaultVersion]);

  useEffect(() => {
    api
      .semanticStatus()
      .then((s) => setSemanticOn(s.enabled))
      .catch(() => undefined);
  }, []);

  // 소유자 화면이 처음 열릴 때 공통 설정 파일이 없으면 만든다(볼트 언어 = 지금 화면 언어)
  useEffect(() => {
    void ensureVaultSettings();
  }, []);

  // 고른 화면 언어의 언어팩이 이 기기에 없으면 알린다
  useEffect(() => {
    const id = missingPack();
    if (id) toast(t("lang.missingPack", { id }), { kind: "warn", duration: 8000 });
  }, [lang]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    const semantic = searchMode === "semantic" && !q.startsWith("#");
    const timer = setTimeout(
      () => {
        (semantic
          ? api
              .semantic(q, scope || undefined)
              .then((hs) =>
                hs.map((h) => ({ path: h.path, title: h.title, line: 1, snippet: (h.heading ? `${h.heading} · ` : "") + h.snippet, score: h.score })),
              )
          : api.search(q, scope || undefined)
        )
          .then(setHits)
          .catch((e) => {
            setHits([]);
            toastError(e);
          });
      },
      semantic ? 400 : 200,
    );
    return () => clearTimeout(timer);
  }, [query, vaultVersion, searchMode, scope]);

  const remember = (path: string) => {
    setRecent((r) => [path, ...r.filter((p) => p !== path)].slice(0, 30));
    const key = scopeRef.current.scopeKey;
    setLastByScope((m) => (m[key] === path ? m : { ...m, [key]: path }));
  };

  const load = useCallback(async (path: string) => {
    try {
      const d = await api.read(path);
      setDoc((prev) => ({
        path: d.path,
        saved: d.content,
        hash: d.hash,
        draft: d.content,
        seq: (prev?.seq ?? 0) + 1,
        generated: d.generated === true,
        cachedOffline: d.cachedOffline === true,
      }));
      setConflict(null);
      setRevision(null);
      setSaveState({ kind: "idle" });
      remember(d.path);
      if (pathFromLocation() !== d.path && !settingsFromLocation()) history.replaceState(null, "", `#/${encodeURIComponent(d.path)}`);
    } catch (e) {
      // 노트 없는 노드(A/만 있음): 빈 노드로 연다. 내용을 쓰면 그때 A.md를 만든다
      if (e instanceof ApiError && e.status === 404 && /\.md$/i.test(path) && nodeExists(stripMd(path), resolverRef.current.paths)) {
        setDoc((prev) => ({ path, saved: "", hash: "", draft: "", seq: (prev?.seq ?? 0) + 1, generated: false, virtual: true }));
        setConflict(null);
        setRevision(null);
        setSaveState({ kind: "idle" });
        remember(path);
        if (pathFromLocation() !== path && !settingsFromLocation()) history.replaceState(null, "", `#/${encodeURIComponent(path)}`);
        return;
      }
      toastError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 문서 하나의 변경을 그 탭(지금 문서 또는 뒤의 탭)에 반영한다 */
  const patchDoc = (path: string, patch: (d: OpenDoc) => OpenDoc) => {
    if (docRef.current?.path === path) setDoc((prev) => (prev && prev.path === path ? patch(prev) : prev));
    const c = tabCache.current.get(path);
    if (c) tabCache.current.set(path, patch(c));
  };

  // ── 저장(자동 저장 포함). 늘 지금 상태(docRef)를 읽어 오래된 값으로 덮어쓰지 않는다
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const save = useCallback(
    async (opts: { auto?: boolean } = {}): Promise<boolean> => {
      const d = docRef.current;
      if (!d || d.generated || d.draft === d.saved) return true;
      if (conflictRef.current || revisionRef.current) return false;
      if (savingRef.current) {
        againRef.current = true;
        return false;
      }
      savingRef.current = true;
      setSaveState({ kind: "saving" });
      const content = d.draft;
      let ok = false;
      try {
        const r = await api.write(d.path, content, d.hash || null, { coalesce: opts.auto });
        await offline.done(d.path).catch(() => undefined);
        setOutboxCount((await offline.pending().catch(() => [])).length);
        // 저장하는 동안 더 입력한 내용(draft)은 그대로 둔다.
        patchDoc(d.path, (prev) => ({ ...prev, saved: content, hash: r.hash, virtual: false }));
        setSaveState({ kind: "saved", at: Date.now() });
        ok = true;
        // 노트 없는 노드에 처음 쓰면 노트가 생겼다(트리 아이콘·노드 모양)
        if (d.virtual) void refreshTree();
        if (opts.auto) vaultChangedSoon();
        else vaultChanged();
      } catch (e) {
        if (isNetworkError(e)) {
          // 오프라인: 이 기기에 저장해 두고(문서마다 마지막 것만), 연결되면 보낸다
          await offline.queue(d.path, content, d.hash || null, d.hash ? d.saved : null);
          patchDoc(d.path, (prev) => ({ ...prev, saved: content }));
          setOutboxCount((await offline.pending()).length);
          setSaveState({ kind: "queued" });
          ok = true;
        } else if (e instanceof ApiError && e.status === 409) {
          // 다른 곳(다른 탭·에이전트·동기화)에서 먼저 고쳤다: 서로 다른 부분이면 자동으로 합친다
          const merged = e.currentHash && d.hash ? await saveMerged(d.path, d.saved, content).catch(() => null) : null;
          const prev = docRef.current;
          // 저장하는 동안 더 입력했다면 그 입력도 합친다
          const draft =
            merged && prev && prev.path === d.path
              ? prev.draft === content
                ? merged.text
                : (() => {
                    const more = merge3(content, prev.draft, merged.text);
                    return more.ok ? more.text : null;
                  })()
              : null;
          if (merged && prev && prev.path === d.path && draft !== null) {
            setDoc({ ...prev, saved: merged.text, hash: merged.hash, draft, seq: prev.seq + 1 });
            setConflict(null);
            setSaveState({ kind: "saved", at: Date.now() });
            toast(t("save.merged"), { kind: "info" });
            ok = true;
            vaultChanged();
          } else {
            if (docRef.current?.path === d.path) setConflict({ currentHash: merged?.hash ?? e.currentHash ?? null });
            setSaveState({ kind: "conflict" });
            toast(t("save.conflict"), { kind: "warn", duration: 8000 });
          }
        } else {
          const message = errorText(e);
          setSaveState({ kind: "error", message });
          // 자동 저장이 잇달아 실패하면 처음 한 번만 알린다(상태 표시줄에는 계속 보인다)
          if (!opts.auto || saveStateRef.current.kind !== "error")
            toast(t("save.failed", { message }), { kind: "error", action: { label: t("common.retry"), run: () => void save() } });
        }
      } finally {
        savingRef.current = false;
      }
      if (againRef.current) {
        againRef.current = false;
        void save(opts);
      }
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultChanged, vaultChangedSoon],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  /** 다른 일(탭 바꾸기·이동·이름 바꾸기) 전에 지금 문서를 저장한다. 저장 못 했으면 false */
  const flush = async (): Promise<boolean> => {
    const d = docRef.current;
    if (!d || d.draft === d.saved || d.generated) return true;
    if (!prefs.autosave) return true;
    await saveRef.current({ auto: true });
    const after = docRef.current;
    return !after || after.path !== d.path || after.draft === after.saved;
  };

  // 자동 저장: 입력이 멈추고 잠시 뒤
  useEffect(() => {
    if (!prefs.autosave || !doc || doc.generated || doc.draft === doc.saved || conflict || revision) return;
    const timer = setTimeout(() => void saveRef.current({ auto: true }), prefs.autosaveDelay);
    return () => clearTimeout(timer);
  }, [doc?.draft, doc?.saved, doc?.path, prefs.autosave, prefs.autosaveDelay, conflict, revision]);

  // 창에서 포커스가 빠지거나 숨겨질 때도 저장
  useEffect(() => {
    if (!prefs.autosave) return;
    const go = () => void saveRef.current({ auto: true });
    const vis = () => document.visibilityState === "hidden" && go();
    window.addEventListener("blur", go);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("blur", go);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [prefs.autosave]);

  const pushNav = (path: string) => {
    const n = nav.current;
    if (n.list[n.i] === path) return;
    n.list = [...n.list.slice(0, n.i + 1), path].slice(-100);
    n.i = n.list.length - 1;
  };

  const showDoc = (path: string) => {
    const cached = tabCache.current.get(path);
    if (cached) {
      tabCache.current.delete(path);
      setDoc({ ...cached, seq: cached.seq + 1 });
      setConflict(null);
      setRevision(null);
      setSaveState({ kind: "idle" });
      remember(path);
      if (pathFromLocation() !== path) history.replaceState(null, "", `#/${encodeURIComponent(path)}`);
    } else void load(path);
  };

  /**
   * 문서 열기. 탭: 이미 열린 탭이면 그 탭으로(저장 안 한 초안은 탭마다 그대로), newTab이면 새 탭에,
   * 아니면 지금 탭을 바꾼다. 자동 저장이 켜져 있으면 먼저 저장한다(못 하면 묻는다).
   * 다른 워크스페이스의 문서면(모든 워크스페이스 보기가 아닐 때) 그 워크스페이스로 바꾼다.
   */
  const open = useCallback(
    async (path: string, opts: { newTab?: boolean; noHistory?: boolean } = {}) => {
      if (/\.pdf$/i.test(path)) return setPdfView({ path });
      if (!/\.md$/i.test(path)) return setFileView(path);
      if (settingsFromLocation()) closeSettings(false);
      const cur = docRef.current;
      setDrawer(null);
      if (cur?.path === path) return;
      const sc = scopeRef.current;
      const target = workspaceOf(path);
      const switching = !sc.allWs && !!target && target !== sc.ws;
      const key = switching ? scopeKeyOf(false, target) : sc.scopeKey;
      const keep = (!switching && tabsRef.current.includes(path)) || opts.newTab || switching;
      if (cur) {
        await flush();
        const nowDoc = docRef.current;
        if (nowDoc && nowDoc.path === cur.path) {
          if (keep || tabsRef.current.includes(nowDoc.path)) tabCache.current.set(nowDoc.path, nowDoc);
          else if (nowDoc.draft !== nowDoc.saved && !(await confirmDialog(t("doc.discardAndOpen"), t("doc.discard")))) return;
        }
      }
      if (switching) {
        setPrefs({ workspace: target! });
        scopeRef.current = { allWs: false, ws: target!, scopeKey: key };
      }
      setTabsFor(key, (list) => {
        if (list.includes(path)) return list;
        if (switching || !cur || keep || !list.includes(cur.path)) return [...list, path];
        return list.map((x) => (x === cur.path ? path : x));
      });
      if (!opts.noHistory) pushNav(path);
      showDoc(path);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, prefs.autosave],
  );
  const openRef = useRef(open);
  openRef.current = open;

  /** 노드 열기: 노트가 있으면 그 노트, 없으면 빈 노드(쓰면 노트가 생긴다) */
  const openNode = (node: string | VaultNode, opts: { newTab?: boolean } = {}) => {
    const path = typeof node === "string" ? node : node.path;
    return open(`${path}.md`, opts);
  };

  const goNav = (delta: number) => {
    const n = nav.current;
    const i = n.i + delta;
    if (i < 0 || i >= n.list.length) return;
    n.i = i;
    void open(n.list[i], { noHistory: true });
  };

  /** 탭 닫기. 닫는 탭에 저장 안 한 변경이 있으면 저장(자동 저장)하거나 묻는다 */
  const closeTab = async (path: string) => {
    const cur = docRef.current;
    if (cur?.path === path) await flush();
    const nowDoc = docRef.current;
    const target = nowDoc?.path === path ? nowDoc : tabCache.current.get(path);
    if (target && target.draft !== target.saved && !(await confirmDialog(t("tab.discardClose", { name: stemOf(path) }), t("tab.discardCloseButton")))) return;
    tabCache.current.delete(path);
    closedTabs.current = [path, ...closedTabs.current.filter((p) => p !== path)].slice(0, 20);
    const list = tabsRef.current;
    const i = list.indexOf(path);
    const rest = list.filter((p) => p !== path);
    setTabs(() => rest);
    if (nowDoc?.path === path) {
      const next = rest[Math.min(i, rest.length - 1)];
      if (next) showDoc(next);
      else {
        setDoc(null);
        history.replaceState(null, "", "#");
      }
    }
  };

  /**
   * 워크스페이스 바꾸기(또는 모든 워크스페이스 보기 켜고 끄기). 지금 문서를 저장하고, 그 범위에서 마지막으로 연 문서를 연다.
   */
  const switchScope = async (next: { workspace?: string; all?: boolean }) => {
    await flush();
    const cur = docRef.current;
    if (cur) tabCache.current.set(cur.path, cur);
    const all = next.all ?? (next.workspace ? false : prefs.allWorkspaces);
    const wsName = next.workspace ?? ws;
    setPrefs({ workspace: wsName, allWorkspaces: all });
    const key = scopeKeyOf(all || !wsName, wsName);
    scopeRef.current = { allWs: all || !wsName, ws: wsName, scopeKey: key };
    setDrawer(null);
    const last = lastByScope[key];
    const keepCur = cur && (all || inWorkspace(cur.path, wsName));
    if (keepCur) return;
    if (last && resolverRef.current.paths.includes(last)) showDoc(last);
    else {
      setDoc(null);
      history.replaceState(null, "", "#");
    }
  };

  useEffect(() => {
    void refreshTree();
    const initial = pathFromLocation();
    if (initial) {
      setTabs((list) => (list.includes(initial) ? list : [...list, initial]));
      pushNav(initial);
      void load(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTree, load]);

  // 처음 열 때 주소에 문서가 없으면 이 워크스페이스에서 마지막으로 연 문서
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !treeLoaded) return;
    restored.current = true;
    if (pathFromLocation() || settingsFromLocation() || docRef.current) return;
    const last = lastByScope[scopeKey];
    if (last && resolver.paths.includes(last)) void open(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeLoaded]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    const onHash = async () => {
      const next = settingsFromLocation();
      const was = settingsRef.current;
      if (was && !next) {
        // 뒤로 가기로 설정을 닫을 때도 토큰 화면·저장 안 한 입력을 지킨다
        const leaving = location.hash;
        if (!(await attemptCloseTopModal())) {
          history.pushState(null, "", `${SETTINGS_HASH}/${was}`);
          return;
        }
        if (location.hash !== leaving) return;
        history.replaceState(null, "", leaving);
      }
      setSettings(next);
      const p = pathFromLocation();
      if (p && p !== docRef.current?.path) void openRef.current(p);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 저장 안 한 변경(지금 문서 또는 뒤에 있는 탭)이 있으면 창을 닫기 전에 저장을 시도하고 묻는다
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const cur = docRef.current;
      const any = (cur && cur.draft !== cur.saved) || [...tabCache.current.values()].some((d) => d.draft !== d.saved);
      if (!any) return;
      void saveRef.current({ auto: true });
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (!(rightOpen || drawer === "right") || rightTab !== "history" || !doc || doc.virtual) return;
    api.history(doc.path).then(setCommits).catch(toastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightOpen, drawer, rightTab, doc?.path, doc?.hash]);

  /** 오프라인 저장분을 서버로 보낸다. 그 사이 서버에서 바뀐 문서는 덮어쓰지 않고 충돌 사본으로 남긴다. */
  const flushing = useRef(false);
  const flushOutbox = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    const synced: string[] = [];
    const conflicts: string[] = [];
    const merged: string[] = [];
    try {
      for (const item of await offline.pending()) {
        try {
          const d = await api.write(item.path, item.content, item.baseHash);
          await offline.done(item.path);
          await offline.saveDoc(d);
          synced.push(item.path);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            // 서로 다른 곳을 고쳤으면 합치고, 같은 곳이면 사본으로
            const m = e.currentHash && item.baseContent != null ? await saveMerged(item.path, item.baseContent, item.content).catch(() => null) : null;
            if (m) {
              await offline.done(item.path);
              await offline.saveDoc({ path: item.path, content: m.text, hash: m.hash });
              merged.push(item.path);
              continue;
            }
            const copy = conflictCopyPath(item.path, vaultText(vaultLang()).offlineConflictCopy);
            await api.write(copy, item.content, null);
            await offline.done(item.path);
            conflicts.push(copy);
          } else break; // 아직 연결이 없거나 로그인이 필요하다
        }
      }
    } finally {
      flushing.current = false;
      setOutboxCount((await offline.pending().catch(() => [])).length);
    }
    if (synced.length || conflicts.length || merged.length) {
      vaultChanged();
      void refreshTree();
      const cur = docRef.current;
      if (cur && (synced.includes(cur.path) || merged.includes(cur.path) || conflicts.length) && cur.draft === cur.saved) await load(cur.path);
      toast(
        [
          t("offline.sent", { count: synced.length + conflicts.length + merged.length }),
          merged.length ? t("offline.merged", { count: merged.length }) : "",
          conflicts.length ? t("offline.copies", { list: conflicts.join(", ") }) : "",
        ]
          .filter(Boolean)
          .join(" "),
        { kind: conflicts.length ? "warn" : "success", duration: conflicts.length ? 0 : 5000 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultChanged, refreshTree]);

  useEffect(() => {
    if (local) return;
    const up = () => {
      setOnline(true);
      void flushOutbox();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void offline
      .pending()
      .then((p) => {
        setOutboxCount(p.length);
        if (p.length && navigator.onLine) void flushOutbox();
      })
      .catch(() => undefined);
    const timer = setInterval(() => {
      if (!navigator.onLine) return;
      void offline
        .pending()
        .then((p) => {
          if (p.length) void flushOutbox();
        })
        .catch(() => undefined);
    }, 30_000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(timer);
    };
  }, [flushOutbox]);

  // 기기 볼트: 동기화로 받은 변경, 다른 편집기에서 고친 파일을 화면에 반영한다
  useEffect(() => {
    if (!localContext) return;
    const onAsset = () => setAssetVersion((v) => v + 1);
    // 다른 기기에서 동기화로 공통 설정이 바뀌면 다시 읽는다(vaultChanged가 부른다)
    window.addEventListener("keyring:asset-loaded", onAsset);
    const off = localContext.vault.onChange((paths, source) => {
      if (source === "local") return;
      vaultChanged();
      void refreshTree();
      const cur = docRef.current;
      if (cur && paths.includes(cur.path)) {
        if (cur.draft === cur.saved) void load(cur.path);
        else toast(source === "sync" ? t("doc.changedBySync") : t("doc.changedOutside"), { kind: "warn", duration: 0 });
      }
    });
    return () => {
      off();
      window.removeEventListener("keyring:asset-loaded", onAsset);
    };
  }, [vaultChanged, refreshTree, load]);

  /** 문서가 든 워크스페이스(없으면 지금 워크스페이스) */
  const wsOfPath = (p: string | null | undefined) => (p ? workspaceOf(p) : null) ?? ws;

  /**
   * 붙여넣거나 끌어 놓은 파일을 워크스페이스 첨부 폴더(공통 설정, 트리에서 숨김)에 올린다(이름이 겹치면 " 2"…).
   * 넣을 링크: 이미지는 ![[이름]], 나머지는 [[이름]]. 같은 이름이 볼트에 또 있으면 전체 경로로.
   */
  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!doc) return [];
    const dir = attachmentDirFor(getVaultSettings(), wsOfPath(doc.path), uiLang);
    const taken = new Set(resolver.paths.map((p) => p.toLowerCase()));
    const vt = vaultText(vaultLang());
    const out: string[] = [];
    for (const f of files) {
      const ext = (
        /\.[A-Za-z0-9]+$/.exec(f.name)?.[0] ?? (f.type.startsWith("image/") ? `.${f.type.slice(6).replace("jpeg", "jpg").replace(/\+.*/, "")}` : "")
      ).toLowerCase();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      // 클립보드 이미지는 이름이 image.png라 날짜로 바꾼다
      const stem =
        !f.name || /^image\.\w+$/i.test(f.name)
          ? `${vt.pastedImage} ${stamp}`
          : f.name
              .replace(/\.[A-Za-z0-9]+$/, "")
              .replace(/[\\/:*?"<>|#^[\]]/g, " ")
              .trim() || vt.attachmentName;
      let path = "";
      for (let i = 1; ; i++) {
        const cand = join(dir, `${stem}${i > 1 ? ` ${i}` : ""}${ext}`);
        if (taken.has(cand.toLowerCase())) continue;
        try {
          path = (await api.uploadAttachment(cand, f)).path;
          break;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && i < 50) continue;
          toastError(e);
          return out;
        }
      }
      taken.add(path.toLowerCase());
      const name = path.split("/").pop()!;
      const unique = resolver.paths.filter((p) => p.split("/").pop()!.toLowerCase() === name.toLowerCase()).length === 0;
      const target = unique && shared.linkFormat !== "full" ? name : path;
      out.push(/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path) ? `![[${target}]]` : `[[${target}]]`);
    }
    vaultChanged();
    await refreshTree();
    return out;
  };

  const saveConflictCopy = async () => {
    if (!doc) return;
    const copy = conflictCopyPath(doc.path, vaultText(vaultLang()).conflictCopy);
    try {
      await api.write(copy, doc.draft, null);
      vaultChanged();
      await refreshTree();
      await load(doc.path);
      toast(t("save.copySaved", { path: copy }), { kind: "success", action: { label: t("common.open"), run: () => void open(copy, { newTab: true }) } });
    } catch (e) {
      toastError(e);
    }
  };

  /** 새로 넣는 링크의 대상 이름(공통 설정의 링크 모양: 가장 짧은 이름 또는 전체 경로). from: 링크를 쓸 문서 */
  /** 첨부를 문서에 넣을 글: 이미지는 그림으로(`![[…]]`), 나머지는 링크 */
  const embedText = (p: string) => (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(p) ? `![[${linkTo(p)}]]` : `[[${linkTo(p)}]]`);

  const linkTo = (p: string, from = docRef.current?.path) => {
    const md = /\.md$/i.test(p);
    if (shared.linkFormat === "full") return md ? p.replace(/\.md$/i, "") : p;
    return md ? mentionTarget(p, resolver, from) : resolver.resolve(p.split("/").pop()!, from) === p ? p.split("/").pop()! : p;
  };

  /**
   * 새 노트를 둘 노드: 지금 문서의 형제(지금 문서의 상위 노드). 워크스페이스 밖(볼트 맨 위)에는 두지 않는다
   */
  const currentParent = (): string => {
    const cur = docRef.current;
    const p = cur ? parentNode(stripMd(cur.path)) : "";
    if (p) return p;
    if (cur && !cur.path.includes("/")) return stripMd(cur.path); // 워크스페이스 노트를 보는 중: 그 하위
    return scopeRef.current.ws || wsNames[0] || "";
  };

  /** 새 노트: 노드 아래에 볼트 언어의 "제목 없음"으로 바로 만들고 제목 칸에 커서를 둔다 */
  const createDoc = async (parent = currentParent(), content = "") => {
    if (!parent) {
      toast(t("ws.needOne"), { kind: "info", action: { label: t("settings.title"), run: () => openSettings("workspaces") } });
      return;
    }
    const path = uniquePath(parent, vaultText(vaultLang()).untitled, resolver.paths);
    try {
      await api.write(path, content, null);
      vaultChanged();
      await refreshTree();
    } catch (e) {
      if (!isNetworkError(e)) return toastError(e);
      await offline.queue(path, content, null);
      setOutboxCount((await offline.pending()).length);
    }
    focusTitle(path);
    await open(path, { newTab: true });
    setMode((m) => (m === "preview" ? "edit" : m));
  };

  /** 템플릿 문서 원문(없으면 null) */
  const readTemplate = async (path: string): Promise<string | null> => {
    try {
      return (await api.read(path)).content;
    } catch {
      return null;
    }
  };

  /** 데일리 노트를 다룰 워크스페이스: 지금 워크스페이스(모든 워크스페이스 보기면 지금 문서의 것) */
  const dailyWs = allWs ? wsOfPath(doc?.path) : ws;
  const dailyCfg: DailyConfig | null = dailyWs ? daily.of(dailyWs) : null;
  /** 데일리 노트 목록(판정 규칙: 경로·이름. 날짜순) */
  const dailyList = useMemo(() => dailyNotes(resolver.paths, dailyCfg), [resolver, dailyCfg]);
  const [dailyChoices, setDailyChoices] = useState<DailyNote[]>([]);

  /**
   * 그날 데일리 노트 열기(지금 워크스페이스). 그날 날짜로 시작하는 노트가 있으면 그것(제목이 붙어 있어도), 둘 이상이면 고르는 목록,
   * 없으면 날짜만으로 새로 만들고(템플릿 + 자동 속성) 제목 칸에 커서를 둔다.
   */
  const openDailyOn = async (day: Date) => {
    await vaultSettingsReady();
    const s = getVaultSettings();
    const w = dailyWs;
    const cfg = w ? dailyLookup(s, () => wsNames, uiLang).of(w) : null;
    if (!w || !cfg) return toast(t("daily.off"), { kind: "info" });
    const found = dailyNotes(resolver.paths, cfg).filter((n) => n.ymd === ymd(day));
    if (found.length === 1) return void open(found[0].path);
    if (found.length > 1) {
      setDailyChoices(found);
      setPalette("daily");
      return;
    }
    const wsSet = workspaceSettings(s, w, uiLang);
    const path = dailyNotePath(cfg.folder, cfg.format, day, { weekStart: cfg.weekStart, lang: cfg.lang });
    const tpl = wsSet.daily.template ? await readTemplate(join(w, wsSet.daily.template)) : null;
    const body = tpl ? applyTemplate(tpl, { title: stemOf(path), date: day, weekStart: cfg.weekStart, lang: cfg.lang }) : "";
    let content = body;
    try {
      content = withDailyTags(body, day, { weekStart: cfg.weekStart, icon: wsSet.daily.icon || undefined, lang: cfg.lang });
    } catch (e) {
      // 템플릿의 프런트매터가 깨져 있으면 속성 없이 만든다
      toast(t("daily.propsFailed", { message: errorText(e) }), { kind: "warn" });
    }
    try {
      await api.write(path, content, null);
      vaultChanged();
      await refreshTree();
      focusTitle(path);
    } catch (e) {
      // 그 사이 다른 곳에서 만들었으면 그것을 연다
      if (!(e instanceof ApiError && e.status === 409)) return toastError(e);
    }
    await open(path);
    setMode((m) => (m === "preview" ? "edit" : m));
  };
  const openDaily = (offset = 0) => openDailyOn(shiftDays(new Date(), offset));

  /** 바로 앞·뒤 데일리 노트(빠진 날은 건너뛴다). 지금 문서가 데일리 노트가 아니면 오늘 기준 */
  const dailyStep = (dir: -1 | 1) => {
    const cur = docRef.current ? dailyOfPath(docRef.current.path, daily) : null;
    const base = cur?.ymd ?? ymd(new Date());
    const list = cur ? dailyNotes(resolver.paths, daily.of(workspaceOf(cur.path))) : dailyList;
    const target = dir < 0 ? [...list].reverse().find((n) => n.ymd < base) : list.find((n) => n.ymd > base);
    if (target) void open(target.path);
    else toast(dir < 0 ? t("daily.noPrev") : t("daily.noNext"), { kind: "info", duration: 2500 });
  };

  /** 기존 데일리 노트를 지금 형식으로 옮기기(지금 워크스페이스): 계획을 보이고 확인하면 한 번에(한 커밋·한 기록, 링크 자동 갱신) */
  const [migration, setMigration] = useState<(ReturnType<typeof planDailyMigration> & { cfg: DailyConfig }) | null>(null);
  const migrateDaily = async (w = dailyWs) => {
    await flush();
    await vaultSettingsReady();
    const cfg = w ? dailyLookup(getVaultSettings(), () => wsNames, uiLang).of(w) : null;
    if (!cfg) return toast(t("daily.off"), { kind: "info" });
    setMigration({ ...planDailyMigration(resolver.paths, cfg), cfg });
  };
  const runMigration = async () => {
    if (!migration) return;
    const moves = migration.moves;
    const dirtyDoc = moves.find((m) => {
      const d = m.from === docRef.current?.path ? docRef.current : tabCache.current.get(m.from);
      return d && d.draft !== d.saved;
    });
    if (dirtyDoc) return toast(t("doc.saveFirst", { name: stemOf(dirtyDoc.from) }), { kind: "error" });
    try {
      const r = await api.moveFiles(
        moves.map((m) => [m.from, m.to]),
        vaultText(vaultLang()).commit.dailyMigrate(moves.length),
      );
      for (const m of moves) await afterMove(m.from, m.to, null, null);
      setMigration(null);
      vaultChanged();
      await refreshTree();
      const cur = docRef.current;
      if (cur && moves.some((m) => m.to === cur.path)) await load(cur.path);
      toast([t("daily.migrated", { count: moves.length }), r.linkCount ? t("links.fixed", { count: r.linkCount }) : ""].filter(Boolean).join(" "), {
        kind: "success",
      });
    } catch (e) {
      toastError(e);
    }
  };

  /** 템플릿 폴더(지금 워크스페이스)의 문서들 */
  const templateDir = ws ? templateDirFor(shared, wsOfPath(doc?.path), uiLang) : "";
  const templatePaths = resolver.paths.filter((p) => /\.md$/i.test(p) && !!templateDir && p.startsWith(templateDir + "/"));

  const insertTemplate = async (path: string) => {
    const tpl = await readTemplate(path);
    if (tpl === null || !doc) return;
    const title = doc.path.split("/").pop()!.replace(/\.md$/i, "");
    editorHandle.current?.insertText(applyTemplate(tpl, { title, date: new Date(), lang: vaultLang() }));
  };

  /** 템플릿으로 새 노트: 템플릿이 제목을 쓰므로 제목만 묻는다(위치는 지금 노드의 형제) */
  const createFromTemplate = async (tplPath: string) => {
    const tpl = await readTemplate(tplPath);
    if (tpl === null) return;
    const name = await promptDialog(t("doc.newTitle"), "", t("common.create"));
    if (!name) return;
    const reason = invalidNameReason(name);
    if (reason) return toast(reason, { kind: "error" });
    const parent = currentParent();
    if (!parent) return toast(t("ws.needOne"), { kind: "info" });
    const path = uniquePath(parent, name.trim(), resolver.paths);
    try {
      await api.write(path, applyTemplate(tpl, { title: stemOf(path), date: new Date(), lang: vaultLang() }), null);
      vaultChanged();
      await refreshTree();
      void open(path, { newTab: true });
    } catch (e) {
      toastError(e);
    }
  };

  /** 문서 해시: 지금 문서면 저장한 뒤의 것, 아니면 읽어서 */
  const hashOf = async (path: string): Promise<string | null> => {
    const cur = docRef.current;
    if (cur?.path === path) {
      if (!(await flush()) || docRef.current!.draft !== docRef.current!.saved) {
        toast(t("doc.unsavedNoMove"), { kind: "error" });
        return null;
      }
      return docRef.current!.hash;
    }
    const cached = tabCache.current.get(path);
    if (cached && cached.draft !== cached.saved) {
      toast(t("doc.saveTabFirst", { name: stemOf(path) }), { kind: "error" });
      return null;
    }
    return (await api.read(path, { fresh: true })).hash;
  };

  /** 이동이 끝난 뒤: 탭·열린 문서·기록의 경로를 바꾼다. content가 null이면(여러 개를 옮김) 그 문서를 다시 읽는다 */
  const afterMove = async (from: string, to: string, content: string | null, hash: string | null) => {
    moveFolds(from, to);
    setTabsByScope((m) => {
      const out: Record<string, string[]> = {};
      for (const [k, list] of Object.entries(m)) out[k] = list.map((p) => (p === from ? to : p));
      return out;
    });
    setLastByScope((m) => Object.fromEntries(Object.entries(m).map(([k, p]) => [k, p === from ? to : p])));
    setRecent((r) => r.map((p) => (p === from ? to : p)));
    nav.current.list = nav.current.list.map((p) => (p === from ? to : p));
    const cached = tabCache.current.get(from);
    if (cached) {
      tabCache.current.delete(from);
      if (content !== null && hash !== null) tabCache.current.set(to, { ...cached, path: to, saved: content, draft: content, hash, seq: cached.seq + 1 });
    }
    const cur = docRef.current;
    if (cur?.path === from) {
      history.replaceState(null, "", `#/${encodeURIComponent(to)}`);
      if (content === null || hash === null) await load(to);
      // 내용이 그대로면(상대 링크를 고치지 않았으면) 에디터를 다시 만들지 않는다
      else if (cur.draft === content) setDoc({ ...cur, path: to, saved: content, hash });
      else setDoc({ ...cur, path: to, saved: content, draft: content, hash, seq: cur.seq + 1 });
    }
    if (aside === from) setAside(to);
  };

  /** 첨부 하나 옮기기·이름 바꾸기. 이 첨부를 가리키던 링크는 서버가 같이 고친다 */
  const moveAttachment = async (from: string, to: string, opts: { undo?: boolean } = {}): Promise<boolean> => {
    if (from === to) return true;
    if (resolver.paths.some((p) => p.toLowerCase() === to.toLowerCase())) {
      toast(t("node.exists", { name: to }), { kind: "error" });
      return false;
    }
    try {
      const d = await api.move(from, to, await sha256Hex(await api.readBytes(from)));
      if (fileView === from) setFileView(d.path);
      vaultChanged();
      await refreshTree();
      toast([t("file.moved", { name: d.path.split("/").pop()! }), d.linkCount ? t("links.fixed", { count: d.linkCount }) : ""].filter(Boolean).join(" "), {
        kind: "success",
        action: opts.undo === false ? undefined : { label: t("common.undo"), run: () => void moveAttachment(d.path, from, { undo: false }) },
      });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(t("doc.changedRetry"), { kind: "error" });
      else toastError(e);
      return false;
    }
  };

  /**
   * 노드 옮기기·이름 바꾸기: 노드 노트(A.md)와 하위(A/ 아래 문서·첨부)를 한 번에(서버는 한 커밋, 앱은 한 기록) 옮기고 링크를 고친다.
   * 하위가 없는 노드는 문서 하나 이동과 같다.
   */
  const moveNodeTo = async (from: string, to: string, opts: { undo?: boolean; quiet?: boolean } = {}): Promise<boolean> => {
    if (from === to) return true;
    if (to.startsWith(from + "/")) {
      toast(t("node.intoSelf"), { kind: "error" });
      return false;
    }
    if (!to.includes("/")) {
      toast(t("node.rootNotAllowed"), { kind: "error" });
      return false;
    }
    if (nodeExists(to, resolver.paths) && to.toLowerCase() !== from.toLowerCase()) {
      toast(t("node.exists", { name: to }), { kind: "error" });
      return false;
    }
    await flush();
    const inside = (p: string) => p === `${from}.md` || p.startsWith(from + "/");
    const dirtyDoc = [docRef.current, ...tabCache.current.values()].find((d) => d && inside(d.path) && d.draft !== d.saved);
    if (dirtyDoc) {
      toast(t("doc.saveFirst", { name: stemOf(dirtyDoc.path) }), { kind: "error" });
      return false;
    }
    const files = nodeFiles(from, resolver.paths);
    try {
      let linkCount = 0;
      let others = 0;
      if (files.length === 1 && files[0] === `${from}.md`) {
        // 잎 노드: 문서 하나 이동
        const hash = await hashOf(files[0]);
        if (hash === null) return false;
        const d = await api.move(files[0], `${to}.md`, hash);
        await afterMove(files[0], d.path, d.content, d.hash);
        linkCount = d.linkCount ?? 0;
        others = (d.linksUpdated ?? []).filter((p) => p !== d.path).length;
      } else {
        const r = await api.moveNode(from, to);
        for (const [a, b] of r.moved) if (/\.md$/i.test(a)) await afterMove(a, b, null, null);
        linkCount = r.linkCount;
        others = r.linksUpdated.filter((p) => !r.moved.some(([, b]) => b === p)).length;
      }
      if (fileView && inside(fileView)) setFileView(moveNodePath(fileView, from, to));
      vaultChanged();
      await refreshTree();
      if (!opts.quiet) {
        const renamed = parentOf(from) === parentOf(to);
        toast(
          [
            renamed ? t("node.renamed", { name: stemOf(to) }) : t("node.moved", { parent: parentOf(to) }),
            linkCount ? t("links.fixedIn", { count: linkCount, docs: others }) : "",
          ]
            .filter(Boolean)
            .join(" "),
          { kind: "success", action: opts.undo === false ? undefined : { label: t("common.undo"), run: () => void moveNodeTo(to, from, { undo: false }) } },
        );
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(t("node.moveFailed", { message: errorText(e) }), { kind: "error" });
      else toastError(e);
      return false;
    }
  };

  /** 이름 바꾸기(노드). 데일리 노트의 날짜가 바뀌면 자동 태그(있는 것만)도 같이 고친다 */
  const renameNode = async (node: string, name: string) => {
    const path = `${node}.md`;
    const before = dailyOfPath(path, daily);
    const to = join(parentOf(node), name);
    if (!(await moveNodeTo(node, to))) return false;
    const after = dailyOfPath(`${to}.md`, daily);
    const cur = docRef.current;
    if (after && before?.ymd !== after.ymd && cur?.path === `${to}.md`) {
      try {
        const cfg = daily.of(workspaceOf(cur.path));
        const next = updateDailyTags(cur.draft, after.date, cfg?.weekStart, cfg?.lang);
        if (next) {
          editorHandle.current?.setContent(next);
          toast(t("daily.tagsUpdated", { date: after.ymd }), { kind: "info", duration: 3000 });
        }
      } catch {
        /* 프런트매터가 깨져 있으면 그대로 */
      }
    }
    return true;
  };

  /** 탭·기록에서 지운 노드의 문서를 뺀다 */
  const forget = (gone: (p: string) => boolean) => {
    for (const p of tabCache.current.keys()) if (gone(p)) tabCache.current.delete(p);
    setTabsByScope((m) => Object.fromEntries(Object.entries(m).map(([k, list]) => [k, list.filter((p) => !gone(p))])));
    setRecent((r) => r.filter((p) => !gone(p)));
    const cur = docRef.current;
    if (cur && gone(cur.path)) {
      setDoc(null);
      history.replaceState(null, "", "#");
      const rest = tabsRef.current.filter((p) => !gone(p));
      if (rest.length) showDoc(rest[rest.length - 1]);
    }
  };

  /**
   * 노드 삭제: 노드 노트와 하위 전체를 한 번에(한 커밋). 하위 개수를 보여 주고 확인받는다.
   * 지우기 전에 내용을 읽어 두어 알림의 "되돌리기"가 하위까지 되살린다.
   */
  const deleteNode = async (node: string) => {
    const n = findNode(nodeTree, node);
    const counts = n ? countNode(n) : { nodes: 0, attachments: 0 };
    const name = stemOf(node);
    const message =
      counts.nodes || counts.attachments
        ? t("node.deleteAskChildren", { name, nodes: counts.nodes, attachments: counts.attachments })
        : t("node.deleteAsk", { name });
    if (!(await confirmDialog(`${message}\n${node}`, t("common.delete")))) return;
    await flush();
    const files = nodeFiles(node, resolver.paths).filter((p) => !isVaultSettingsPath(p));
    try {
      const saved: { path: string; content?: string; data?: Uint8Array; hash: string }[] = [];
      for (const p of files) {
        if (/\.md$/i.test(p)) {
          const d = await api.read(p, { fresh: true });
          saved.push({ path: p, content: d.content, hash: d.hash });
        } else {
          const data = await api.readBytes(p);
          saved.push({ path: p, data, hash: await sha256Hex(data) });
        }
      }
      await api.deleteNode(node, saved);
      vaultChanged();
      await refreshTree();
      forget((p) => p === `${node}.md` || p.startsWith(node + "/"));
      toast(t("node.deleted", { name }), {
        kind: "info",
        action: {
          label: t("common.undo"),
          run: () =>
            void api
              .restoreFiles(saved.map(({ path, content, data }) => ({ path, content, data })))
              .then(async () => {
                vaultChanged();
                await refreshTree();
                if (saved.some((s) => s.path === `${node}.md`)) void open(`${node}.md`);
              })
              .catch(toastError),
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(t("node.changedRetry"), { kind: "error" });
      else toastError(e);
    }
  };

  /** 첨부 하나 지우기 */
  const deleteAttachment = async (path: string) => {
    if (!(await confirmDialog(t("file.deleteAsk", { name: path.split("/").pop()! }), t("common.delete")))) return;
    try {
      const data = await api.readBytes(path);
      await api.remove(path, await sha256Hex(data));
      vaultChanged();
      await refreshTree();
      toast(t("file.deleted", { name: path.split("/").pop()! }), {
        kind: "info",
        action: {
          label: t("common.undo"),
          run: () =>
            void api
              .restoreFiles([{ path, data }])
              .then(() => (vaultChanged(), refreshTree()))
              .catch(toastError),
        },
      });
    } catch (e) {
      toastError(e);
    }
  };

  const duplicateNode = async (node: VaultNode) => {
    if (!node.note) return;
    try {
      const d = await api.read(node.note);
      const copy = uniquePath(parentOf(node.path), `${node.name} ${vaultText(vaultLang()).copySuffix}`, resolver.paths);
      await api.write(copy, d.content, null);
      vaultChanged();
      await refreshTree();
      void open(copy, { newTab: true });
    } catch (e) {
      toastError(e);
    }
  };

  /** 노드 아이콘: 노드 노트의 icon 속성. 노트가 없으면 그때 만든다 */
  const openIconPicker = (node: string) => {
    const r = document.querySelector(".title-icon")?.getBoundingClientRect();
    setIconPick({ x: r ? r.left : Math.max(16, window.innerWidth / 2 - 160), y: r ? r.bottom + 4 : 96, node });
  };

  const setIcon = async (node: string, icon: string | null) => {
    const path = `${node}.md`;
    const cur = docRef.current;
    if (cur?.path === path) {
      try {
        editorHandle.current?.setContent(setFrontmatterField(cur.draft, "icon", icon));
      } catch (e) {
        toastError(e);
      }
      return;
    }
    try {
      const d = await api.read(path, { fresh: true }).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      });
      if (!d && !icon) return;
      await api.write(path, setFrontmatterField(d?.content ?? "", "icon", icon), d?.hash ?? null);
      vaultChanged();
      await refreshTree();
    } catch (e) {
      toastError(e);
    }
  };

  const copyText = (text: string, what: "path" | "link") =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast(t(what === "path" ? "copy.path" : "copy.link", { text }), { kind: "success", duration: 2500 }))
      .catch(() => toast(t("copy.failed"), { kind: "error" }));

  const startMove = (path: string, kind: "node" | "file") => {
    setMoveTarget({ path, kind });
    setPalette("move");
  };

  const showRevision = async (commit: CommitInfo) => {
    if (!doc) return;
    try {
      setRevision({ commit, content: await api.revision(doc.path, commit.rev) });
    } catch (e) {
      toastError(e);
    }
  };

  const rollback = async () => {
    if (!doc || !revision) return;
    if (dirty && !(await confirmDialog(t("history.discardRollback"), t("history.rollback")))) return;
    try {
      await api.rollback(doc.path, revision.commit.rev, doc.hash);
      vaultChanged();
      await load(doc.path);
      toast(t("history.rolledBack"), { kind: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(t("doc.changedReload"), { kind: "error" });
      else toastError(e);
    }
  };

  /** 위젯에서 문서를 바꿨을 때: 지금 연 문서면(저장 안 한 변경이 없을 때) 다시 불러온다. */
  const onWidgetChanged = (path: string) => {
    setVaultVersion((v) => v + 1);
    if (doc?.path === path) {
      if (doc.draft === doc.saved) void load(path);
      else toast(t("doc.changedByWidget"), { kind: "warn", duration: 0 });
    }
  };

  const followLinkRef = useRef<(target: string, anchor: { heading?: string; block?: string } | null, aside: boolean, page?: string) => void>(() => undefined);
  /** 링크 대상 열기: Mod+클릭이면 옆 칸 */
  const followLink = (target: string, anchor: { heading?: string; block?: string } | null, aside: boolean, page?: string) => {
    if (target.toLowerCase().endsWith(".md")) {
      if (aside) return setAside(target);
      if (anchor && target === doc?.path) scrollToAnchor(anchor);
      else {
        if (anchor) setPendingAnchor({ path: target, ...anchor });
        void open(target);
      }
    } else if (/\.pdf$/i.test(target)) {
      // [[x.pdf#page=3]] → 앱 안 PDF 보기의 그 쪽
      const p = /^page=(\d+)$/.exec(page ?? "")?.[1];
      setPdfView({ path: target, ...(p ? { page: Number(p) } : {}) });
    } else setFileView(target);
  };
  followLinkRef.current = followLink;

  /** 그린 블록·미리보기의 링크 하나를 따라간다(없는 문서면 만들지 묻는다: 링크를 쓴 문서의 워크스페이스에) */
  const followLinkEl = (a: HTMLAnchorElement, mod: boolean) => {
    const target = a.dataset.wikilink!;
    const anchor = a.dataset.block ? { block: a.dataset.block } : a.dataset.heading ? { heading: a.dataset.heading } : null;
    if (a.dataset.resolved === "1") return followLinkRef.current(target, anchor, mod, a.dataset.heading);
    void confirmDialog(t("link.createAsk", { name: target }), t("common.create")).then((yes) => {
      if (!yes) return;
      const base = /\.md$/i.test(target) ? target : `${target}.md`;
      // 경로 없는 이름이면 지금 문서와 같은 워크스페이스 맨 위에(볼트 맨 위에는 일반 노트를 두지 않는다)
      const path = base.includes("/") ? base : join(wsOfPath(docRef.current?.path) || "", base);
      api
        .write(path, "", null)
        .then(refreshTree)
        .then(() => openRef.current(path))
        .catch(toastError);
    });
  };

  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
    const fold = (e.target as HTMLElement).closest<HTMLElement>(".pv-fold");
    if (fold && doc && !revision) {
      e.preventDefault();
      togglePreviewFold(doc.path, doc.draft, Number(fold.dataset.foldLine));
      return;
    }
    const box = (e.target as HTMLElement).closest<HTMLInputElement>("input.task[data-task-line]");
    if (box) {
      // 체크박스는 편집 중인 초안을 바꾼다(저장해야 반영). 과거 버전 보기에서는 바꾸지 않는다.
      if (revision || !editorHandle.current) {
        e.preventDefault();
        return;
      }
      editorHandle.current.toggleTask(Number(box.dataset.taskLine), box.checked);
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
    followLinkEl(a, e.ctrlKey || e.metaKey);
  };

  /**
   * [[문서#제목]]·[[문서#^블록]]: 그 위치로 가서 잠깐 표시한다. 접혀 있으면 편다.
   * 편집 화면이면 에디터의 그 줄로, 미리보기면 미리보기의 그 블록으로.
   */
  const scrollToAnchor = (anchor: { heading?: string; block?: string }) => {
    const cur = docRef.current;
    if (!cur) return;
    if (modeRef.current !== "preview" && !revisionRef.current) {
      let line = 0;
      if (anchor.block) line = blockRange(cur.draft, anchor.block)?.start ?? 0;
      else line = headings(cur.draft).find((h) => h.text.toLowerCase() === (anchor.heading ?? "").toLowerCase())?.line ?? 0;
      if (line) return editorHandle.current?.gotoLine(line);
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
    for (let i = 0; i < 6 && !revisionRef.current && revealInPreview(el, cur.path, cur.draft); i++) {
      applyPreviewFolds(root, cur.path, cur.draft);
      el = find() ?? el;
    }
    el.scrollIntoView({ block: "start" });
    el.classList.add("anchor-flash");
    setTimeout(() => el!.classList.remove("anchor-flash"), 1600);
  };

  const previewSource = revision ? (revision.content ?? "") : (doc?.draft ?? "");
  const rendered = useMemo(
    // 속성 화면이 열려 있으면 미리보기에서는 프런트매터 상자를 빼고 본다(같은 내용을 두 번 보이지 않게)
    () => (doc ? renderMarkdown(previewSource, { resolver, docPath: doc.path, hideFrontmatter: !prefs.propsInDoc }) : { html: "", widgets: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewSource, resolver, doc?.path, assetVersion, prefs.propsInDoc],
  );

  // ── 패널
  const toggleLeft = () => {
    if (narrow()) return setDrawer((d) => (d === "left" ? null : "left"));
    setPrefs((p) => ({ leftOpen: !p.leftOpen }));
  };
  /** 오른쪽 패널을 그 탭으로 연다(이미 열려 있으면 탭만 바꾼다) */
  const showRight = (tab: Prefs["rightTab"]) => {
    setPrefs({ rightTab: tab });
    if (narrow()) setDrawer("right");
    else setPrefs({ rightOpen: true });
  };
  const toggleRight = (tab?: Prefs["rightTab"]) => {
    if (narrow()) {
      if (tab) setPrefs({ rightTab: tab });
      return setDrawer((d) => (d === "right" && (!tab || tab === rightTab) ? null : "right"));
    }
    setPrefs((p) => (tab && p.rightOpen && p.rightTab !== tab ? { rightTab: tab } : { rightOpen: !p.rightOpen, ...(tab ? { rightTab: tab } : {}) }));
  };
  const showLeft = (view: Prefs["leftView"]) => {
    if (narrow()) {
      setPrefs({ leftView: view });
      setDrawer((d) => (d === "left" && prefs.leftView === view ? null : "left"));
    } else setPrefs((p) => (p.leftOpen && p.leftView === view ? { leftOpen: false } : { leftOpen: true, leftView: view }));
    if (view === "search") setTimeout(() => searchInput.current?.focus(), 0);
  };

  const openSettings = (s: SettingsSection = "general") => {
    void flush();
    setDrawer(null);
    if (settingsFromLocation()) history.replaceState(null, "", `${SETTINGS_HASH}/${s}`);
    else history.pushState(null, "", `${SETTINGS_HASH}/${s}`);
    setSettings(s);
  };
  /** restore: 지금 문서 주소로 되돌린다(아니면 곧 다른 문서를 여는 중이라 비워 둔다) */
  const closeSettings = (restore = true) => {
    setSettings(null);
    const cur = docRef.current;
    history.replaceState(null, "", restore && cur ? `#/${encodeURIComponent(cur.path)}` : "#");
    // 복원·동기화 등으로 볼트가 바뀌었을 수 있다: 트리·문서·공통 설정을 다시 읽는다
    vaultChanged();
    void refreshTree();
    void reloadVaultSettings();
    const d = docRef.current;
    if (d && d.draft === d.saved && !d.virtual) void load(d.path);
  };

  const toggleMode = () => setMode((m) => (m === "preview" ? "edit" : "preview"));

  /** 워크스페이스 만들기·이름 바꾸기·순서(설정 → 워크스페이스) */
  const workspaceOps: WorkspaceOps = {
    names: wsNames,
    current: ws,
    iconOf: (name) => iconMap.get(`${name}.md`) ?? null,
    async create(name) {
      const n = name.trim();
      const reason = invalidNameReason(n);
      if (reason) throw new Error(reason);
      if (wsNames.some((w) => w.toLowerCase() === n.toLowerCase()) || isVaultSettingsPath(`${n}.md`)) throw new Error(t("ws.exists", { name: n }));
      await api.write(`${n}.md`, "", null);
      vaultChanged();
      await refreshTree();
      await switchScope({ workspace: n, all: false });
    },
    async rename(from, to) {
      const n = to.trim();
      const reason = invalidNameReason(n);
      if (reason) throw new Error(reason);
      if (wsNames.some((w) => w.toLowerCase() === n.toLowerCase() && w !== from) || isVaultSettingsPath(`${n}.md`))
        throw new Error(t("ws.exists", { name: n }));
      await flush();
      const r = await api.moveNode(from, n);
      for (const [a, b] of r.moved) if (/\.md$/i.test(a)) await afterMove(a, b, null, null);
      // 워크스페이스별 설정과 순서도 새 이름으로
      const s = getVaultSettings();
      if (s.workspaces[from]) {
        await updateVaultSetting(["workspaces", n], s.workspaces[from]);
        await updateVaultSetting(["workspaces", from], null);
      }
      if (s.workspaceOrder.includes(from))
        await updateVaultSetting(
          ["vault", "workspaceOrder"],
          s.workspaceOrder.map((w) => (w === from ? n : w)),
        );
      setTabsByScope((m) => {
        const next = { ...m, [n]: (m[from] ?? []).map((p) => (p.startsWith(from + "/") || p === `${from}.md` ? moveNodePath(p, from, n) : p)) };
        delete next[from];
        return next;
      });
      if (ws === from) setPrefs({ workspace: n });
      vaultChanged();
      await refreshTree();
    },
    async reorder(names) {
      await updateVaultSetting(["vault", "workspaceOrder"], names);
    },
    pickIcon(name, at) {
      setIconPick({ ...at, node: name });
    },
    open(name) {
      void openNode(name);
    },
  };

  // ── 명령: 팔레트·단축키·설정의 단축키 목록이 같이 쓴다
  const g = {
    nav: t("cmd.group.nav"),
    doc: t("cmd.group.doc"),
    tab: t("cmd.group.tab"),
    view: t("cmd.group.view"),
    fold: t("cmd.group.fold"),
    tool: t("cmd.group.tool"),
    ws: t("cmd.group.ws"),
  };
  const commands: Command[] = [
    { id: "quick-open", group: g.nav, label: t("cmd.quickOpen"), keys: "Mod+O", run: () => setPalette("files") },
    { id: "palette", group: g.nav, label: t("cmd.palette"), keys: "Mod+P", run: () => setPalette("commands") },
    { id: "palette-2", group: g.nav, label: t("cmd.palette2"), keys: "Mod+Shift+P", run: () => setPalette("commands"), hidden: true },
    {
      id: "search",
      group: g.nav,
      label: t("cmd.search"),
      keys: "Mod+Shift+F",
      run: () => (setPrefs({ leftOpen: true, leftView: "search" }), narrow() && setDrawer("left"), setTimeout(() => searchInput.current?.focus(), 0)),
    },
    { id: "back", group: g.nav, label: t("cmd.back"), keys: "Mod+Alt+ArrowLeft", run: () => goNav(-1) },
    { id: "forward", group: g.nav, label: t("cmd.forward"), keys: "Mod+Alt+ArrowRight", run: () => goNav(1) },
    {
      id: "home",
      group: g.nav,
      label: t("cmd.home"),
      run: () =>
        void (async () => {
          await flush();
          if (docRef.current) tabCache.current.set(docRef.current.path, docRef.current);
          setDoc(null);
          closeSettings(false);
          history.replaceState(null, "", "#");
        })(),
    },
    ...wsNames
      .slice(0, 9)
      .map((w, i) => ({ id: `ws-${i + 1}`, group: g.ws, label: t("cmd.switchWs", { name: w }), run: () => void switchScope({ workspace: w, all: false }) })),
    { id: "ws-all", group: g.ws, label: allWs ? t("cmd.wsOnlyOne") : t("cmd.wsAll"), run: () => void switchScope({ all: !allWs }) },
    { id: "new", group: g.doc, label: t("cmd.new"), keys: "Mod+N", webKeys: "Alt+N", run: () => void createDoc() },
    ...(dailyCfg
      ? [
          { id: "daily", group: g.doc, label: t("cmd.daily"), keys: "Mod+Shift+D", run: () => void openDaily(0) },
          { id: "daily-prev", group: g.doc, label: t("cmd.dailyPrev"), run: () => dailyStep(-1) },
          { id: "daily-next", group: g.doc, label: t("cmd.dailyNext"), run: () => dailyStep(1) },
          { id: "daily-yesterday", group: g.doc, label: t("cmd.dailyYesterday"), run: () => void openDaily(-1) },
          { id: "daily-tomorrow", group: g.doc, label: t("cmd.dailyTomorrow"), run: () => void openDaily(1) },
          { id: "daily-migrate", group: g.doc, label: t("cmd.dailyMigrate"), run: () => void migrateDaily() },
        ]
      : []),
    { id: "tpl-new", group: g.doc, label: t("cmd.templateNew"), run: () => setPalette("new-from-template") },
    ...(doc && !doc.generated
      ? [
          { id: "tpl-insert", group: g.doc, label: t("cmd.templateInsert"), run: () => setPalette("templates") },
          { id: "save", group: g.doc, label: t("cmd.save"), keys: "Mod+S", run: () => void save() },
          { id: "rename", group: g.doc, label: t("common.rename"), keys: "F2", inInputs: false, run: () => focusTitle(doc.path) },
          { id: "icon", group: g.doc, label: docIcon ? t("title.changeIcon") : t("title.addIcon"), run: () => openIconPicker(stripMd(doc.path)) },
          { id: "new-child", group: g.doc, label: t("tree.newChild"), run: () => void createDoc(stripMd(doc.path)) },
          { id: "move", group: g.doc, label: t("tree.moveTo"), run: () => startMove(stripMd(doc.path), "node") },
          {
            id: "duplicate",
            group: g.doc,
            label: t("tree.duplicate"),
            run: () => {
              const n = findNode(nodeTree, stripMd(doc.path));
              if (n) void duplicateNode(n);
            },
          },
          { id: "delete", group: g.doc, label: t("tree.deleteNode"), run: () => void deleteNode(stripMd(doc.path)) },
        ]
      : []),
    ...(doc
      ? [
          { id: "copy-path", group: g.doc, label: t("tree.copyPath"), run: () => void copyText(doc.path, "path") },
          { id: "copy-link", group: g.doc, label: t("tree.copyLink"), run: () => void copyText(`[[${linkTo(doc.path)}]]`, "link") },
          {
            id: "reveal",
            group: g.nav,
            label: t("cmd.reveal"),
            run: () => (setPrefs({ leftOpen: true, leftView: "files" }), setTimeout(() => treeRef.current?.reveal(), 0)),
          },
        ]
      : []),
    { id: "close-tab", group: g.tab, label: t("cmd.closeTab"), keys: "Mod+W", webKeys: "Alt+W", run: () => doc && void closeTab(doc.path) },
    {
      id: "reopen-tab",
      group: g.tab,
      label: t("cmd.reopenTab"),
      keys: "Mod+Shift+T",
      webKeys: "Alt+Shift+T",
      run: () => closedTabs.current[0] && void open(closedTabs.current.shift()!, { newTab: true }),
    },
    { id: "next-tab", group: g.tab, label: t("cmd.nextTab"), keys: "Ctrl+Tab", webKeys: "Alt+]", run: () => cycleTab(1) },
    { id: "prev-tab", group: g.tab, label: t("cmd.prevTab"), keys: "Ctrl+Shift+Tab", webKeys: "Alt+[", run: () => cycleTab(-1) },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `tab-${i + 1}`,
      group: g.tab,
      label: t("cmd.nthTab", { n: i + 1 }),
      keys: `Mod+${i + 1}`,
      webKeys: `Alt+${i + 1}`,
      hidden: true,
      run: () => {
        const list = tabsRef.current;
        const p = i === 8 ? list[list.length - 1] : list[i];
        if (p) void open(p);
      },
    })),
    { id: "toggle-mode", group: g.view, label: t("cmd.toggleMode"), keys: "Mod+E", run: toggleMode },
    // 접기: CodeMirror 기본 키(foldKeymap). 설정에서 바꿀 수 있다
    { id: "fold", group: g.fold, label: t("cmd.fold"), keys: "Mod+Shift+[", macKeys: "Mod+Alt+[", run: () => editorHandle.current?.fold("here") },
    { id: "unfold", group: g.fold, label: t("cmd.unfold"), keys: "Mod+Shift+]", macKeys: "Mod+Alt+]", run: () => editorHandle.current?.fold("unfold-here") },
    { id: "fold-all", group: g.fold, label: t("cmd.foldAll"), keys: "Ctrl+Alt+[", run: () => editorHandle.current?.fold("all") },
    { id: "unfold-all", group: g.fold, label: t("cmd.unfoldAll"), keys: "Ctrl+Alt+]", run: () => editorHandle.current?.fold("unfold-all") },
    { id: "fold-level", group: g.fold, label: t("cmd.foldLevel"), run: () => editorHandle.current?.fold("level") },
    { id: "mode-edit", group: g.view, label: t("cmd.modeEdit"), run: () => setMode("edit") },
    { id: "mode-split", group: g.view, label: t("cmd.modeSplit"), run: () => setMode("split") },
    { id: "mode-preview", group: g.view, label: t("cmd.modePreview"), run: () => setMode("preview") },
    {
      id: "aside",
      group: g.view,
      label: aside ? t("cmd.asideClose") : t("cmd.asideOpen"),
      keys: "Mod+\\",
      run: () => setAside((a) => (a ? null : (doc?.path ?? null))),
    },
    // 패널 키는 접기 기본 키(Ctrl+Alt+[ 등, CodeMirror foldKeymap)와 겹치지 않게
    { id: "left", group: g.view, label: t("cmd.left"), keys: "Mod+Shift+E", run: toggleLeft },
    { id: "right", group: g.view, label: t("cmd.right"), keys: "Mod+Alt+B", run: () => toggleRight() },
    { id: "outline", group: g.view, label: t("panel.outline"), run: () => toggleRight("outline") },
    { id: "links", group: g.view, label: t("cmd.links"), run: () => toggleRight("links") },
    { id: "history", group: g.view, label: t("panel.history"), run: () => toggleRight("history") },
    { id: "live", group: g.view, label: live ? t("cmd.liveOff") : t("cmd.liveOn"), run: () => setPrefs({ live: !live }) },
    { id: "props", group: g.view, label: t("cmd.props"), run: () => toggleRight("props") },
    { id: "lines", group: g.view, label: prefs.lineNumbers ? t("cmd.linesOff") : t("cmd.linesOn"), run: () => setPrefs({ lineNumbers: !prefs.lineNumbers }) },
    {
      id: "width",
      group: g.view,
      label: prefs.readableWidth ? t("cmd.wide") : t("cmd.readable"),
      run: () => setPrefs({ readableWidth: !prefs.readableWidth }),
    },
    {
      id: "theme",
      group: g.view,
      label: t("cmd.theme"),
      run: () => setPrefs((p) => ({ theme: p.theme === "system" ? "light" : p.theme === "light" ? "dark" : "system" })),
    },
    { id: "graph", group: g.tool, label: t("tool.graph"), run: () => setGraphOpen(true) },
    { id: "lint", group: g.tool, label: t("tool.lint"), run: () => setLintOpen(true) },
    ...(local
      ? [{ id: "sync", group: g.tool, label: t("tool.device"), run: () => openSettings("device") }]
      : [
          { id: "ingest", group: g.tool, label: t("tool.ingest"), run: () => setIngestOpen(true) },
          { id: "review", group: g.tool, label: t("tool.review"), run: () => setReviewOpen(true) },
          { id: "admin", group: g.tool, label: t("cmd.admin"), run: () => openSettings("server-status") },
        ]),
    { id: "settings", group: g.tool, label: t("settings.title"), keys: "Mod+,", run: () => openSettings() },
    { id: "keys", group: g.tool, label: t("cmd.keys"), keys: "Mod+/", run: () => setKeysOpen(true) },
  ];
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const keyOf = (id: string) => {
    const c = commands.find((x) => x.id === id);
    return c ? commandKey(c, prefs.keys) : undefined;
  };
  /** 툴팁 글: 이름 뒤에 그 명령의 단축키(있으면) */
  const withKey = (label: string, id: string) => {
    const k = keyOf(id);
    return k ? `${label} (${formatCombo(k)})` : label;
  };

  function cycleTab(dir: number) {
    const list = tabsRef.current;
    if (list.length < 2 || !docRef.current) return;
    const i = list.indexOf(docRef.current.path);
    void open(list[(i + dir + list.length) % list.length]);
  }

  // 단축키: 에디터보다 먼저 받는다(Mod+S 등은 에디터 키맵과 같은 동작)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyCapture.active || e.defaultPrevented) return;
      // 대화상자(확인·입력·팔레트) 안에서는 Mod 조합만
      const c = matchCommand(e, commandsRef.current, prefsRef.current.keys);
      if (!c) return;
      if ((e.target as HTMLElement).closest?.(".modal-backdrop, .kmodal-backdrop") && !/^(palette|quick-open)/.test(c.id)) return;
      e.preventDefault();
      e.stopPropagation();
      c.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // 빠른 전환: 지금 워크스페이스의 문서(열린 탭, 최근 문서가 먼저)
  const fileItems = useMemo<PaletteItem[]>(() => {
    const docs = resolver.paths.filter((p) => /\.md$/i.test(p) && !isVaultSettingsPath(p) && (!scope || inWorkspace(p, scope)));
    const order = (p: string) => (tabs.includes(p) ? 0 : recent.includes(p) ? 1 + recent.indexOf(p) / 100 : 2);
    return docs
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b, "ko"))
      .map((p) => {
        const d = dailyOfPath(p, daily);
        const icon = iconOf(p);
        return {
          id: p,
          // 데일리 노트는 읽기 좋은 날짜로도 찾을 수 있게
          label: d && !d.title && prefs.dailyFriendly ? `${stemOf(p)} ${friendlyDate(d.date, new Date(), lang)}` : stemOf(p),
          display: d ? docLabel(p) : undefined,
          icon: icon ? <DocIcon icon={icon} /> : undefined,
          detail: p.includes("/") ? parentOf(p) : undefined,
          run: (alt: boolean) => void open(p, { newTab: alt }),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver, tabs, recent, daily, iconMap, prefs.showIcons, prefs.dailyFriendly, scope, lang]);

  const commandItems: PaletteItem[] = commands
    .filter((c) => !c.hidden)
    .map((c) => ({ id: c.id, label: c.label, detail: formatCombo(commandKey(c, prefs.keys)) || undefined, run: () => c.run() }));

  /** 옮길 곳: 노드(워크스페이스 안의 노드와 워크스페이스 자체). 자기 자신·하위·지금 상위는 뺀다 */
  const moveItems: PaletteItem[] = useMemo(() => {
    if (!moveTarget) return [];
    const { path, kind } = moveTarget;
    const here = parentOf(path);
    const targets = flattenNodes(allWs ? nodeTree : wsNode(ws) ? [wsNode(ws)!] : []).map((n) => n.path);
    return targets
      .filter((f) => f !== here && !(kind === "node" && (f === path || f.startsWith(path + "/"))))
      .map((f) => ({
        id: f,
        label: f,
        run: () => void (kind === "node" ? moveNodeTo(path, join(f, path.split("/").pop()!)) : moveAttachment(path, join(f, path.split("/").pop()!))),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveTarget, nodeTree, allWs, ws]);

  /** 개요에서 접힌 제목(본문과 같은 기억) */
  const outlineFolded = useMemo(
    () => (doc && rightTab === "outline" ? resolveFolds(doc.draft.split("\n"), getFolds(doc.path)) : new Set<number>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc?.path, doc?.draft, rightTab, foldVersion],
  );
  const outline = useMemo(
    () => (doc && ((rightOpen && !isNarrow) || drawer === "right") && rightTab === "outline" ? headings(doc.draft) : []),
    [rightOpen, drawer, rightTab, doc?.draft],
  );

  // 수식·다이어그램·문서 임베드는 그린 뒤에 채운다(enhance.ts)
  useEffect(() => {
    if (!previewRef.current || !doc) return;
    return enhance(previewRef.current, { resolver, docPath: doc.path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode]);

  // 접기: 미리보기에 단추를 달고 기억한 대로 접는다. 에디터·개요에서 바꾸면 따라간다
  useEffect(() => onFoldsChange((path) => path === docRef.current?.path && setFoldVersion((v) => v + 1)), []);
  useLayoutEffect(() => {
    if (!previewRef.current || !doc || revision) return;
    applyPreviewFolds(previewRef.current, doc.path, doc.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode, foldVersion, revision]);

  // 다른 문서의 제목·블록 링크나 검색 결과로 왔으면 그 위치로
  useEffect(() => {
    if (!pendingAnchor || doc?.path !== pendingAnchor.path) return;
    const anchor = pendingAnchor;
    setPendingAnchor(null);
    // 그린 직후(임베드·다이어그램이 자리를 잡을 틈을 조금 두고)
    setTimeout(() => {
      if (anchor.line) editorHandle.current?.gotoLine(anchor.line, anchor.text);
      else scrollToAnchor(anchor);
    }, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, doc?.path, pendingAnchor]);

  // innerHTML이 바뀐 뒤 위젯 자리를 찾아 React 포털로 위젯을 그린다.
  useLayoutEffect(() => {
    setWidgetSlots(Array.from(previewRef.current?.querySelectorAll<HTMLElement>(".widget-slot") ?? []));
  }, [rendered.html, mode]);

  const treeActions: TreeActions = {
    open: (n, o) => void openNode(n, o),
    embedText: (p) => embedText(p),
    openAttachment: (p) => (/\.pdf$/i.test(p) ? setPdfView({ path: p }) : setFileView(p)),
    newChild: (parent) => void createDoc(parent || currentParent()),
    rename: (p, kind, name) => (kind === "node" ? renameNode(p, name) : moveAttachment(p, join(parentOf(p), name))),
    move: (p, kind, target) => void (kind === "node" ? moveNodeTo(p, join(target, p.split("/").pop()!)) : moveAttachment(p, join(target, p.split("/").pop()!))),
    moveTo: startMove,
    duplicate: (n) => void duplicateNode(n),
    remove: (p, kind) => void (kind === "node" ? deleteNode(p) : deleteAttachment(p)),
    copyPath: (p) => void copyText(p, "path"),
    copyLink: (p) => void copyText(`[[${linkTo(p)}]]`, "link"),
    openAside: (p) => setAside(p),
    pickIcon: (n, at) => setIconPick({ ...at, node: n.path }),
  };

  const treeDecor = useMemo<TreeDecor>(() => {
    const dirs = new Set(daily.all().map((d) => d.config.folder));
    return {
      label: (n) => (n.note ? docLabel(n.note) : n.name),
      icon: (n) => (n.note ? iconOf(n.note) : null),
      descending: (d) => prefs.dailySortDesc && [...dirs].some((dir) => d === dir || d.startsWith(dir + "/")),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, prefs.showIcons, prefs.dailySortDesc, prefs.dailyFriendly, iconMap, docIcon, doc?.path, lang]);

  const words = useMemo(() => {
    const text = doc?.draft ?? "";
    return { chars: text.replace(/\s/g, "").length, words: (text.match(/\S+/g) ?? []).length };
  }, [doc?.draft]);

  const linkCount = refs ? refs.linkedBy.length + refs.sources.length + refs.citedBy.length : 0;
  const railSide = "right" as const;
  const rl = prefs.railLabels && !isNarrow;

  // ── 화면 조각
  const wsIcon = (name: string) => (prefs.showIcons ? (iconMap.get(`${name}.md`) ?? null) : null);
  const wsSwitcher = (
    <button
      type="button"
      className={`ws-switch${rl ? " with-label" : ""}`}
      aria-haspopup="menu"
      aria-label={t("ws.switch", { name: allWs ? t("ws.all") : ws })}
      {...tipProps({ label: allWs ? t("ws.all") : ws || t("ws.none"), side: railSide })}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setWsMenu({ x: r.right + 4, y: r.top });
      }}
    >
      {allWs ? (
        <Layers size={18} strokeWidth={1.75} aria-hidden />
      ) : wsIcon(ws) ? (
        <span className="ws-emoji" aria-hidden>
          {wsIcon(ws)}
        </span>
      ) : (
        <span className="ws-letter" aria-hidden>
          {[...(ws || "?")][0]}
        </span>
      )}
      {rl && <span className="icon-btn-label">{allWs ? t("ws.all") : ws}</span>}
    </button>
  );
  // 워크스페이스마다 같은 폭의 앞자리(아이콘 또는 첫 글자)를 두어 이름이 왼쪽으로 맞고, 고른 것은 강조 모양으로
  const wsLead = (w: string) =>
    wsIcon(w) ? (
      <span className="ws-emoji menu-emoji" aria-hidden>
        {wsIcon(w)}
      </span>
    ) : (
      <span className="ws-letter menu-letter" aria-hidden>
        {[...w][0]}
      </span>
    );
  const wsMenuAt = wsMenu ?? { x: 64, y: 64 };
  const wsMenuItems: MenuEntry[] = [
    ...wsNames.map((w) => ({ label: w, lead: wsLead(w), checked: !allWs && w === ws, run: () => void switchScope({ workspace: w, all: false }) })),
    "-",
    { label: t("ws.all"), icon: Layers, checked: allWs, run: () => void switchScope({ all: !allWs }) },
    ...(ws && !allWs
      ? [
          {
            label: wsIcon(ws) ? t("ws.changeIcon", { name: ws }) : t("ws.addIcon", { name: ws }),
            icon: SmilePlus,
            run: () => setIconPick({ ...wsMenuAt, node: ws }),
          },
        ]
      : []),
    { label: t("ws.manage"), icon: SettingsIcon, run: () => openSettings("workspaces") },
  ];

  const rail = (
    <nav className={`rail${rl ? " with-labels" : ""}`} aria-label={t("rail.label")}>
      <div className="rail-top">
        {wsSwitcher}
        <span className="rail-sep" />
        <IconButton
          icon={Files}
          label={t("rail.files")}
          side={railSide}
          showLabel={rl}
          active={prefs.leftOpen && prefs.leftView === "files"}
          onClick={() => showLeft("files")}
        />
        <IconButton
          icon={Search}
          label={t("rail.search")}
          side={railSide}
          showLabel={rl}
          keys={keyOf("search")}
          active={prefs.leftOpen && prefs.leftView === "search"}
          onClick={() => showLeft("search")}
        />
        <IconButton
          icon={Tag}
          label={t("rail.tags")}
          side={railSide}
          showLabel={rl}
          active={prefs.leftOpen && prefs.leftView === "tags"}
          onClick={() => showLeft("tags")}
        />
        <IconButton
          icon={Paperclip}
          label={t("rail.attachments")}
          side={railSide}
          showLabel={rl}
          active={prefs.leftOpen && prefs.leftView === "attachments"}
          onClick={() => showLeft("attachments")}
        />
        <span className="rail-sep" />
        {dailyCfg && (
          <IconButton
            icon={CalendarDays}
            label={t("cmd.daily")}
            shortLabel={t("rail.daily")}
            side={railSide}
            showLabel={rl}
            keys={keyOf("daily")}
            onClick={() => void openDaily(0)}
          />
        )}
        <IconButton icon={Waypoints} label={t("tool.graph")} shortLabel={t("rail.graph")} side={railSide} showLabel={rl} onClick={() => setGraphOpen(true)} />
        {!local && (
          <IconButton
            icon={Inbox}
            label={t("tool.ingestLong")}
            shortLabel={t("rail.ingest")}
            side={railSide}
            showLabel={rl}
            onClick={() => setIngestOpen(true)}
          />
        )}
        {!local && (
          <IconButton
            icon={ListChecks}
            label={pendingCount ? t("tool.reviewWaiting", { count: pendingCount }) : t("tool.reviewLong")}
            shortLabel={t("rail.review")}
            side={railSide}
            showLabel={rl}
            badge={pendingCount}
            onClick={() => setReviewOpen(true)}
          />
        )}
        <IconButton
          icon={BrushCleaning}
          label={t("tool.lintLong")}
          shortLabel={t("rail.lint")}
          side={railSide}
          showLabel={rl}
          onClick={() => setLintOpen(true)}
        />
      </div>
      <div className="rail-bottom">
        {local && (
          <IconButton
            icon={RefreshCw}
            label={syncStatus?.settings ? t("sync.with", { server: syncStatus.settings.server }) : t("tool.device")}
            shortLabel={t("rail.sync")}
            side={railSide}
            showLabel={rl}
            className={`sync-button${syncStatus?.running ? " running" : ""}${syncStatus?.lastError ? " has-error" : ""}`}
            onClick={() => openSettings("device")}
          />
        )}
        <IconButton
          icon={Keyboard}
          label={t("cmd.keys")}
          shortLabel={t("rail.keys")}
          side={railSide}
          showLabel={rl}
          keys={keyOf("keys")}
          onClick={() => setKeysOpen(true)}
        />
        <IconButton
          icon={SettingsIcon}
          label={t("settings.title")}
          side={railSide}
          showLabel={rl}
          keys={keyOf("settings")}
          active={!!settings}
          onClick={() => (settings ? closeSettings() : openSettings())}
        />
        {!local && (
          <IconButton
            icon={LogOut}
            label={t("rail.logout")}
            side={railSide}
            showLabel={rl}
            onClick={async () => {
              await flush();
              const d = docRef.current;
              if (!d || d.draft === d.saved || (await confirmDialog(t("rail.logoutUnsaved"), t("rail.logout")))) onLogout();
            }}
          />
        )}
      </div>
    </nav>
  );

  const leftLabel = { files: t("rail.files"), search: t("rail.search"), tags: t("rail.tags"), attachments: t("rail.attachments") }[prefs.leftView];
  // 첨부 보기: 지금 워크스페이스(모든 워크스페이스면 전체)의 마크다운이 아닌 파일
  const attachmentPaths = resolver.paths.filter((p) => !/\.md$/i.test(p) && !isVaultSettingsPath(p) && (allWs || p.startsWith(`${ws}/`)));
  const canInsert = !!doc && !doc.generated && !revision && !doc.virtual;
  const leftPanel = (
    <aside className="left-panel" aria-label={leftLabel}>
      {prefs.leftView === "files" && (
        <>
          <div className="panel-head">
            {allWs ? (
              <strong>{t("ws.all")}</strong>
            ) : (
              <button type="button" className="panel-title-btn" {...tipProps({ label: t("ws.openNote") })} onClick={() => void openNode(ws)}>
                {wsIcon(ws) && <DocIcon icon={wsIcon(ws)} />}
                <strong>{ws}</strong>
              </button>
            )}
            <span className="panel-tools">
              <IconButton
                size={16}
                icon={FilePlus}
                label={t("tree.newNote")}
                keys={keyOf("new")}
                disabled={!ws}
                why={t("ws.needOne")}
                onClick={() => void createDoc()}
              />
              <IconButton
                size={16}
                icon={LocateFixed}
                label={t("tree.reveal")}
                disabled={!doc}
                why={t("tree.revealWhy")}
                onClick={() => treeRef.current?.reveal()}
              />
              <IconButton size={16} icon={ChevronsDownUp} label={t("tree.collapseAll")} onClick={() => treeRef.current?.collapseAll()} />
              <TreeOptions prefs={prefs} />
            </span>
          </div>
          <Tree
            ref={treeRef}
            nodes={viewNodes}
            root={scope}
            current={doc?.path ?? null}
            prefs={prefs}
            actions={treeActions}
            decor={treeDecor}
            storageKey={`keyring:tree-open:${scopeKey}`}
            readOnly={(p) => /\/wiki\/(index|log)\.md$/.test(p)}
          />
        </>
      )}
      {prefs.leftView === "search" && (
        <>
          <div className="panel-head">
            <strong>{t("rail.search")}</strong>
            {!allWs && <span className="meta panel-scope">{ws}</span>}
          </div>
          <div className="search-box">
            <input
              ref={searchInput}
              type="search"
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              aria-label={t("search.label")}
            />
            {semanticOn && (
              <button
                className={`search-mode${searchMode === "semantic" ? " on" : ""}`}
                {...tipProps({ label: t("search.semanticTip") })}
                onClick={() => setSearchMode((m) => (m === "text" ? "semantic" : "text"))}
              >
                {t("search.semantic")}
              </button>
            )}
          </div>
          {hits === null ? (
            <p className="meta panel-note">{t("search.hint")}</p>
          ) : (
            <ul className="search-results">
              {hits.map((h) => (
                <li key={`${h.path}:${h.line}`}>
                  <a
                    href={`#/${encodeURIComponent(h.path)}`}
                    className={h.path === doc?.path ? "active" : ""}
                    onClick={(e) => {
                      e.preventDefault();
                      const q = query.trim();
                      const text = q.startsWith("#") || searchMode === "semantic" ? undefined : q;
                      if (h.path === doc?.path) return editorHandle.current?.gotoLine(h.line, text);
                      if (h.line > 1 || text) setPendingAnchor({ path: h.path, line: h.line, text });
                      void open(h.path, { newTab: e.ctrlKey || e.metaKey });
                    }}
                  >
                    <span className="hit-title">
                      <DocIcon icon={iconOf(h.path)} />
                      {h.title} {h.score !== undefined && <span className="hit-score">{h.score.toFixed(2)}</span>}
                    </span>
                    <span className="hit-path">
                      {h.path}
                      {h.line > 1 ? ` · ${t("search.line", { line: h.line })}` : ""}
                    </span>
                    {h.snippet && <span className="hit-snippet">{h.snippet}</span>}
                  </a>
                </li>
              ))}
              {hits.length === 0 && <li className="meta">{t("search.none")}</li>}
            </ul>
          )}
        </>
      )}
      {prefs.leftView === "attachments" && (
        <>
          <div className="panel-head">
            <strong>{t("attach.title", { count: attachmentPaths.length })}</strong>
            {!allWs && <span className="meta panel-scope">{ws}</span>}
          </div>
          <AttachmentList
            paths={attachmentPaths}
            embedText={embedText}
            onOpen={(p) => treeActions.openAttachment(p)}
            onInsert={canInsert ? (p) => editorHandle.current?.insertText(embedText(p), { keepSelection: true, ownLine: true }) : undefined}
          />
        </>
      )}
      {prefs.leftView === "tags" && (
        <>
          <div className="panel-head">
            <strong>{t("tags.title", { count: tags.length })}</strong>
            {!allWs && <span className="meta panel-scope">{ws}</span>}
          </div>
          <div className="tag-cloud">
            {tags.map((tg) => (
              <button
                key={tg.tag}
                className="tag"
                onClick={() => {
                  setQuery(`#${tg.tag}`);
                  showLeft("search");
                }}
              >
                #{tg.tag} <span className="count">{fmtNumber(tg.count)}</span>
              </button>
            ))}
            {tags.length === 0 && <p className="meta">{t("tags.none")}</p>}
          </div>
        </>
      )}
    </aside>
  );

  const rightPanel = doc && (
    <aside className="right-panel" aria-label={t("panel.label")}>
      <div className="panel-head">
        <Segmented
          label={t("panel.label")}
          value={rightTab}
          onChange={(v) => setPrefs({ rightTab: v })}
          // 좁은 패널에서 글자가 줄바꿈되지 않게 아이콘(+ 개수)만 두고, 이름·설명·단축키는 툴팁으로
          options={[
            { value: "outline", label: <TableOfContents size={15} aria-label={t("panel.outline")} />, title: withKey(t("panel.outline"), "outline") },
            {
              value: "links",
              label: (
                <>
                  <Link2 size={15} aria-label={t("panel.links")} />
                  {linkCount > 0 && <span className="seg-count">{linkCount}</span>}
                </>
              ),
              title: `${linkCount ? t("panel.linksCount", { count: linkCount }) : t("panel.links")} · ${t("panel.linksTip")}`,
            },
            {
              value: "props",
              label: (
                <>
                  <SlidersHorizontal size={15} aria-label={t("panel.props")} />
                  {propCount > 0 && <span className="seg-count">{propCount}</span>}
                </>
              ),
              title: `${propCount ? t("panel.propsCount", { count: propCount }) : t("panel.props")} · ${t("panel.propsTip")}`,
            },
            { value: "history", label: <History size={15} aria-label={t("panel.history")} />, title: withKey(t("panel.history"), "history") },
          ]}
        />
        <IconButton
          size={16}
          icon={X}
          label={t("panel.close")}
          keys={keyOf("right")}
          onClick={() => (narrow() ? setDrawer(null) : setPrefs({ rightOpen: false }))}
        />
      </div>
      <div className="panel-body">
        {rightTab === "props" && (
          <Properties
            content={revision ? (revision.content ?? "") : doc.draft}
            stats={propStats}
            readOnly={doc.generated || !!revision}
            onChange={(next) => editorHandle.current?.setContent(next)}
            onPickIcon={(at) => setIconPick({ ...at, node: docNode })}
          />
        )}
        {rightTab === "outline" && (
          <ol className="outline-list">
            {outline.map((h) => (
              <li key={h.line} style={{ paddingLeft: `${(h.level - 1) * 12}px` }} className={outlineFolded.has(h.line) ? "folded" : undefined}>
                {h.endLine > h.line ? (
                  <button
                    className="outline-fold"
                    aria-label={outlineFolded.has(h.line) ? t("outline.unfoldName", { name: h.text }) : t("outline.foldName", { name: h.text })}
                    {...tipProps({ label: outlineFolded.has(h.line) ? t("outline.unfold") : t("outline.fold") })}
                    onClick={() => editorHandle.current?.toggleFoldLine(h.line)}
                  >
                    {outlineFolded.has(h.line) ? "▸" : "▾"}
                  </button>
                ) : (
                  <span className="outline-fold-space" />
                )}
                <button
                  onClick={() => {
                    editorHandle.current?.gotoLine(h.line);
                    scrollToAnchor({ heading: h.text.toLowerCase() });
                  }}
                >
                  {h.text}
                </button>
              </li>
            ))}
            {outline.length === 0 && <li className="meta">{t("outline.none")}</li>}
          </ol>
        )}
        {rightTab === "links" && (
          <>
            {refs ? (
              <References
                refs={refs}
                onOpen={(p, anchor) => {
                  if (anchor) setPendingAnchor({ path: p, ...(anchor.startsWith("^") ? { block: anchor.slice(1) } : { heading: anchor.toLowerCase() }) });
                  void open(p);
                }}
              />
            ) : (
              <p className="meta">{doc.virtual ? t("node.emptyHint") : t("common.loading")}</p>
            )}
            {!doc.generated && !doc.virtual && (
              <section className="backlinks mentions-wrap">
                <UnlinkedMentions
                  path={doc.path}
                  target={mentionTarget(doc.path, resolver)}
                  version={vaultVersion}
                  onOpen={(p) => void open(p)}
                  onChanged={vaultChanged}
                />
              </section>
            )}
          </>
        )}
        {rightTab === "history" && (
          <ol className="history-list">
            {commits.map((c) => (
              <li key={c.rev} className={revision?.commit.rev === c.rev ? "active" : ""}>
                <button onClick={() => showRevision(c)}>
                  <span className="msg">{c.message}</span>
                  <span className="meta">
                    {c.author} · {fmtDateTime(c.date)}
                  </span>
                </button>
              </li>
            ))}
            {(commits.length === 0 || doc.virtual) && <li className="meta">{t("history.none")}</li>}
          </ol>
        )}
      </div>
    </aside>
  );

  const docNode = doc ? stripMd(doc.path) : "";
  const isWsDoc = !!doc && !doc.path.includes("/");
  const docMenuItems: MenuEntry[] = doc
    ? [
        { label: t("cmd.save"), icon: Pencil, keys: keyOf("save"), disabled: !dirty || doc.generated, run: () => void save() },
        { label: t("common.rename"), keys: keyOf("rename"), disabled: doc.generated || isWsDoc, run: () => focusTitle(doc.path) },
        {
          label: docIcon ? t("title.changeIcon") : t("title.addIcon"),
          icon: SmilePlus,
          disabled: doc.generated || !!revision,
          run: () => openIconPicker(docNode),
        },
        ...(docIcon && !doc.generated && !revision ? [{ label: t("title.removeIcon"), run: () => void setIcon(docNode, null) }] : []),
        { label: t("tree.newChild"), icon: FilePlus, disabled: doc.generated, run: () => void createDoc(docNode) },
        { label: t("tree.moveTo"), icon: FolderInput, disabled: doc.generated || isWsDoc, run: () => startMove(docNode, "node") },
        {
          label: t("tree.duplicate"),
          icon: Copy,
          disabled: doc.virtual,
          run: () => {
            const n = findNode(nodeTree, docNode);
            if (n) void duplicateNode(n);
          },
        },
        "-",
        { label: t("cmd.asideOpen"), icon: Columns2, keys: keyOf("aside"), run: () => setAside(doc.path) },
        { label: t("cmd.modeSplit"), run: () => setMode("split") },
        {
          label: t("cmd.reveal"),
          icon: LocateFixed,
          run: () => (setPrefs({ leftOpen: true, leftView: "files" }), setTimeout(() => treeRef.current?.reveal(), 0)),
        },
        "-",
        { label: t("tree.copyPath"), run: () => void copyText(doc.path, "path") },
        { label: t("tree.copyLink"), icon: Link, run: () => void copyText(`[[${linkTo(doc.path)}]]`, "link") },
        { label: t("panel.history"), icon: History, run: () => toggleRight("history") },
        "-",
        { label: t("tree.deleteNode"), icon: Trash2, danger: true, disabled: doc.generated || isWsDoc, run: () => void deleteNode(docNode) },
      ]
    : [];

  /** 빵부스러기: 상위 노드들(누르면 그 노드를 연다) */
  const crumbs = doc
    ? docNode
        .split("/")
        .slice(0, -1)
        .map((_, i, all) => all.slice(0, i + 1).join("/"))
    : [];

  const saveLabel = (() => {
    if (!doc || doc.generated) return null;
    if (conflict || saveState.kind === "conflict") return { cls: "warn", text: t("status.conflict") };
    if (saveState.kind === "saving") return { cls: "", text: t("status.saving") };
    if (saveState.kind === "error" && dirty) return { cls: "error", text: t("status.failed") };
    if (dirty) return { cls: "dirty", text: prefs.autosave ? t("status.editing") : t("status.unsaved") };
    if (doc.virtual) return { cls: "muted", text: t("status.emptyNode") };
    if (saveState.kind === "queued" || doc.cachedOffline) return { cls: "warn", text: t("status.onDevice") };
    if (saveState.kind === "saved") return { cls: "ok", text: t("status.savedAgo", { ago: timeAgo(saveState.at, now) }) };
    return { cls: "ok", text: t("status.saved") };
  })();

  const statusBar = (
    <footer className="statusbar" aria-label={t("status.label")}>
      {saveLabel && (
        <button
          className={`status-item save-status ${saveLabel.cls}`}
          {...tipProps({
            label:
              saveState.kind === "error"
                ? t("status.errorTip", { message: saveState.message })
                : prefs.autosave
                  ? t("status.autosaveOn")
                  : t("status.autosaveOff"),
            side: "top",
          })}
          onClick={() => void save()}
        >
          <span className="dot" aria-hidden /> {saveLabel.text}
        </button>
      )}
      {!local && !online && <span className="status-item warn">{outboxCount ? t("status.offlineOutbox", { count: outboxCount }) : t("status.offline")}</span>}
      {!local && online && outboxCount > 0 && (
        <button className="status-item warn" onClick={() => void flushOutbox()} {...tipProps({ label: t("status.sendNowTip"), side: "top" })}>
          {t("status.sendNow", { count: outboxCount })}
        </button>
      )}
      {local && syncStatus?.settings && (
        <button
          className={`status-item${syncStatus.lastError ? " error" : ""}`}
          onClick={() => openSettings("device")}
          {...tipProps({ label: syncStatus.lastError ?? t("sync.with", { server: syncStatus.settings.server }), side: "top" })}
        >
          {syncStatus.running
            ? t("sync.running")
            : syncStatus.lastError
              ? t("sync.failed")
              : syncStatus.lastSync
                ? t("sync.ago", { ago: timeAgo(new Date(syncStatus.lastSync).getTime(), now) })
                : t("sync.waiting")}
        </button>
      )}
      {!local && pendingCount > 0 && (
        <button className="status-item" onClick={() => setReviewOpen(true)}>
          {t("status.reviewWaiting", { count: pendingCount })}
        </button>
      )}
      <span className="status-spacer" />
      {doc && (
        <>
          <span className="status-item muted" {...tipProps({ label: t("status.words", { count: words.words }), side: "top" })}>
            {t("status.chars", { count: words.chars })}
          </span>
          {mode !== "preview" && !revision && (
            <span className="status-item muted">
              {cursor.line}:{cursor.col}
            </span>
          )}
          <button
            className={`status-item${live ? "" : " muted"}`}
            onClick={() => setPrefs({ live: !live })}
            {...tipProps({ label: t("status.liveTip"), side: "top" })}
          >
            {live ? t("status.liveOn") : t("status.liveOff")}
          </button>
        </>
      )}
    </footer>
  );

  const tabBar = (
    <nav className="tabbar" aria-label={t("tab.label")}>
      <IconButton className="nav-toggle" icon={MenuIcon} label={t("tab.docList")} onClick={() => setDrawer((d) => (d === "left" ? null : "left"))} size={18} />
      <div className="tab-list" role="tablist">
        {tabs.map((tp) => {
          const cached = tp === doc?.path ? doc : tabCache.current.get(tp);
          const isDirty = !!cached && cached.draft !== cached.saved;
          return (
            <span key={tp} className={`tab${tp === doc?.path ? " on" : ""}`} {...tipProps({ label: tp })} role="tab" aria-selected={tp === doc?.path}>
              <button className="tab-name" onClick={() => void open(tp)} onAuxClick={(e) => e.button === 1 && void closeTab(tp)}>
                <DocIcon icon={iconOf(tp)} />
                {docLabel(tp)}
              </button>
              {isDirty ? <span className="tab-dirty" aria-label={t("status.unsaved")} /> : null}
              <button
                className="tab-close"
                aria-label={t("tab.closeName", { name: stemOf(tp) })}
                {...tipProps({ label: t("cmd.closeTab"), keys: keyOf("close-tab") })}
                onClick={() => void closeTab(tp)}
              >
                <X size={13} aria-hidden />
              </button>
            </span>
          );
        })}
      </div>
      <IconButton
        className="tab-new"
        icon={FilePlus}
        label={t("tree.newNote")}
        keys={keyOf("new")}
        disabled={!ws && !wsNames.length}
        why={t("ws.needOne")}
        onClick={() => void createDoc()}
        size={16}
      />
    </nav>
  );

  const center = doc ? (
    <>
      <header className="doc-head">
        <nav className="crumbs" aria-label={t("doc.crumbs")}>
          {crumbs.map((c) => (
            <span key={c} className="crumb">
              <button className="crumb-btn" onClick={() => void openNode(c)}>
                {iconOf(`${c}.md`) && <DocIcon icon={iconOf(`${c}.md`)} />}
                {stemOf(c)}
              </button>
              <ChevronRight size={12} aria-hidden />
            </span>
          ))}
          <span className="crumb current">{stemOf(doc.path)}</span>
        </nav>
        {docDaily && (
          <span className="daily-nav" aria-label={t("daily.nav")}>
            <IconButton icon={ChevronLeft} label={t("cmd.dailyPrev")} onClick={() => dailyStep(-1)} size={16} />
            <button type="button" className="daily-nav-date" {...tipProps({ label: t("cmd.daily") })} onClick={() => void openDaily(0)}>
              {friendlyDate(docDaily.date, new Date(), lang)}
            </button>
            <IconButton icon={ChevronRight} label={t("cmd.dailyNext")} onClick={() => dailyStep(1)} size={16} />
          </span>
        )}
        <div className="doc-tools">
          <Segmented
            label={t("doc.view")}
            value={revision ? "preview" : mode}
            onChange={(m) => setMode(m)}
            options={[
              {
                value: "edit",
                label: <Pencil size={15} aria-label={t("cmd.modeEditShort")} />,
                title: `${t("cmd.modeEditShort")} (${formatCombo(keyOf("toggle-mode"))})`,
              },
              { value: "split", label: <Columns2 size={15} aria-label={t("cmd.modeSplitShort")} />, title: t("cmd.modeSplit") },
              {
                value: "preview",
                label: <Eye size={15} aria-label={t("cmd.modePreviewShort")} />,
                title: `${t("cmd.modePreviewShort")} (${formatCombo(keyOf("toggle-mode"))})`,
              },
            ]}
          />
          <IconButton
            icon={SlidersHorizontal}
            label={propCount ? t("doc.propsCount", { count: propCount }) : t("doc.props")}
            active={propsShown}
            badge={!propsShown && propCount ? propCount : undefined}
            onClick={() => toggleRight("props")}
            size={16}
          />
          <IconButton
            icon={ListTree}
            label={t("doc.rightPanel")}
            keys={keyOf("right")}
            active={rightOpen}
            badge={!rightOpen && linkCount ? linkCount : undefined}
            onClick={() => toggleRight()}
            size={16}
          />
          <IconButton
            icon={Ellipsis}
            label={t("doc.menu")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setDocMenu({ x: r.right - 220, y: r.bottom + 4 });
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
          <button onClick={saveConflictCopy}>{t("doc.saveCopy")}</button>
          {conflict.currentHash !== null && (
            <button onClick={async () => (await confirmDialog(local ? t("doc.reloadAskLocal") : t("doc.reloadAskServer"), t("doc.reload"))) && load(doc.path)}>
              {local ? t("doc.reloadLocal") : t("doc.reloadServer")}
            </button>
          )}
        </div>
      )}
      {revision && (
        <div className="banner revision">
          {t("history.viewing", { rev: revision.commit.rev.slice(0, 7), author: revision.commit.author, date: fmtDateTime(revision.commit.date) })}
          {revision.content !== null && <button onClick={rollback}>{t("history.rollbackThis")}</button>}
          <button onClick={() => setRevision(null)}>{t("common.close")}</button>
        </div>
      )}

      <div className="doc-area">
        <div
          className={`panes mode-${revision ? "preview" : mode}${prefs.readableWidth ? " readable" : ""} font-${prefs.editorFont}`}
          style={{ ["--editor-size" as string]: `${prefs.editorSize}px` }}
        >
          <div className="pane edit-pane">
            <div className="page">
              <InlineTitle
                path={doc.path}
                readOnly={doc.generated || !!revision || isWsDoc}
                focusSignal={titleFocus?.path === doc.path ? titleFocus.n : 0}
                daily={docDaily}
                icon={docIcon}
                onIcon={doc.generated || revision ? undefined : (at) => setIconPick({ ...at, node: docNode })}
                onFocused={() => setTitleFocus(null)}
                onRename={(stem) => renameNode(docNode, stem)}
                onDone={() => editorHandle.current?.focus()}
              />
              <Editor
                docKey={`${doc.path}#${doc.seq}`}
                initial={doc.draft}
                onChange={(draft) => setDoc((prev) => (prev ? { ...prev, draft } : prev))}
                onSave={() => void save()}
                linkCandidates={() => linkCandidates}
                handle={editorHandle}
                onFiles={uploadFiles}
                live={live}
                lineNumbers={prefs.lineNumbers}
                foldFrontmatter
                onShowProps={() => showRight("props")}
                foldKey={revision ? undefined : doc.path}
                renderContext={() => (docRef.current ? { resolver: resolverRef.current, docPath: docRef.current.path, onLink: followLinkEl } : null)}
                readOnly={doc.generated}
                onCursor={(line, col) => setCursor({ line, col })}
                onBlur={() => prefs.autosave && void saveRef.current({ auto: true })}
              />
            </div>
          </div>
          <div className="pane preview-pane" onClick={onPreviewClick}>
            <div className="page">
              {(mode === "preview" || revision) && (
                <h1 className="inline-title static">
                  {prefs.showIcons && <DocIcon icon={docIcon} />}
                  {docLabel(doc.path, { plain: true })}
                </h1>
              )}
              <div className="markdown-body" ref={previewRef} dangerouslySetInnerHTML={{ __html: rendered.html }} />
              {widgetSlots.map((el, i) =>
                rendered.widgets[i] === undefined
                  ? null
                  : createPortal(<Widget source={rendered.widgets[i]} onOpen={open} onChanged={onWidgetChanged} />, el, `${i}:${rendered.widgets[i]}`),
              )}
              {prefs.backlinksInDoc && !revision && refs && (
                <References
                  refs={refs}
                  onOpen={(p, anchor) => {
                    if (anchor) setPendingAnchor({ path: p, ...(anchor.startsWith("^") ? { block: anchor.slice(1) } : { heading: anchor.toLowerCase() }) });
                    void open(p);
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {aside && (
          <AsidePreview
            path={aside}
            resolver={resolver}
            version={vaultVersion}
            live={aside === doc.path ? doc.draft : undefined}
            onNavigate={setAside}
            onEdit={(p) => {
              setAside(null);
              void open(p, { newTab: true });
            }}
            onClose={() => setAside(null)}
          />
        )}
      </div>
    </>
  ) : (
    <Home
      workspace={allWs ? null : ws}
      wsIcon={allWs ? null : wsIcon(ws)}
      recent={recent.filter((p) => resolver.paths.includes(p) && inScope(p))}
      tabs={tabs}
      onOpen={(p) => void open(p)}
      onOpenWorkspace={() => void openNode(ws)}
      onNew={() => void createDoc()}
      onDaily={dailyCfg ? () => void openDaily(0) : null}
      onQuick={() => setPalette("files")}
      onSearch={() => showLeft("search")}
      onMenu={() => setDrawer("left")}
      onManage={() => openSettings("workspaces")}
      hasWorkspace={wsNames.length > 0}
      pendingCount={pendingCount}
      onReview={() => setReviewOpen(true)}
      local={local}
      keyOf={keyOf}
    />
  );

  return (
    <IconLookup.Provider value={iconOf}>
      <div
        className={`shell${prefs.leftOpen ? " left-open" : ""}${rightOpen && doc && !isNarrow ? " right-open" : ""}${drawer ? ` drawer-${drawer}` : ""}${rl ? " rail-labels" : ""}`}
        style={{ ["--left-w" as string]: `${prefs.leftWidth}px`, ["--right-w" as string]: `${prefs.rightWidth}px` }}
      >
        {drawer && <div className="nav-backdrop" onClick={() => setDrawer(null)} />}
        <div className="left-dock">
          {rail}
          {((prefs.leftOpen && !isNarrow) || drawer === "left") && leftPanel}
        </div>
        {prefs.leftOpen && !isNarrow && (
          <Resizer
            side="left"
            label={t("panel.leftWidth")}
            width={prefs.leftWidth}
            min={180}
            max={520}
            onChange={(w) => setPrefs({ leftWidth: w })}
            onReset={() => setPrefs({ leftWidth: DEFAULT_PREFS.leftWidth })}
          />
        )}
        <main className="center">
          {tabBar}
          {center}
        </main>
        {doc && ((rightOpen && !isNarrow) || drawer === "right") && (
          <>
            {rightOpen && !isNarrow && (
              <Resizer
                side="right"
                label={t("panel.rightWidth")}
                width={prefs.rightWidth}
                min={200}
                max={560}
                onChange={(w) => setPrefs({ rightWidth: w })}
                onReset={() => setPrefs({ rightWidth: DEFAULT_PREFS.rightWidth })}
              />
            )}
            {rightPanel}
          </>
        )}
        {statusBar}

        {docMenu && <Menu at={docMenu} items={docMenuItems} onClose={() => setDocMenu(null)} />}
        {wsMenu && <Menu at={wsMenu} items={wsMenuItems} onClose={() => setWsMenu(null)} />}

        {reviewOpen && (
          <ReviewPanel
            onClose={() => setReviewOpen(false)}
            onChanged={() => {
              vaultChanged();
              void refreshTree();
              if (doc && doc.draft === doc.saved && !doc.virtual) void load(doc.path);
            }}
            onOpen={(p) => {
              setReviewOpen(false);
              void open(p);
            }}
          />
        )}
        {graphOpen && (
          <GraphView
            current={doc?.path ?? null}
            folders={flattenNodes(nodeTree).map((n) => n.path)}
            initialFolder={scope}
            onClose={() => setGraphOpen(false)}
            onOpen={(p) => {
              setGraphOpen(false);
              void open(p);
            }}
          />
        )}
        {lintOpen && (
          <LintPanel
            folders={flattenNodes(nodeTree).map((n) => n.path)}
            initialFolder={scope}
            onClose={() => setLintOpen(false)}
            onOpen={(p) => {
              setLintOpen(false);
              void open(p);
            }}
          />
        )}

        {settings && (
          <SettingsModal
            section={settings}
            onSection={(sec) => {
              history.replaceState(null, "", `${SETTINGS_HASH}/${sec}`);
              setSettings(sec);
            }}
            onClose={() => closeSettings()}
            commands={commands}
            local={local}
            folders={flattenNodes(nodeTree).map((n) => n.path)}
            workspaces={workspaceOps}
            dailyWorkspace={dailyWs}
            onOpen={(p) => {
              closeSettings(false);
              void open(p);
            }}
            onMigrateDaily={(w) => void migrateDaily(w)}
          />
        )}

        {ingestOpen && (
          <IngestDialog
            workspace={wsOfPath(doc?.path)}
            onClose={() => setIngestOpen(false)}
            onDone={(_results, openPath) => {
              vaultChanged();
              void refreshTree();
              if (openPath) {
                setIngestOpen(false);
                void open(openPath);
              }
            }}
          />
        )}

        {pdfView && (
          <PdfViewer
            key={pdfView.path}
            path={pdfView.path}
            page={pdfView.page}
            from={doc && !doc.generated && !revision && !doc.virtual ? { path: doc.path, draft: doc.draft } : null}
            resolver={resolver}
            onClose={() => setPdfView(null)}
            onEditOpenDoc={(next) => editorHandle.current?.setContent(next)}
            onSaved={() => {
              vaultChanged();
              void refreshTree();
            }}
            onOpenDoc={(p, block) => {
              setPdfView(null);
              if (block) setPendingAnchor({ path: p, block });
              void open(p);
            }}
          />
        )}
        {fileView && <FileViewer path={fileView} onClose={() => setFileView(null)} />}
        {iconPick && (
          <IconPicker
            at={iconPick}
            title={t("icon.of", { name: stemOf(iconPick.node) })}
            value={iconPick.node === docNode ? docIcon : iconMap.get(`${iconPick.node}.md`)}
            onClose={() => setIconPick(null)}
            onPick={(icon) => void setIcon(iconPick.node, icon)}
          />
        )}
        {migration && (
          <Modal title={t("daily.migrateTitle")} size="md" onClose={() => setMigration(null)}>
            <p className="meta">
              {t("daily.migrateHint", {
                example: dailyNotePath(migration.cfg.folder, migration.cfg.format, new Date(), {
                  weekStart: migration.cfg.weekStart,
                  lang: migration.cfg.lang,
                }),
              })}
            </p>
            {migration.moves.length === 0 ? (
              <p className="note-ok">{t("daily.migrateNone")}</p>
            ) : (
              <ul className="migration-list">
                {migration.moves.slice(0, 300).map((m) => (
                  <li key={m.from}>
                    <code>{m.from}</code> → <code>{m.to}</code>
                  </li>
                ))}
                {migration.moves.length > 300 && <li className="meta">{t("daily.migrateMore", { count: migration.moves.length - 300 })}</li>}
              </ul>
            )}
            {migration.skipped.length > 0 && (
              <details>
                <summary className="meta">{t("daily.migrateSkipped", { count: migration.skipped.length })}</summary>
                <ul className="migration-list">
                  {migration.skipped.map((x) => (
                    <li key={x.path}>
                      <code>{x.path}</code>{" "}
                      <span className="meta">{x.reason === "noDate" ? t("daily.skipNoDate") : t("daily.skipTaken", { path: x.to ?? "" })}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="ask-actions">
              <button onClick={() => setMigration(null)}>{t("common.close")}</button>
              {migration.moves.length > 0 && (
                <button
                  className="on"
                  onClick={() => void runMigration()}
                  aria-disabled={migration.moves.length > 500 || undefined}
                  {...(migration.moves.length > 500 ? tipProps({ label: t("daily.migrateLimit") }) : {})}
                >
                  {t("daily.migrateRun", { count: migration.moves.length })}
                </button>
              )}
            </div>
          </Modal>
        )}
        {palette && (
          <Palette
            key={palette}
            placeholder={
              palette === "files"
                ? t("palette.files")
                : palette === "commands"
                  ? t("palette.commands")
                  : palette === "move"
                    ? t("palette.move", { name: moveTarget ? moveTarget.path.split("/").pop()! : "" })
                    : palette === "daily"
                      ? t("palette.daily")
                      : t("palette.templates", { folder: templateDir || "-" })
            }
            items={
              palette === "files"
                ? fileItems
                : palette === "commands"
                  ? commandItems
                  : palette === "move"
                    ? moveItems
                    : palette === "daily"
                      ? dailyChoices.map((n) => ({
                          id: n.path,
                          label: stemOf(n.path),
                          display: docLabel(n.path),
                          detail: parentOf(n.path),
                          run: (alt: boolean) => void open(n.path, { newTab: alt }),
                        }))
                      : templatePaths.map((p) => ({
                          id: p,
                          label: stemOf(p),
                          detail: p,
                          run: () => void (palette === "templates" ? insertTemplate(p) : createFromTemplate(p)),
                        }))
            }
            hint={palette === "files" ? t("palette.filesHint") : t("palette.hint")}
            onClose={() => setPalette(null)}
          />
        )}
        {keysOpen && <KeysDialog commands={commands} onClose={() => setKeysOpen(false)} onEdit={() => (setKeysOpen(false), openSettings("keys"))} />}
        <Toasts />
      </div>
    </IconLookup.Provider>
  );
}

function KeysDialog({ commands, onClose, onEdit }: { commands: Command[]; onClose: () => void; onEdit: () => void }) {
  return (
    <Modal title={t("keys.title")} size="md" onClose={onClose} className="keys-dialog" head={<button onClick={onEdit}>{t("keys.edit")}</button>}>
      <KeySettings commands={commands} query="" readOnly />
      <p className="meta">
        {t("keys.editor", {
          bold: formatCombo("Mod+B"),
          italic: formatCombo("Mod+I"),
          link: formatCombo("Mod+K"),
          mark: formatCombo("Mod+Shift+H"),
          task: formatCombo("Mod+Enter"),
          find: formatCombo("Mod+F"),
        })}
        <br />
        {t("keys.tree")}
        <br />
        {t("keys.other", { mod: formatCombo("Mod") })}
      </p>
    </Modal>
  );
}

function TreeOptions({ prefs }: { prefs: Prefs }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const items: MenuEntry[] = [
    { label: t("tree.showAttachments"), icon: prefs.treeAttachments === "show" ? Check : undefined, run: () => setPrefs({ treeAttachments: "show" }) },
    { label: t("tree.hideAttachments"), icon: prefs.treeAttachments === "hide" ? Check : undefined, run: () => setPrefs({ treeAttachments: "hide" }) },
  ];
  return (
    <>
      <IconButton
        size={16}
        icon={Ellipsis}
        label={t("tree.options")}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom + 4 });
        }}
      />
      {at && <Menu at={at} items={items} onClose={() => setAt(null)} />}
    </>
  );
}

function Home({
  workspace,
  wsIcon,
  recent,
  tabs,
  onOpen,
  onOpenWorkspace,
  onNew,
  onDaily,
  onQuick,
  onSearch,
  onMenu,
  onManage,
  hasWorkspace,
  pendingCount,
  onReview,
  local,
  keyOf,
}: {
  workspace: string | null;
  wsIcon: string | null;
  recent: string[];
  tabs: string[];
  onOpen: (p: string) => void;
  onOpenWorkspace: () => void;
  onNew: () => void;
  onDaily: (() => void) | null;
  onQuick: () => void;
  onSearch: () => void;
  onMenu: () => void;
  onManage: () => void;
  hasWorkspace: boolean;
  pendingCount: number;
  onReview: () => void;
  local: boolean;
  keyOf: (id: string) => string | undefined;
}) {
  const k = (id: string) => (keyOf(id) ? <kbd>{formatCombo(keyOf(id))}</kbd> : null);
  return (
    <div className="home">
      <button className="nav-toggle home-nav" aria-label={t("tab.docList")} onClick={onMenu}>
        <MenuIcon size={18} aria-hidden /> {t("tab.docList")}
      </button>
      <div className="home-inner">
        <h1>
          {workspace ? (
            <button type="button" className="home-ws" onClick={onOpenWorkspace} {...tipProps({ label: t("ws.openNote") })}>
              {wsIcon ? (
                <span className="doc-icon" aria-hidden>
                  {wsIcon}
                </span>
              ) : (
                <House size={22} aria-hidden />
              )}{" "}
              {workspace}
            </button>
          ) : (
            <>
              <House size={22} aria-hidden /> Keyring Notes
            </>
          )}
        </h1>
        {!hasWorkspace && (
          <p className="home-empty">
            {t("ws.firstHint")} <button onClick={onManage}>{t("ws.create")}</button>
          </p>
        )}
        <div className="home-actions">
          <button onClick={onNew} disabled={!hasWorkspace}>
            <FilePlus size={16} aria-hidden /> {t("tree.newNote")} {k("new")}
          </button>
          {onDaily && (
            <button onClick={onDaily}>
              <CalendarDays size={16} aria-hidden /> {t("cmd.daily")} {k("daily")}
            </button>
          )}
          <button onClick={onQuick}>
            <Files size={16} aria-hidden /> {t("home.quick")} {k("quick-open")}
          </button>
          <button onClick={onSearch}>
            <Search size={16} aria-hidden /> {t("rail.search")} {k("search")}
          </button>
        </div>
        {!local && pendingCount > 0 && (
          <button className="home-review" onClick={onReview}>
            <ListChecks size={16} aria-hidden /> {t("home.review", { count: pendingCount })}
          </button>
        )}
        {recent.length > 0 && (
          <section>
            <h2>{t("home.recent")}</h2>
            <ul className="home-list">
              {recent.slice(0, 12).map((p) => (
                <li key={p}>
                  <button onClick={() => onOpen(p)}>
                    <span className="home-doc">{stemOf(p)}</span>
                    <span className="meta">{parentOf(p)}</span>
                    {tabs.includes(p) && <span className="meta"> · {t("home.inTab")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {local && <p className="meta">{t("home.localHint")}</p>}
      </div>
    </div>
  );
}
