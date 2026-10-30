import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import {
  BrushCleaning,
  CalendarDays,
  Check,
  ChevronRight,
  ArrowRightLeft,
  Columns2,
  ExternalLink,
  Copy,
  Ellipsis,
  FilePlus,
  Files,
  FileText,
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
  LocateFixed,
  LogOut,
  Menu as MenuIcon,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Rows2,
  Search,
  Settings as SettingsIcon,
  SmilePlus,
  SlidersHorizontal,
  TableOfContents,
  Tag,
  Trash2,
  Waypoints,
  ChevronsDownUp,
  ChevronsUpDown,
  X,
} from "lucide-react";
import { api, ApiError, appMode, review, type CommitInfo, type SearchHit, type SourcesInfo, type TreeNode } from "./api";
import type { EditorHandle, LinkCandidate } from "./Editor";
import { LintPanel, ReviewPanel } from "./Curation";
import { TrashPanel } from "./Trash";
import { GraphView } from "./Graph";
import { IngestDialog } from "./Ingest";
import { invalidateWidgets } from "./Widget";
import { notePathOfHash, replaceSettingsSection, settingsBack, settingsCloseTarget, SETTINGS_HASH } from "./settingsNav";
import { isNetworkError, offline, searchFailedOffline } from "./offline";
import { LinkResolver } from "./markdown";
import { invalidateEmbeds } from "./enhance";
import { Palette, type PaletteItem } from "./Palette";
import {
  applyTemplate,
  attachmentDirFor,
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
  type ChildSort,
  type DailyNote,
  type PropertyStat,
  type VaultNode,
} from "@keyring-notes/core";
import { Properties } from "./Properties";
import { PdfViewer } from "./PdfViewer";
import { localContext } from "./local/boot";
import { useSyncStatus } from "./Sync";
import { chooseDialog, confirmDialog, promptDialog } from "./dialog";
import { mentionTarget, References, UnlinkedMentions } from "./Links";
import { DEFAULT_PREFS, setPrefs, usePrefs, type Prefs } from "./prefs";
import { errorText, toast, toastError, Toasts } from "./toast";
import { commandKey, formatCombo, keyCapture, matchCommand, type Command } from "./shortcuts";
import { IconButton, Menu, Resizer, Segmented, type MenuEntry } from "./ui";
import { childSortItems, invalidNameReason, parentOf, stemOf, Tree, type TreeActions, type TreeDecor, type TreeHandle } from "./Tree";
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
import { FileViewer } from "./Aside";
import { fmtDateTime, fmtNumber, missingPack, t, timeAgo, useLang } from "./i18n";
import { tipProps } from "./Tooltip";
import { AttachmentList } from "./Attachments";
import { mirrorTargets } from "./mirror";
import { DocPane, docMeta, type PaneContext, type PaneHandle, type PendingAnchor, type RevisionView } from "./DocPane";
import { isRecordOf, isStringArray, readStored } from "./stored";
import {
  dirtyPaths,
  dropUnused,
  isDirty,
  patchDoc as patchStoreDoc,
  renameDoc,
  setConflict as setStoreConflict,
  setDraft,
  setSave as setStoreSave,
  upsertDoc,
  type DocStore,
  type OpenDoc,
  type SaveState,
} from "./openDocs";
import {
  canSplitRect,
  clearActive,
  closeIn,
  dragSizes,
  dropTab,
  dropZone,
  emptyLayout,
  focusPane,
  isLayout,
  isSplit,
  mergePanes,
  migrateLayouts,
  migrateLegacyPanes,
  minExtent,
  moveTab,
  neighborOf,
  openIn,
  nodeAt,
  otherPaneOf,
  paneOf,
  panesOf,
  removePaths,
  renamePath,
  rightPanelFloats,
  setMode as setPaneMode,
  setSizes,
  splitPane,
  rectsOf,
  handlesOf,
  type SplitHandle,
  type DropZone,
  type Layout,
  type LayoutNode,
  type Pane,
  type Side,
  type ViewMode,
} from "./panes";
import { TabCountButton, TabSwitcher } from "./TabSwitcher";
import { dropWorkspaceLayout, dropWorkspaceRefs, restoreWorkspaceRefs, workspaceAfterDelete, workspaceRefs } from "./workspaceDelete";
import { addPin, dropWorkspacePins, movePins, pinExists, removePin, restoreWorkspacePins, shownPins, updatePins, usePins, type SavedPins } from "./pins";
import { forgetViewed, markViewed, renameViewed, viewedSnapshot } from "./viewed";
import {
  childSortWrites,
  fillBlankNote,
  isGeneratedNote,
  planWritable,
  rankWrites,
  reorderHintKey,
  seedWritable,
  shownChildren,
  siblingTarget,
  writableSiblings,
  type NoteState,
  type NoteWrite,
} from "./childSortUi";
import { canOpenSolo, canTearOut, openSolo, SOLO } from "./soloWindow";
import {
  ackCloseAsk,
  canCloseWindow,
  cancelQuit,
  closeAskHandler,
  closeCurrentWindow,
  closeWindowCommands,
  destroyCurrentWindow,
  dropAutosaves,
  listenCloseAsks,
  listenRestartCancelled,
  savesHeld,
  setCloseGuard,
  unsavedSummary,
  type SaveHold,
} from "./closeWindow";
import { tearOutAt } from "./tearOut";
import { DockTitle, DRAG_REGION } from "./DockTitle";
import { switcherSpot } from "./topbar";
import { bootOpen, isWorkspaceNote, withoutWorkspaceBacklinks } from "./workspaceNote";
import { useAvailableUpdate } from "./update";
import { SearchFilters, SearchResults } from "./Search";
import { folderChoices, folderInScope, hasSearchTerms, NO_FILTER, SEARCH_LINES_FETCH, searchKey, type SearchFilter } from "./searchFilter";

/** 비율(0~1) → CSS 퍼센트 */
const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/** 칸 방향 → 단축키의 방향키 이름 */
const ARROW: Record<Side, string> = { left: "ArrowLeft", right: "ArrowRight", top: "ArrowUp", bottom: "ArrowDown" };

/** 칸이 없는 배치(매번 새 객체를 만들지 않게 하나만 둔다) */
const NO_PANES: Layout = emptyLayout();
const IDLE: SaveState = { kind: "idle" };

function pathFromLocation(): string | null {
  return notePathOfHash(location.hash);
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
function useStored<T>(key: string, initial: T | (() => T), valid: (v: unknown) => v is T, memoryOnly = false): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    const init = () => (typeof initial === "function" ? (initial as () => T)() : initial);
    if (memoryOnly) return init();
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? init() : readStored(raw, init(), valid);
    } catch {
      return init();
    }
  });
  useEffect(() => {
    if (memoryOnly) return;
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

/** 탭·마지막 문서를 기억하는 범위 이름: 워크스페이스, 모든 워크스페이스면 "*" */
const scopeKeyOf = (all: boolean, ws: string) => (all ? "*" : ws);

export function Workspace({ onLogout }: { onLogout: () => void }) {
  const prefs = usePrefs();
  const lang = useLang();
  const local = appMode.local;
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  /** 열린 문서 전부(경로 → 초안·저장 상태·충돌). 어느 칸에서 열었든 같은 문서는 원본이 하나다 */
  const [docs, setDocs] = useState<DocStore>({});
  /** 늘 최신 저장소. 저장·이동처럼 await 사이에 읽는 곳이 낡은 값을 보지 않게 바꾸는 즉시 고친다 */
  const docsRef = useRef(docs);
  const updateDocs = (fn: (s: DocStore) => DocStore) => {
    const next = fn(docsRef.current);
    if (next === docsRef.current) return;
    docsRef.current = next;
    setDocs(next);
  };
  // 좁은 화면에서는 나란히 보기 대신 미리보기로 시작. Live Preview가 기본이라 넓은 화면은 편집으로
  const narrow = () => window.matchMedia?.("(max-width: 800px)").matches ?? false;
  const [isNarrow, setIsNarrow] = useState(narrow);
  /** 좁은 화면의 열린 탭 목록을 보고 있는 칸 */
  const [tabSheet, setTabSheet] = useState<string | null>(null);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 800px)");
    if (!mq) return;
    const on = () => {
      setIsNarrow(mq.matches);
      setDrawer(null);
      setTabSheet(null);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  /** 창 폭: 오른쪽 패널을 붙일 자리가 있는지(rightPanelFloats) */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  /** 가운데(main.center) 크기: 칸 경계를 끌 때 비율을 px 로 바꿔 칸마다 최소 크기를 지킨다 */
  const centerRef = useRef<HTMLElement>(null);
  const [centerSize, setCenterSize] = useState({ w: 0, h: 0 });
  const isNarrowRef = useRef(isNarrow);
  isNarrowRef.current = isNarrow;
  useEffect(() => {
    const el = centerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCenterSize((c) => (c.w === el.clientWidth && c.h === el.clientHeight ? c : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  /** 접힌 상태가 바뀔 때 올린다(미리보기·개요를 다시 맞춘다) */
  const [foldVersion, setFoldVersion] = useState(0);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  /** 칸(id)마다 보고 있는 과거 판 */
  const [revisions, setRevisions] = useState<Record<string, RevisionView | null>>({});
  const revisionsRef = useRef(revisions);
  revisionsRef.current = revisions;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<(SearchHit & { score?: number })[] | null>(null);
  /** 지난 검색이 연결이 없어 실패했다(서버 모드) */
  const [searchOffline, setSearchOffline] = useState(false);
  /** 검색 패널의 폴더·태그 필터(앱이 떠 있는 동안만) */
  const [searchFilter, setSearchFilter] = useState<SearchFilter>(NO_FILTER);
  /** 필터에 고를 수 있는 태그(지금 범위, 폴더를 골랐으면 그 안) */
  const [filterTags, setFilterTags] = useState<{ tag: string; count: number }[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [refs, setRefs] = useState<SourcesInfo | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [lintOpen, setLintOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
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
  /** 칸(id)마다 에디터·칸 동작. 명령·패널은 활성 칸의 것을 쓴다. 칸이 닫혀도 지우지 않는다 — 다시 생긴 같은 id 의 칸이 그린 뒤 다시 채운다 */
  const paneRefs = useRef(
    new Map<string, { handle: MutableRefObject<EditorHandle | null>; api: MutableRefObject<PaneHandle | null>; el: MutableRefObject<HTMLElement | null> }>(),
  );
  /** 칸 요소(el)는 보이는 에디터가 없는 칸(미리보기·과거 판 보기)으로 포커스를 옮길 때 쓴다 */
  const refsOf = (id: string) => {
    let r = paneRefs.current.get(id);
    if (!r) {
      r = { handle: { current: null }, api: { current: null }, el: { current: null } };
      paneRefs.current.set(id, r);
    }
    return r;
  };
  /** 활성 칸의 에디터 */
  const editorHandle = {
    get current() {
      return paneRefs.current.get(curLayout().focused)?.handle.current ?? null;
    },
  };
  const treeRef = useRef<TreeHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(settingsFromLocation);
  const newVersion = useAvailableUpdate();
  const [keysOpen, setKeysOpen] = useState(false);
  const [fileView, setFileView] = useState<string | null>(null);
  const [docMenu, setDocMenu] = useState<{ x: number; y: number } | null>(null);
  /** 탭 오른쪽 클릭 메뉴 */
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; pane: string; path: string } | null>(null);
  /** 탭을 끄는 동안: 끌기 시작한 칸과 탭. 칸마다 놓을 자리를 덮는다 */
  const [tabDrag, setTabDrag] = useState<{ pane: string; path: string } | null>(null);
  /** 끌고 있는 탭이 올라간 칸과 놓을 자리 */
  const [dropAt, setDropAt] = useState<{ pane: string; zone: DropZone } | null>(null);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number; spot: string } | null>(null);
  /** 사이드바를 접었을 때 첫 줄 왼쪽 칸이 맨 위 왼쪽 탭 줄 위에 걸친 폭(DockTitle) */
  const [titleOver, setTitleOver] = useState(0);
  /** 칸(id)마다 커서 줄·칸 */
  const [cursors, setCursors] = useState<Record<string, { line: number; col: number }>>({});
  /** 제목 칸에 커서를 둘 문서(새 문서·F2). 문서가 열린 뒤 에디터보다 늦게 잡는다 */
  const [titleFocus, setTitleFocus] = useState<{ path: string; n: number } | null>(null);
  const focusTitle = (path: string) => setTitleFocus({ path, n: Date.now() });
  const [now, setNow] = useState(Date.now());
  const closedTabs = useRef<string[]>([]);
  const [recent, setRecent] = useStored<string[]>("keyring:recent", [], isStringArray);
  /** 고정한 노드(이 기기, pins.ts) */
  const pins = usePins();
  /** 열어 본 문서 기록(뒤로·앞으로) */
  const nav = useRef<{ list: string[]; i: number }>({ list: [], i: -1 });
  const [palette, setPalette] = useState<"files" | "commands" | "templates" | "new-from-template" | "move" | "daily" | "search-folder" | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ path: string; kind: "node" | "file" } | null>(null);
  const shared = useVaultSettings();
  const [propStats, setPropStats] = useState<PropertyStat[]>([]);
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
  // 앱 안 PDF 보기(주석 달기)
  const [pdfView, setPdfView] = useState<{ path: string; page?: number } | null>(null);
  /** 브라우저 로컬 볼트의 첨부(blob URL)가 준비되면 올려 미리보기를 다시 그린다 */
  const [assetVersion, setAssetVersion] = useState(0);
  const syncStatus = useSyncStatus(localContext);

  // ── 워크스페이스: 볼트 루트 노드. 트리·빠른 열기·검색·태그·그래프·홈을 지금 워크스페이스로 좁힌다
  const wsNames = useMemo(() => orderWorkspaces(shared, workspacesOf(tree)), [shared, tree]);
  const ws = wsNames.includes(prefs.workspace) ? prefs.workspace : (wsNames[0] ?? "");
  const allWs = prefs.allWorkspaces || !ws;
  const scope = allWs ? "" : ws;
  const scopeKey = scopeKeyOf(allWs, ws);
  const scopeRef = useRef({ allWs, ws, scopeKey });
  scopeRef.current = { allWs, ws, scopeKey };
  const inScope = (p: string) => !scope || inWorkspace(p, scope);
  /**
   * 워크스페이스마다 칸 배치(나눈 트리·칸마다 탭·보고 있는 문서·보기 모드·비율, 이 기기). 처음에는 옛 좌우 두 칸
   * 배치(keyring:panes, 두 칸 비율은 prefs.splitRatio)를, 그것도 없으면 더 옛 탭 목록(keyring:tabs)과 마지막 문서
   * (keyring:last-doc)를 옮겨 온다 — 모양이 달라 같은 키를 덮어쓰면 예전 판으로 돌아갈 때 깨진다.
   */
  const [layoutByScope, setLayoutByScope] = useStored<Record<string, Layout>>(
    "keyring:pane-tree",
    () => {
      try {
        return (
          migrateLegacyPanes(localStorage.getItem("keyring:panes"), prefs.splitRatio) ??
          migrateLayouts(localStorage.getItem("keyring:tabs"), localStorage.getItem("keyring:last-doc"), narrow() ? "preview" : "edit")
        );
      } catch {
        return {};
      }
    },
    isRecordOf(isLayout),
    SOLO,
  );
  useEffect(() => {
    // 새 창(solo)은 배치를 기억하지 않으므로 옮긴 결과도 남기지 않는다 — 여기서 지우면 원래 창의 옛 배치를 잃는다
    if (SOLO) return;
    try {
      localStorage.removeItem("keyring:panes");
      localStorage.removeItem("keyring:tabs");
      localStorage.removeItem("keyring:last-doc");
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, []);
  /** 늘 최신 배치(docsRef 와 같은 이유) */
  const layoutsRef = useRef(layoutByScope);
  // 워크스페이스 루트 노트를 열 수 있던 때 기억한 탭은 닫는다(workspaceNote.ts)
  useEffect(() => {
    setAllLayouts((l) => removePaths(l, isWorkspaceNote));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setLayouts = (fn: (m: Record<string, Layout>) => Record<string, Layout>) => {
    const next = fn(layoutsRef.current);
    if (next === layoutsRef.current) return;
    layoutsRef.current = next;
    setLayoutByScope(next);
  };
  const setLayoutFor = (key: string, fn: (l: Layout) => Layout) =>
    setLayouts((m) => {
      const cur = m[key] ?? NO_PANES;
      const next = fn(cur);
      if (next === cur) return m;
      const out = { ...m, [key]: next };
      if (!next.root) delete out[key];
      return out;
    });
  /** 모든 워크스페이스의 배치를 같은 규칙으로 고친다(이동·삭제는 범위를 가리지 않는다) */
  const setAllLayouts = (fn: (l: Layout) => Layout) =>
    setLayouts((m) => {
      let changed = false;
      const out: Record<string, Layout> = {};
      for (const [k, l] of Object.entries(m)) {
        const next = fn(l);
        if (next !== l) changed = true;
        if (next.root) out[k] = next;
      }
      return changed ? out : m;
    });
  const setLayout = (fn: (l: Layout) => Layout) => setLayoutFor(scopeRef.current.scopeKey, fn);
  const curLayout = () => layoutsRef.current[scopeRef.current.scopeKey] ?? NO_PANES;
  const layout = layoutByScope[scopeKey] ?? NO_PANES;
  /** 지금 배치의 칸들(읽는 순서) */
  const panes = useMemo(() => panesOf(layout), [layout]);
  const focusedPane = panes.find((p) => p.id === layout.focused);
  /** 지금 배치의 모든 칸의 탭 */
  const allTabs = panes.flatMap((p) => p.tabs);
  /** 활성 칸의 문서(오른쪽 패널·상태 표시줄·명령의 대상) */
  const entry = focusedPane?.active ? docs[focusedPane.active] : undefined;
  const doc: OpenDoc | null = entry?.doc ?? null;
  const saveState = entry?.save ?? IDLE;
  const conflict = entry?.conflict ?? null;
  /** 지금 활성 칸의 문서(늘 최신 저장소·배치에서 읽는다) */
  const docRef = useMemo(
    () => ({
      get current(): OpenDoc | null {
        const l = layoutsRef.current[scopeRef.current.scopeKey] ?? NO_PANES;
        const p = paneOf(l, l.focused)?.active;
        return p ? (docsRef.current[p]?.doc ?? null) : null;
      },
    }),
    [],
  );
  const revisionOf = (pane: string): RevisionView | null => {
    const r = revisions[pane];
    return r && r.path === paneOf(layout, pane)?.active ? r : null;
  };
  const revision = revisionOf(layout.focused);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const setPaneRevision = (pane: string, r: RevisionView | null) => setRevisions((rs) => (rs[pane] === r ? rs : { ...rs, [pane]: r }));
  const setRevision = (r: RevisionView | null) => setPaneRevision(curLayout().focused, r);
  /** 칸에 새로 만들 때의 보기 모드: 마지막으로 쓴 것(처음에는 좁은 화면이면 미리보기) */
  const lastMode = useRef<ViewMode>(narrow() ? "preview" : "edit");
  if (focusedPane) lastMode.current = focusedPane.mode;
  const mode: ViewMode = focusedPane?.mode ?? lastMode.current;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setFocusedMode = (m: ViewMode | ((m: ViewMode) => ViewMode)) =>
    setLayout((l) => {
      const cur = paneOf(l, l.focused)?.mode ?? lastMode.current;
      return setPaneMode(l, l.focused, typeof m === "function" ? m(cur) : m);
    });

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
    // 지금 보고 있는 노트·저장 안 한 탭(오프라인에서 만든 것 포함)은 남긴다
    const shown = new Set(panesOf(curLayout()).map((p) => p.active));
    const keep = (p: string) => shown.has(p) || (!!docsRef.current[p] && isDirty(docsRef.current[p]));
    const alive = (p: string) => files.has(p) || dirs.has(stripMd(p)) || keep(p);
    setAllLayouts((l) => removePaths(l, (p) => !alive(p)));
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
    const paths = resolver.paths.filter((p) => !isVaultSettingsPath(p) && !isWorkspaceNote(p));
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

  // 지금 문서의 속성: 개수(오른쪽 패널 탭)와 아이콘. 저장 전 초안 기준
  const { propCount, icon: docIcon } = useMemo(() => docMeta(doc?.draft ?? ""), [doc?.draft]);

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
      .then((r) => setRefs(withoutWorkspaceBacklinks(r)))
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
    // 필터는 글 검색에만 쓴다(의미 검색 칸에서는 필터 줄이 숨는다)
    const filter = searchMode === "text" ? searchFilter : NO_FILTER;
    if (!hasSearchTerms(q, filter)) return setHits(null);
    const semantic = searchMode === "semantic" && !q.startsWith("#");
    const timer = setTimeout(
      () => {
        (semantic
          ? api
              .semantic(q, scope || undefined)
              .then((hs) =>
                hs.map((h) => ({ path: h.path, title: h.title, line: 1, snippet: (h.heading ? `${h.heading} · ` : "") + h.snippet, score: h.score })),
              )
          : api.search(q, { folder: filter.folder || scope || undefined, tags: filter.tags, lines: SEARCH_LINES_FETCH })
        )
          .then((hs) => {
            setSearchOffline(false);
            setHits(hs.filter((h) => !isWorkspaceNote(h.path)));
          })
          .catch((e) => {
            setHits([]);
            // 서버 모드에서 연결이 없으면 「결과 없음」이 아니라 검색할 수 없다고 말한다(결과 칸이 말하니 알림은 띄우지 않는다)
            const off = searchFailedOffline(appMode.local, e);
            setSearchOffline(off);
            if (!off) toastError(e);
          });
      },
      semantic ? 400 : 200,
    );
    return () => clearTimeout(timer);
  }, [query, vaultVersion, searchMode, scope, searchFilter]);

  // 워크스페이스를 바꿔 고른 폴더가 범위 밖이 되면 폴더 필터만 걷는다(태그는 칩으로 보이니 둔다)
  useEffect(() => {
    if (searchFilter.folder && !folderInScope(searchFilter.folder, scope)) setSearchFilter((f) => ({ ...f, folder: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // 필터의 태그 목록: 검색 패널이 보일 때만 부른다
  const searchPanelShown = prefs.leftOpen && prefs.leftView === "search" && searchMode === "text";
  useEffect(() => {
    if (!searchPanelShown) return;
    api
      .tags(searchFilter.folder || scope || undefined)
      .then(setFilterTags)
      .catch(() => setFilterTags([]));
  }, [searchPanelShown, searchFilter.folder, scope, vaultVersion]);

  const remember = (path: string) => {
    setRecent((r) => [path, ...r.filter((p) => p !== path)].slice(0, 30));
    markViewed(path);
  };

  /** 문서를 읽는다(저장소에는 넣지 않는다). 노트 없는 노드면 빈 노드로. 못 읽으면 알리고 null */
  const fetchDoc = useCallback(async (path: string): Promise<Omit<OpenDoc, "seq"> | null> => {
    try {
      const d = await api.read(path);
      return { path, saved: d.content, hash: d.hash, draft: d.content, generated: d.generated === true, cachedOffline: d.cachedOffline === true };
    } catch (e) {
      // 노트 없는 노드(A/만 있음): 빈 노드로 연다. 내용을 쓰면 그때 A.md를 만든다
      if (e instanceof ApiError && e.status === 404 && /\.md$/i.test(path) && nodeExists(stripMd(path), resolverRef.current.paths)) {
        return { path, saved: "", hash: "", draft: "", generated: false, virtual: true };
      }
      toastError(e);
      return null;
    }
  }, []);

  /** 문서를 (다시) 읽어 저장소에 넣는다. 그 문서를 보는 칸의 에디터를 새로 만들고 과거 판 보기를 닫는다 */
  const loadingRef = useRef(new Set<string>());
  const load = useCallback(async (path: string): Promise<boolean> => {
    loadingRef.current.add(path);
    const d = await fetchDoc(path).finally(() => loadingRef.current.delete(path));
    if (!d) return false;
    updateDocs((s) => upsertDoc(s, d));
    setRevisions((rs) => (Object.values(rs).some((r) => r?.path === path) ? Object.fromEntries(Object.entries(rs).filter(([, r]) => r?.path !== path)) : rs));
    remember(path);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 문서 하나의 변경을 저장소에 반영한다(그 문서를 연 모든 칸이 따라간다) */
  const patchDoc = (path: string, patch: (d: OpenDoc) => OpenDoc) => updateDocs((s) => patchStoreDoc(s, path, patch));
  const setDocSave = (path: string, save: SaveState) => updateDocs((s) => setStoreSave(s, path, save));

  /** 어느 칸이든 그 문서를 과거 판으로 보는 중인가(그동안은 저장하지 않는다) */
  const viewingRevision = (path: string) => panesOf(curLayout()).some((p) => p.active === path && revisionsRef.current[p.id]?.path === path);

  // ── 저장(자동 저장 포함). 문서마다 따로 돈다. 늘 지금 저장소(docsRef)를 읽어 오래된 값으로 덮어쓰지 않는다
  const savingRef = useRef(new Set<string>());
  const againRef = useRef(new Set<string>());
  const save = useCallback(
    async (path?: string, opts: { auto?: boolean } = {}): Promise<boolean> => {
      const p = path ?? docRef.current?.path;
      const e = p ? docsRef.current[p] : undefined;
      if (!p || !e) return true;
      const d = e.doc;
      if (d.generated || d.draft === d.saved) return true;
      if (e.conflict || viewingRevision(p)) return false;
      if (savingRef.current.has(p)) {
        againRef.current.add(p);
        return false;
      }
      savingRef.current.add(p);
      const wasError = e.save.kind === "error";
      setDocSave(p, { kind: "saving" });
      const content = d.draft;
      let ok = false;
      try {
        const r = await api.write(d.path, content, d.hash || null, { coalesce: opts.auto });
        await offline.done(d.path).catch(() => undefined);
        setOutboxCount((await offline.pending().catch(() => [])).length);
        // 저장하는 동안 더 입력한 내용(draft)은 그대로 둔다.
        patchDoc(d.path, (prev) => ({ ...prev, saved: content, hash: r.hash, virtual: false }));
        setDocSave(d.path, { kind: "saved", at: Date.now() });
        ok = true;
        // 노트 없는 노드에 처음 쓰면 노트가 생겼다(트리 아이콘·노드 모양)
        // 아이콘이 바뀌었으면 트리를 다시 받는다. 탭·트리·위젯·검색 결과의 아이콘은 트리에서 오기 때문
        if (d.virtual || docMeta(content).icon !== docMeta(d.saved).icon) void refreshTree();
        if (opts.auto) vaultChangedSoon();
        else vaultChanged();
      } catch (e) {
        if (isNetworkError(e)) {
          // 오프라인: 이 기기에 저장해 두고(문서마다 마지막 것만), 연결되면 보낸다
          await offline.queue(d.path, content, d.hash || null, d.hash ? d.saved : null);
          patchDoc(d.path, (prev) => ({ ...prev, saved: content }));
          setOutboxCount((await offline.pending()).length);
          setDocSave(d.path, { kind: "queued" });
          ok = true;
        } else if (e instanceof ApiError && e.status === 409) {
          // 다른 곳(다른 탭·에이전트·동기화)에서 먼저 고쳤다: 서로 다른 부분이면 자동으로 합친다
          const merged = e.currentHash && d.hash ? await saveMerged(d.path, d.saved, content).catch(() => null) : null;
          const prev = docsRef.current[d.path]?.doc;
          // 저장하는 동안 더 입력했다면 그 입력도 합친다
          const draft =
            merged && prev
              ? prev.draft === content
                ? merged.text
                : (() => {
                    const more = merge3(content, prev.draft, merged.text);
                    return more.ok ? more.text : null;
                  })()
              : null;
          if (merged && prev && draft !== null) {
            updateDocs((s) =>
              setStoreSave(
                setStoreConflict(
                  patchStoreDoc(s, d.path, (x) => ({ ...x, saved: merged.text, hash: merged.hash, draft, seq: x.seq + 1 })),
                  d.path,
                  null,
                ),
                d.path,
                { kind: "saved", at: Date.now() },
              ),
            );
            toast(t("save.merged"), { kind: "info" });
            ok = true;
            vaultChanged();
          } else {
            updateDocs((s) => setStoreSave(setStoreConflict(s, d.path, { currentHash: merged?.hash ?? e.currentHash ?? null }), d.path, { kind: "conflict" }));
            toast(t("save.conflict"), { kind: "warn", duration: 8000 });
          }
        } else {
          const message = errorText(e);
          setDocSave(d.path, { kind: "error", message });
          // 자동 저장이 잇달아 실패하면 처음 한 번만 알린다(상태 표시줄에는 계속 보인다)
          if (!opts.auto || !wasError)
            toast(t("save.failed", { message }), { kind: "error", action: { label: t("common.retry"), run: () => void save(d.path) } });
        }
      } finally {
        savingRef.current.delete(p);
      }
      if (againRef.current.has(p)) {
        againRef.current.delete(p);
        void save(p, opts);
      }
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultChanged, vaultChangedSoon],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  /** 다른 일(이동·이름 바꾸기·워크스페이스 바꾸기) 전에 문서를 저장한다(기본은 저장 안 한 문서 전부). 못 한 것이 있으면 false */
  const flush = async (paths?: string[]): Promise<boolean> => {
    const list = (paths ?? dirtyPaths(docsRef.current)).filter((p) => docsRef.current[p] && isDirty(docsRef.current[p]));
    if (!list.length || !prefsRef.current.autosave) return true;
    for (const p of list) await saveRef.current(p, { auto: true });
    return list.every((p) => !docsRef.current[p] || !isDirty(docsRef.current[p]));
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** 창 닫기 물음이 떠 있거나 닫기로 정해 창이 사라지는 중이다(그동안 자동 저장을 멈춘다. 아래 「창 닫기」) */
  const closeHold = useRef<SaveHold>({ asking: false, closing: false });

  // 자동 저장: 문서마다 타이머 하나. 그 문서의 입력이 멈추고 잠시 뒤. 충돌·과거 판 보기 중인 문서는 건너뛴다
  const autosaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** 타이머를 건 때의 초안·저장본·간격. 같으면 다시 걸지 않는다(실패한 저장을 혼자 되풀이하지 않게) */
  const autosaveArmed = useRef(new Map<string, string>());
  useEffect(() => {
    const want = new Map<string, string>();
    if (prefs.autosave)
      for (const p of dirtyPaths(docs))
        if (!docs[p].conflict && !viewingRevision(p)) want.set(p, `${prefs.autosaveDelay}\u0000${docs[p].doc.saved}\u0000${docs[p].doc.draft}`);
    for (const [p, timer] of autosaveTimers.current)
      if (want.get(p) !== autosaveArmed.current.get(p)) {
        clearTimeout(timer);
        autosaveTimers.current.delete(p);
      }
    for (const p of autosaveArmed.current.keys()) if (want.get(p) !== autosaveArmed.current.get(p)) autosaveArmed.current.delete(p);
    for (const [p, armed] of want) {
      if (autosaveArmed.current.get(p) === armed) continue;
      autosaveArmed.current.set(p, armed);
      autosaveTimers.current.set(
        p,
        setTimeout(function fire() {
          // 창 닫기 물음이 떠 있는 동안에는 저장하지 않고 미룬다(「저장하지 않고 닫기」를 고를 수 있다). 닫는 중이면 미루기만 하고 저장하지 않는다
          if (savesHeld(closeHold.current)) return void autosaveTimers.current.set(p, setTimeout(fire, prefs.autosaveDelay));
          autosaveTimers.current.delete(p);
          void saveRef.current(p, { auto: true });
        }, prefs.autosaveDelay),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, prefs.autosave, prefs.autosaveDelay, revisions, layout]);
  useEffect(() => () => autosaveTimers.current.forEach(clearTimeout), []);

  // 창에서 포커스가 빠지거나 숨겨질 때도 저장(저장 안 한 문서 전부)
  useEffect(() => {
    if (!prefs.autosave) return;
    const go = () => savesHeld(closeHold.current) || void flushRef.current();
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

  /**
   * 문서 열기. 탭: 그 칸에 이미 열린 탭이면 그 탭으로, newTab이면 새 탭에, 아니면 그 칸의 지금 탭을 바꾼다.
   * 바꿔친 문서의 저장 안 한 초안은 저장소에 남고 자동 저장이 이어진다. pane 은 열 칸의 id(기본은 활성 칸).
   * 다른 워크스페이스의 문서면(모든 워크스페이스 보기가 아닐 때) 그 워크스페이스로 바꾼다.
   */
  const open = useCallback(
    async (path: string, opts: { newTab?: boolean; noHistory?: boolean; pane?: string } = {}) => {
      // 화면의 모든 열기(트리·빠른 열기·검색·링크·주소·뒤로 가기)가 여기를 지난다 — 워크스페이스 루트 노트는 열지 않는다(workspaceNote.ts)
      if (isWorkspaceNote(path)) return void toast(t("ws.noteBlocked"));
      if (/\.pdf$/i.test(path)) return setPdfView({ path });
      if (!/\.md$/i.test(path)) return setFileView(path);
      if (settingsFromLocation()) closeSettings(false);
      setDrawer(null);
      const sc = scopeRef.current;
      const target = workspaceOf(path);
      const switching = !sc.allWs && !!target && target !== sc.ws;
      const key = switching ? scopeKeyOf(false, target) : sc.scopeKey;
      const before = layoutsRef.current[key] ?? NO_PANES;
      const beforePanes = panesOf(before);
      // 새 탭으로 열 때 이 칸에 없고 다른 칸에 이미 열려 있으면 새 탭을 만들지 않고 그 칸의 탭으로 간다
      const elsewhere =
        opts.newTab && opts.pane === undefined && !paneOf(before, before.focused)?.tabs.includes(path)
          ? beforePanes.find((p) => p.tabs.includes(path))?.id
          : undefined;
      const pane = switching ? before.focused : (opts.pane ?? elsewhere ?? before.focused);
      if (!switching && pane === before.focused && paneOf(before, pane)?.active === path) return;
      // 읽은 문서를 저장소와 배치에 같은 틈에 넣는다(안 쓰는 문서 정리가 그 사이에 치우지 않게)
      const fresh = docsRef.current[path] ? null : await fetchDoc(path);
      if (!docsRef.current[path] && !fresh) return;
      if (fresh && !docsRef.current[path]) updateDocs((s) => upsertDoc(s, fresh));
      if (switching) {
        setPrefs({ workspace: target! });
        scopeRef.current = { allWs: false, ws: target!, scopeKey: key };
      }
      setLayoutFor(key, (l) => openIn(l, pane, path, { newTab: switching || opts.newTab, mode: l.root ? undefined : lastMode.current }));
      remember(path);
      if (!opts.noHistory) pushNav(path);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchDoc],
  );
  const openRef = useRef(open);
  openRef.current = open;

  /** 그 칸을 side 쪽으로 나눌 수 있는가: 칸의 지금 크기(그려진 요소)로 잰다 */
  const canSplitPane = (pane: string, side: Side) => {
    const el = paneRefs.current.get(pane)?.el.current;
    return !!el && canSplitRect(el.clientWidth, el.clientHeight, side, isNarrowRef.current);
  };
  /** 칸을 side 쪽으로 나눠 path 를 연다(나눌 자리가 없으면 false) */
  const splitWith = (pane: string, side: Side, path: string) => {
    if (!canSplitPane(pane, side)) return false;
    setLayout((l) => splitPane(l, pane, side, path));
    return true;
  };
  /** 다른 칸에 새 탭으로 연다. 칸이 하나면 오른쪽으로 나누고, 나눌 수 없으면 같은 칸의 새 탭으로 */
  const openOther = async (path: string) => {
    if (isWorkspaceNote(path)) return void toast(t("ws.noteBlocked"));
    const l = curLayout();
    const other = otherPaneOf(l, l.focused);
    if (other) return open(path, { pane: other, newTab: true });
    if (!l.root || !canSplitPane(l.focused, "right")) return open(path, { newTab: true });
    // 읽은 뒤에 나눈다(못 읽으면 칸을 만들지 않는다)
    if (!docsRef.current[path]) {
      const fresh = await fetchDoc(path);
      if (!fresh) return;
      if (!docsRef.current[path]) updateDocs((s) => upsertDoc(s, fresh));
    }
    splitWith(l.focused, "right", path);
    remember(path);
    pushNav(path);
  };
  /** 활성 탭을 다른 칸으로(칸이 하나면 오른쪽으로 나눠 옮긴다) */
  const moveActiveTabOther = () => {
    const l = curLayout();
    const active = paneOf(l, l.focused)?.active;
    if (!active) return;
    const other = otherPaneOf(l, l.focused);
    if (other) setLayout((x) => moveTab(x, x.focused, other, active));
    else if (canSplitPane(l.focused, "right")) setLayout((x) => dropTab(x, x.focused, active, x.focused, "right"));
  };
  /** 활성 탭을 side 쪽 이웃 칸으로. 그쪽에 칸이 없으면 그쪽으로 나눠 옮긴다(탭이 둘 이상일 때) */
  const moveActiveTabTo = (side: Side) => {
    const l = curLayout();
    const active = paneOf(l, l.focused)?.active;
    if (!active) return;
    const n = neighborOf(l, l.focused, side);
    if (n) setLayout((x) => moveTab(x, x.focused, n, active));
    else if (canSplitPane(l.focused, side)) setLayout((x) => dropTab(x, x.focused, active, x.focused, side));
  };
  /**
   * 칸으로 포커스를 옮긴다. 보이는 에디터가 없는 칸(미리보기·과거 판 보기)은 칸 요소에 포커스를 준다 — 숨은(display:none)
   * 에디터는 focus() 가 무시돼 포커스가 이전 칸의 에디터에 남고, 활성 칸은 바뀌었는데 키 입력은 이전 칸으로 들어간다
   */
  const focusPaneEl = (pane: string) => {
    const l = curLayout();
    const p = paneOf(l, pane);
    if (!p) return;
    setLayout((x) => focusPane(x, pane));
    const editorHidden = p.mode === "preview" || revisionsRef.current[pane]?.path === p.active;
    setTimeout(() => {
      const r = paneRefs.current.get(pane);
      if (editorHidden) r?.el.current?.focus();
      else r?.handle.current?.focus();
    }, 0);
  };

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

  /** 그 칸의 탭 닫기. 닫는 탭에 저장 안 한 변경이 있으면 저장(자동 저장)하거나 묻는다(다른 칸에도 열려 있으면 그냥 닫는다) */
  const closeTab = async (pane: string, path: string) => {
    const elsewhere = panesOf(curLayout()).some((p) => p.id !== pane && p.tabs.includes(path));
    let discard = false;
    if (!elsewhere && docsRef.current[path] && isDirty(docsRef.current[path])) {
      await flush([path]);
      const after = docsRef.current[path];
      if (after && isDirty(after)) {
        if (!(await confirmDialog(t("tab.discardClose", { name: stemOf(path) }), t("tab.discardCloseButton")))) return;
        discard = true;
      }
    }
    closedTabs.current = [path, ...closedTabs.current.filter((p) => p !== path)].slice(0, 20);
    setLayout((l) => closeIn(l, pane, path));
    // 버리기로 한 초안은 저장소에서도 지운다(남겨 두면 자동 저장이 되살린다)
    if (discard)
      updateDocs((s) => {
        const out = { ...s };
        delete out[path];
        return out;
      });
  };

  /**
   * 탭을 창 밖에 놓았으면 그 노트를 놓은 자리에 새 창으로 열고 이 창의 탭은 닫는다(옮기기). 저장하지 않은 초안은 새 창으로
   * 넘어가지 않으므로 먼저 저장하고, 저장하지 못했으면(자동 저장을 끈 경우 등) 옮기지 않는다.
   * 새 창(solo)의 하나뿐인 탭은 떼어 내도 빈 창만 남으므로 그대로 둔다
   */
  const tearOut = async (e: DragEvent, pane: string, path: string) => {
    if (SOLO && panesOf(curLayout()).reduce((n, p) => n + p.tabs.length, 0) < 2) return;
    const at = await tearOutAt(e);
    if (!at) return;
    await flush([path]);
    const d = docsRef.current[path];
    if (d && isDirty(d)) {
      toast(t("tab.tearOutUnsaved", { name: stemOf(path) }), { kind: "warn" });
      return;
    }
    try {
      await openSolo(path, stemOf(path), at);
    } catch (err) {
      toastError(err);
      return;
    }
    await closeTab(pane, path);
  };

  /**
   * 워크스페이스 바꾸기(또는 모든 워크스페이스 보기 켜고 끄기). 저장 안 한 문서를 저장하고, 그 범위의 칸 배치(마지막으로 본 문서)로 돌아간다.
   * 지금 문서가 새 범위에도 들면 그 문서를 계속 본다.
   */
  const switchScope = async (next: { workspace?: string; all?: boolean }) => {
    await flush();
    const cur = docRef.current;
    const all = next.all ?? (next.workspace ? false : prefs.allWorkspaces);
    const wsName = next.workspace ?? ws;
    setPrefs({ workspace: wsName, allWorkspaces: all });
    const key = scopeKeyOf(all || !wsName, wsName);
    scopeRef.current = { allWs: all || !wsName, ws: wsName, scopeKey: key };
    setDrawer(null);
    if (cur && !isWorkspaceNote(cur.path) && (all || inWorkspace(cur.path, wsName)))
      setLayoutFor(key, (l) =>
        paneOf(l, l.focused)?.active === cur.path ? l : openIn(l, l.focused, cur.path, { newTab: true, mode: l.root ? undefined : lastMode.current }),
      );
  };

  useEffect(() => {
    void refreshTree();
    // 새 창(solo)은 설정 범위가 정해진 뒤 아래 효과가 연다(처음에는 범위가 아직 "*"일 수 있어 배치가 엉뚱한 범위에 들어간다)
    const initial = SOLO ? null : pathFromLocation();
    const boot = bootOpen(initial);
    if (boot === "blocked") toast(t("ws.noteBlocked"));
    if (initial && boot === "open") {
      setLayout((l) => openIn(l, l.focused, initial, { newTab: true, mode: l.root ? undefined : lastMode.current }));
      pushNav(initial);
      void load(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTree, load]);

  // 새 창(`?solo`): 트리를 받은 뒤 그 노트 하나를 연다
  const soloPath = useRef(SOLO ? pathFromLocation() : null);
  useEffect(() => {
    if (!treeLoaded || !soloPath.current) return;
    const path = soloPath.current;
    soloPath.current = null;
    void open(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeLoaded]);

  // 칸이 보고 있는데 아직 읽지 않은 문서(새로고침 뒤 복원한 탭, 닫은 탭의 이웃, 워크스페이스를 바꾼 뒤)를 읽는다.
  // 트리를 받은 뒤에, 볼트에 있는 것만(사라진 탭은 트리 정리가 치운다)
  useEffect(() => {
    if (!treeLoaded) return;
    for (const p of panes) {
      const path = p.active;
      if (!path || docs[path] || loadingRef.current.has(path)) continue;
      if (!resolver.paths.includes(path) && !nodeExists(stripMd(path), resolver.paths)) continue;
      void load(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeLoaded, layout, docs, resolver]);

  // 어느 칸에도(어느 워크스페이스에도) 없는 문서는 저장소에서 치운다. 저장 안 한 것은 저장될 때까지 남긴다
  useEffect(() => {
    const inUse = (p: string) => Object.values(layoutsRef.current).some((l) => panesOf(l).some((pn) => pn.tabs.includes(p)));
    updateDocs((s) => dropUnused(s, inUse));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, layoutByScope]);

  // 좁은 화면(800px 이하)이나 칸이 최소보다 작아질 만큼 좁은 창에서도 배치는 고치지 않는다 — 좁은 화면은 포커스된 칸만
  // 그리고(renderNode), 다시 넓히면 나눈 배치가 그대로 돌아온다

  // 칸이 다른 문서로 바뀌거나 사라지면 그 칸의 과거 판 보기를 닫는다
  useEffect(() => {
    setRevisions((rs) => {
      const keep = Object.entries(rs).filter(([id, r]) => r && r.path === paneOf(layout, id)?.active);
      return keep.length === Object.keys(rs).length ? rs : Object.fromEntries(keep);
    });
  }, [layout]);

  // 주소는 활성 칸의 문서를 따른다(설정 화면이 열려 있을 때는 그대로)
  const activePath = focusedPane?.active ?? null;
  useEffect(() => {
    if (settingsFromLocation()) return;
    const want = activePath ? `#/${encodeURIComponent(activePath)}` : "#";
    if (activePath ? pathFromLocation() !== activePath : pathFromLocation() !== null) history.replaceState(null, "", want);
  }, [activePath, settings]);

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

  /**
   * 창 닫기(데스크톱 앱): 닫는 길(닫기 단추·Cmd+Q·「창 닫기」 명령·메뉴·업데이트 뒤 다시 시작)은 모두 이 창의 닫기 요청으로 모인다.
   * 저장 안 한 변경이 있는 동안 지킴을 켜 두면 앱이 그 요청을 막고 여기에 묻게 한다(closeWindow.ts, app/src-tauri/src/close_guard.rs).
   * 묻는 동안과 닫기로 정한 뒤에는 자동 저장을 멈춘다 — 「저장하지 않고 닫기」를 고를 수 있으므로.
   * 닫기로 정했으면 아래 beforeunload 경고도 다시 묻지 않는다
   */
  const guarded = canCloseWindow() && dirtyPaths(docs).length > 0;
  useEffect(() => {
    if (!canCloseWindow()) return;
    const text = guarded ? { message: t("window.notResponding"), discard: t("window.closeDiscard"), cancel: t("common.cancel") } : null;
    void setCloseGuard(text).catch(() => undefined);
  }, [guarded, lang]);
  useEffect(() => () => void (canCloseWindow() && setCloseGuard(null).catch(() => undefined)), []);
  useEffect(() => {
    if (!canCloseWindow()) return;
    const onAsk = closeAskHandler({
      ack: ackCloseAsk,
      dirty: () => dirtyPaths(docsRef.current),
      ask: async (paths) => {
        const { names, count, more } = unsavedSummary(paths, stemOf);
        return chooseDialog(t(more ? "window.unsavedMore" : "window.unsaved", { names, count }), { value: "save", label: t("window.closeSave") }, [
          { value: "discard", label: t("window.closeDiscard") },
        ]);
      },
      // 자동 저장 설정과 상관없이 모두 저장한다. 자동 저장이 저장하던 문서는 끝나기를 기다렸다가 다시 저장한다
      save: async () => {
        for (const p of dirtyPaths(docsRef.current)) {
          while (savingRef.current.has(p)) await new Promise((r) => setTimeout(r, 50));
          await saveRef.current(p);
        }
      },
      unsaved: (paths) => toast(t("window.saveFailed", { names: unsavedSummary(paths, stemOf).names }), { kind: "error" }),
      close: destroyCurrentWindow,
      hold: closeHold.current,
      dropPending: () => dropAutosaves(autosaveTimers.current, autosaveArmed.current),
      cancelled: () => void cancelQuit().catch(() => undefined),
      failed: toastError,
    });
    let gone = false;
    let unlisten: (() => void) | undefined;
    listenCloseAsks((id) => void onAsk(id)).then((u) => (gone ? u() : (unlisten = u)), toastError);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  // 업데이트 뒤 다시 시작을 누가 취소했으면 새 창(SOLO)에도 알린다. 업데이트 대화상자는 원래 창에만 있고, 그 창은 먼저 닫혔을 수 있다
  useEffect(() => {
    if (!canCloseWindow() || !SOLO) return;
    let gone = false;
    let unlisten: (() => void) | undefined;
    listenRestartCancelled(() => toast(t("update.restartCancelled"))).then((u) => (gone ? u() : (unlisten = u)), toastError);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  // 저장 안 한 변경(지금 문서 또는 뒤에 있는 탭)이 있으면 창을 닫기 전에 저장을 시도하고 묻는다
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (closeHold.current.closing || !dirtyPaths(docsRef.current).length) return;
      void flushRef.current();
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
      // 열린 문서 중 보낸 것(사본을 만들었으면 전부)을 저장 안 한 변경이 없을 때 다시 읽는다
      for (const e of Object.values(docsRef.current))
        if ((synced.includes(e.doc.path) || merged.includes(e.doc.path) || conflicts.length) && e.doc.draft === e.doc.saved) await load(e.doc.path);
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
      // 열린 문서(어느 칸이든)가 바뀌었으면 다시 읽는다. 저장 안 한 변경이 있으면 알리기만
      for (const p of paths) {
        const e = docsRef.current[p];
        if (!e) continue;
        if (e.doc.draft === e.doc.saved) void load(p);
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
   * workspace: 올릴 워크스페이스(기본은 from 이 든 곳)
   */
  const uploadFiles = async (files: File[], from = doc?.path, workspace = wsOfPath(from)): Promise<string[]> => {
    if (!workspace) return [];
    const dir = attachmentDirFor(getVaultSettings(), workspace, uiLang);
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

  const saveConflictCopy = async (path: string) => {
    const d = docsRef.current[path]?.doc;
    if (!d) return;
    const copy = conflictCopyPath(path, vaultText(vaultLang()).conflictCopy);
    try {
      await api.write(copy, d.draft, null);
      vaultChanged();
      await refreshTree();
      await load(path);
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
    setFocusedMode((m) => (m === "preview" ? "edit" : m));
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
      // 데일리 아이콘은 노트가 아니라 데일리 폴더에 보인다(트리 장식). 새 노트에는 넣지 않는다
      content = withDailyTags(body, day, { weekStart: cfg.weekStart, lang: cfg.lang });
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
    setFocusedMode((m) => (m === "preview" ? "edit" : m));
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
      const e = docsRef.current[m.from];
      return e && e.doc.draft !== e.doc.saved;
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
    const text = applyTemplate(tpl, { title, date: new Date(), lang: vaultLang() });
    // 막 만든 노트(앱이 적은 edited 만 있음)는 템플릿으로 채운다 — 커서 자리에 넣으면 템플릿 프런트매터가 본문 안의 둘째 블록이 된다
    const filled = fillBlankNote(doc.draft, text);
    if (filled === null) editorHandle.current?.insertText(text);
    else {
      editorHandle.current?.setContent(filled);
      editorHandle.current?.focus();
    }
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

  /** 문서 해시: 열린 문서면 저장한 뒤의 것, 아니면 읽어서 */
  const hashOf = async (path: string): Promise<string | null> => {
    if (docsRef.current[path]) {
      const shown = docRef.current?.path === path;
      if (!(await flush([path])) || docsRef.current[path].doc.draft !== docsRef.current[path].doc.saved) {
        toast(shown ? t("doc.unsavedNoMove") : t("doc.saveTabFirst", { name: stemOf(path) }), { kind: "error" });
        return null;
      }
      return docsRef.current[path].doc.hash;
    }
    return (await api.read(path, { fresh: true })).hash;
  };

  /** 이동이 끝난 뒤: 탭·열린 문서·기록의 경로를 바꾼다. content가 null이면(여러 개를 옮김) 그 문서를 다시 읽는다 */
  const afterMove = async (from: string, to: string, content: string | null, hash: string | null) => {
    moveFolds(from, to);
    setAllLayouts((l) => renamePath(l, from, to));
    setRecent((r) => r.map((p) => (p === from ? to : p)));
    renameViewed(from, to, false);
    updatePins((p) => movePins(p, stripMd(from), stripMd(to), false));
    nav.current.list = nav.current.list.map((p) => (p === from ? to : p));
    const opened = !!docsRef.current[from];
    updateDocs((s) =>
      renameDoc(s, from, to, (d) =>
        content === null || hash === null
          ? d
          : // 내용이 그대로면(상대 링크를 고치지 않았으면) 에디터를 다시 만들지 않는다
            d.draft === content
            ? { ...d, saved: content, hash }
            : { ...d, saved: content, draft: content, hash, seq: d.seq + 1 },
      ),
    );
    if (opened && (content === null || hash === null)) await load(to);
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
    const dirtyDoc = Object.values(docsRef.current)
      .map((e) => e.doc)
      .find((d) => inside(d.path) && d.draft !== d.saved);
    if (dirtyDoc) {
      toast(t("doc.saveFirst", { name: stemOf(dirtyDoc.path) }), { kind: "error" });
      return false;
    }
    const files = nodeFiles(from, resolver.paths);
    try {
      let linkCount = 0;
      let others = 0;
      // 다른 부모로 옮기는 것은 잎 노드여도 노드 이동으로 — 옮긴 노트의 커스텀 순서(rank)는 노드 이동만 지운다
      if (files.length === 1 && files[0] === `${from}.md` && parentOf(from) === parentOf(to)) {
        // 잎 노드 이름 바꾸기: 문서 하나 이동
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
      // 노트 없는 하위 노드의 고정도 따라가게 노드째로(노트의 고정은 afterMove 가 이미 옮겼다)
      updatePins((p) => movePins(p, from, to));
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

  /** 탭·기록·저장소에서 지운 노드의 문서를 뺀다(저장 안 한 초안도: 남기면 자동 저장이 되살린다) */
  const forget = (gone: (p: string) => boolean) => {
    setAllLayouts((l) => removePaths(l, gone));
    updateDocs((s) => {
      const dead = Object.keys(s).filter(gone);
      if (!dead.length) return s;
      const out = { ...s };
      for (const p of dead) delete out[p];
      return out;
    });
    setRecent((r) => r.filter((p) => !gone(p)));
    forgetViewed(gone);
  };

  /**
   * 노드 삭제: 노드 노트와 하위 전체를 한 번에(한 커밋). 하위 개수를 보여 주고 확인받는다.
   * 지우기 전에 내용을 읽어 두어 알림의 "되돌리기"가 하위까지 되살린다.
   */
  const deleteNode = async (node: string) => {
    // 트리 메뉴에서 워크스페이스 행을 지울 때도 워크스페이스 삭제로(지금 워크스페이스·공통 설정·배치를 같이 걷는다)
    if (!node.includes("/")) return removeWorkspace(node);
    const n = findNode(nodeTree, node);
    const counts = n ? countNode(n) : { nodes: 0, attachments: 0 };
    const name = stemOf(node);
    const message =
      counts.nodes || counts.attachments
        ? t("node.deleteAskChildren", { name, nodes: counts.nodes, attachments: counts.attachments })
        : t("node.deleteAsk", { name });
    if (!(await confirmDialog(`${message}\n${node}`, t("common.delete")))) return;
    await removeNode(node);
  };

  /**
   * 확인받은 노드 삭제(워크스페이스 삭제도 이 길로). after: 지운 직후, undone: 되돌리기로 파일을 되살린 직후(노드 노트를 열기 전).
   * 둘 다 실패해도 삭제·되살리기 자체는 끝난 것이라 알림만 띄운다. reopen: false 면 되살린 노드 노트를 열지 않는다
   */
  const removeNode = async (node: string, hooks: { after?: () => Promise<void>; undone?: () => Promise<void>; reopen?: boolean } = {}) => {
    const name = stemOf(node);
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
      await hooks.after?.().catch(toastError);
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
                await hooks.undone?.().catch(toastError);
                if (hooks.reopen !== false && saved.some((s) => s.path === `${node}.md`)) void open(`${node}.md`);
              })
              .catch(toastError),
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(t("node.changedRetry"), { kind: "error" });
      else toastError(e);
    }
  };

  /**
   * 워크스페이스 삭제(설정 → 워크스페이스): 노드 삭제와 같은 길(되돌리기 알림)로 지우고, 그 워크스페이스를 가리키던
   * 지금 워크스페이스(이 기기)·칸 배치(이 기기)·워크스페이스별 설정과 순서(공통 설정)를 걷는다. 되돌리면 공통 설정도 되살린다.
   * 첨부 수는 트리에서 숨긴 워크스페이스 첨부 폴더까지 센다.
   */
  const removeWorkspace = async (name: string) => {
    const n = wsNode(name);
    const attachments = nodeFiles(name, resolver.paths).filter((p) => !/\.md$/i.test(p) && !isVaultSettingsPath(p)).length;
    const ask = t("ws.deleteAsk", { name, nodes: n ? countNode(n).nodes : 0, attachments });
    if (!(await confirmDialog(ask, t("common.delete")))) return;
    const wasCurrent = name === ws;
    const next = workspaceAfterDelete(wsNames, ws, name);
    const saved = workspaceRefs(getVaultSettings(), name);
    let savedPins: SavedPins = [];
    await removeNode(name, {
      // 되살린 루트 노트는 열지 않는다(workspaceNote.ts). 지금 워크스페이스로 되돌리는 것은 undone 이 한다
      reopen: false,
      after: async () => {
        setLayouts((m) => dropWorkspaceLayout(m, name));
        if (wasCurrent) setPrefs({ workspace: next });
        updatePins((p) => {
          const r = dropWorkspacePins(p, name);
          savedPins = r.saved;
          return r.pins;
        });
        for (const [p, v] of dropWorkspaceRefs(getVaultSettings(), name)) await updateVaultSetting(p, v);
      },
      undone: async () => {
        updatePins((p) => restoreWorkspacePins(p, savedPins));
        for (const [p, v] of restoreWorkspaceRefs(getVaultSettings(), name, saved)) await updateVaultSetting(p, v);
        if (wasCurrent) setPrefs({ workspace: name });
      },
    });
  };

  /** 고정·고정 해제(이 기기). 워크스페이스 노드는 고정하지 않는다 */
  const togglePin = (node: string) => {
    if (!node.includes("/")) return;
    updatePins((p) => (p.includes(node) ? removePin(p, node) : addPin(p, node)));
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

  /**
   * 여러 노트를 한 번에(한 커밋으로) 고쳐 쓴다 — 하위 노트 정렬·순서 바꾸기. 열린 노트는 먼저 저장하고(못 하면 알리고 그만둔다),
   * 지금 내용을 읽어 make 로 쓰기 목록을 만든다. 쓴 뒤 열린 노트는 쓴 내용으로 다시 연다(남기면 다음 저장이 옛 해시로 충돌한다)
   */
  const writeNotes = async (paths: string[], make: (read: (p: string) => NoteState) => NoteWrite[]): Promise<boolean> => {
    if (!(await flush(paths))) {
      const dirtyPath = paths.find((p) => docsRef.current[p] && isDirty(docsRef.current[p]));
      toast(t("doc.saveTabFirst", { name: stemOf(dirtyPath ?? paths[0]) }), { kind: "error" });
      return false;
    }
    try {
      const read = new Map<string, NoteState>();
      for (const p of new Set(paths))
        read.set(
          p,
          await api.read(p, { fresh: true }).catch((e) => {
            if (e instanceof ApiError && e.status === 404) return null;
            throw e;
          }),
        );
      const writes = make((p) => read.get(p) ?? null);
      if (!writes.length) return true;
      const vt = vaultText(vaultLang()).commit;
      const done = await api.writeMany(writes, writes.length === 1 ? vt.modify(writes[0].path) : vt.batch(writes.length));
      const hashes = new Map(done.map((d) => [d.path, d.hash]));
      for (const w of writes)
        patchDoc(w.path, (d) => ({ ...d, saved: w.content, draft: w.content, hash: hashes.get(w.path) ?? d.hash, virtual: false, seq: d.seq + 1 }));
      vaultChanged();
      await refreshTree();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    }
  };

  /** 하위 노트 정렬: 부모 노트의 sort(node null 이면 지금 워크스페이스). 처음 커스텀이면 보이는 순서대로 rank 도 함께 적는다 */
  const setChildSort = async (node: VaultNode | null, sort: ChildSort) => {
    const parent = node ?? wsNode(ws);
    if (!parent) return;
    const parentNote = `${parent.path}.md`;
    const shown = shownChildren(parent.children, parent.sort ?? null, !!treeDecor.descending?.(parent.path), viewedSnapshot());
    // 자동 생성 노트(위키 index·log)에는 rank 를 적지 않는다 — 쓰면 일괄 쓰기 전체가 거부된다
    const seeds = sort === "custom" ? seedWritable(shown, isGeneratedNote) : [];
    await writeNotes([parentNote, ...seeds.map((x) => x.note)], (read) => childSortWrites(parentNote, read(parentNote), sort, seeds, read));
  };

  /** 커스텀 순서 바꾸기: 같은 부모 안에서 path 를 beforePath 앞으로(null 이면 맨 뒤). 보통은 옮긴 노트 하나의 rank 만 바뀐다 */
  const reorderNode = async (path: string, beforePath: string | null) => {
    const parent = findNode(nodeTree, parentOf(path));
    if (!parent || parent.sort !== "custom") return;
    let plan: ReturnType<typeof planWritable>;
    try {
      plan = planWritable(shownChildren(parent.children, "custom", false, viewedSnapshot()), isGeneratedNote, path, beforePath);
    } catch (e) {
      return toastError(e);
    }
    if (!plan.length) return;
    await writeNotes(
      plan.map((p) => p.note ?? `${p.node}.md`),
      (read) => rankWrites(plan, read),
    );
  };

  /**
   * 「위로」·「아래로」(메뉴·단축키): 노드를 한 칸. 단축키는 트리에서 고른 노드(트리에 포커스가 없으면 지금 노트).
   * 한 칸은 rank 를 적을 수 있는 형제 사이에서 센다 — 자동 생성 노트는 늘 rank 없는 노트로 뒤에 있어 그 너머로 옮길 수 없다
   */
  const moveSibling = (dir: -1 | 1, node?: string) => {
    const path = node ?? treeRef.current?.focusedNode() ?? (docRef.current ? stripMd(docRef.current.path) : null);
    if (!path || !path.includes("/") || isGeneratedNote(`${path}.md`)) return;
    const parent = findNode(nodeTree, parentOf(path));
    if (parent?.sort !== "custom") return void toast(t(reorderHintKey(parentOf(path))), { kind: "info" });
    const before = siblingTarget(writableSiblings(shownChildren(parent.children, "custom", false, viewedSnapshot()), isGeneratedNote), path, dir);
    if (before !== undefined) void reorderNode(path, before);
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
      setRevision({ path: doc.path, commit, content: await api.revision(doc.path, commit.rev) });
    } catch (e) {
      toastError(e);
    }
  };

  /** 그 칸이 보고 있는 과거 판으로 되돌린다 */
  const rollback = async (pane: string) => {
    const rev = revisionOf(pane);
    const d = rev ? docsRef.current[rev.path]?.doc : undefined;
    if (!rev || !d) return;
    if (d.draft !== d.saved && !(await confirmDialog(t("history.discardRollback"), t("history.rollback")))) return;
    try {
      await api.rollback(d.path, rev.commit.rev, d.hash);
      vaultChanged();
      await load(d.path);
      toast(t("history.rolledBack"), { kind: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(t("doc.changedReload"), { kind: "error" });
      else toastError(e);
    }
  };

  /** 위젯에서 문서를 바꿨을 때: 열린 문서면(저장 안 한 변경이 없을 때) 다시 불러온다. */
  const onWidgetChanged = (path: string) => {
    setVaultVersion((v) => v + 1);
    const d = docsRef.current[path]?.doc;
    if (d) {
      if (d.draft === d.saved) void load(path);
      else toast(t("doc.changedByWidget"), { kind: "warn", duration: 0 });
    }
  };

  const followLinkRef = useRef<(target: string, anchor: { heading?: string; block?: string } | null, other: boolean, page?: string) => void>(() => undefined);
  /** 링크 대상 열기: Mod+클릭이면 다른 칸 */
  const followLink = (target: string, anchor: { heading?: string; block?: string } | null, other: boolean, page?: string) => {
    if (target.toLowerCase().endsWith(".md")) {
      if (other) {
        if (anchor) setPendingAnchor({ path: target, ...anchor });
        return void openOther(target);
      }
      if (anchor && target === doc?.path) paneRefs.current.get(curLayout().focused)?.api.current?.scrollToAnchor(anchor);
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
    if (settingsFromLocation()) replaceSettingsSection(history, s);
    else history.pushState(null, "", `${SETTINGS_HASH}/${s}`);
    setSettings(s);
  };
  /** restore: 지금 문서 주소로 되돌린다(아니면 곧 다른 문서를 여는 중이라 비워 둔다) */
  const closeSettings = (restore = true) => {
    setSettings(null);
    // 부팅이 동기화 화면으로 바꿔 치운 노트(settingsNav.ts)가 있으면 그 노트로 돌아간다
    const go = settingsCloseTarget({ restore, current: docRef.current?.path ?? null, back: settingsBack(history.state) });
    history.replaceState(null, "", go.hash);
    if (go.open) void openRef.current(go.open);
    // 복원·동기화 등으로 볼트가 바뀌었을 수 있다: 트리·문서·공통 설정을 다시 읽는다
    vaultChanged();
    void refreshTree();
    void reloadVaultSettings();
    const d = docRef.current;
    if (d && d.draft === d.saved && !d.virtual) void load(d.path);
  };

  const toggleMode = () => setFocusedMode((m) => (m === "preview" ? "edit" : "preview"));

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
      updatePins((p) => movePins(p, from, n));
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
      // 문서 경로는 afterMove 가 바꿨다. 워크스페이스 이름으로 기억하던 배치만 새 이름으로 옮긴다
      setLayouts((m) => {
        if (!m[from]) return m;
        const next = { ...m, [n]: m[from] };
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
    remove: removeWorkspace,
    pickIcon(name, at) {
      setIconPick({ ...at, node: name });
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
          // 탭은 그대로 두고 활성 칸에서 보던 문서만 내린다
          setLayout((l) => clearActive(l, l.focused));
          closeSettings(false);
        })(),
    },
    ...wsNames
      .slice(0, 9)
      .map((w, i) => ({ id: `ws-${i + 1}`, group: g.ws, label: t("cmd.switchWs", { name: w }), run: () => void switchScope({ workspace: w, all: false }) })),
    { id: "ws-all", group: g.ws, label: allWs ? t("cmd.wsOnlyOne") : t("cmd.wsAll"), run: () => void switchScope({ all: !allWs }) },
    { id: "new", group: g.doc, label: t("cmd.new"), keys: "Mod+N", webKeys: "Alt+N", run: () => void createDoc() },
    { id: "note-up", group: g.doc, label: t("cmd.noteUp"), keys: "Alt+Shift+ArrowUp", inInputs: false, run: () => moveSibling(-1) },
    { id: "note-down", group: g.doc, label: t("cmd.noteDown"), keys: "Alt+Shift+ArrowDown", inInputs: false, run: () => moveSibling(1) },
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
    ...(doc && doc.path.includes("/")
      ? [
          {
            id: "pin",
            group: g.doc,
            label: pins.includes(stripMd(doc.path)) ? t("tree.unpin") : t("tree.pin"),
            run: () => togglePin(stripMd(doc.path)),
          },
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
    {
      id: "close-tab",
      group: g.tab,
      label: t("cmd.closeTab"),
      keys: "Mod+W",
      webKeys: "Alt+W",
      run: () => doc && void closeTab(curLayout().focused, doc.path),
    },
    ...closeWindowCommands(canCloseWindow(), { group: g.tab, label: t("cmd.closeWindow"), run: () => void closeCurrentWindow().catch(toastError) }),
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
        const list = paneOf(curLayout(), curLayout().focused)?.tabs ?? [];
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
    { id: "mode-edit", group: g.view, label: t("cmd.modeEdit"), run: () => setFocusedMode("edit") },
    { id: "mode-split", group: g.view, label: t("cmd.modeSplit"), run: () => setFocusedMode("split") },
    { id: "mode-preview", group: g.view, label: t("cmd.modePreview"), run: () => setFocusedMode("preview") },
    // 칸 나누기·옮기기. 키는 docs/superpowers/plans/2026-10-19-pane-splits.md 「단축키(빌더 결정)」 — Mod+K 묶음은 에디터의
    // 링크 넣기(Mod-k)와 겹치고, Mod+Alt+방향키는 뒤로·앞으로와 CodeMirror 커서 추가가 쓴다
    // 나누면 활성 탭을 새 칸에도 연다(Zed 처럼 같은 노트가 두 칸에 보인다)
    { id: "split", group: g.view, label: t("cmd.splitRight"), keys: "Mod+\\", run: () => splitFocused("right") },
    { id: "split-down", group: g.view, label: t("cmd.splitDown"), keys: "Mod+Shift+\\", run: () => splitFocused("bottom") },
    ...(["left", "right", "top", "bottom"] as const).map((side) => ({
      id: `focus-pane-${side}`,
      group: g.view,
      label: t(`cmd.focusPane.${side}`),
      keys: `Mod+Alt+Shift+${ARROW[side]}`,
      run: () => {
        const n = neighborOf(curLayout(), curLayout().focused, side);
        if (n) focusPaneEl(n);
      },
    })),
    {
      id: "focus-other-pane",
      group: g.view,
      label: t("cmd.focusOtherPane"),
      keys: "Mod+Shift+,",
      run: () => {
        const other = otherPaneOf(curLayout(), curLayout().focused);
        if (other) focusPaneEl(other);
      },
    },
    { id: "merge-panes", group: g.view, label: t("cmd.mergePanes"), run: () => setLayout(mergePanes) },
    { id: "move-tab-other", group: g.tab, label: t("cmd.moveTabOther"), keys: "Mod+Shift+.", run: () => moveActiveTabOther() },
    // Windows·Linux 는 Ctrl 이 Mod 와 같아 남는 방향키 조합이 없어 기본 키를 두지 않는다(설정에서 지정)
    ...(["left", "right", "top", "bottom"] as const).map((side) => ({
      id: `move-tab-${side}`,
      group: g.tab,
      label: t(`cmd.moveTab.${side}`),
      macKeys: `Mod+Ctrl+${ARROW[side]}`,
      run: () => moveActiveTabTo(side),
    })),
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
    { id: "trash", group: g.tool, label: t("tool.trash"), run: () => setTrashOpen(true) },
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

  /** 활성 칸을 side 쪽으로 나눠 활성 탭을 새 칸에도 연다 */
  function splitFocused(side: Side) {
    const l = curLayout();
    const cur = paneOf(l, l.focused)?.active;
    if (cur) splitWith(l.focused, side, cur);
  }

  function cycleTab(dir: number) {
    const list = paneOf(curLayout(), curLayout().focused)?.tabs ?? [];
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
    const docs = resolver.paths.filter((p) => /\.md$/i.test(p) && !isWorkspaceNote(p) && !isVaultSettingsPath(p) && (!scope || inWorkspace(p, scope)));
    const order = (p: string) => (allTabs.includes(p) ? 0 : recent.includes(p) ? 1 + recent.indexOf(p) / 100 : 2);
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
  }, [resolver, allTabs.join("\n"), recent, daily, iconMap, prefs.showIcons, prefs.dailyFriendly, scope, lang]);

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

  /** 검색 폴더 필터로 고를 노드(지금 범위의 트리 안, 하위가 있는 것). 고르면 검색 칸으로 돌아간다 */
  const searchFolderItems: PaletteItem[] = useMemo(
    () =>
      palette === "search-folder"
        ? folderChoices(viewNodes).map((f) => ({
            id: f,
            label: scope ? f.slice(scope.length + 1) : f,
            run: () => {
              setSearchFilter((cur) => ({ ...cur, folder: f }));
              setTimeout(() => searchInput.current?.focus(), 0);
            },
          }))
        : [],
    [palette, viewNodes, scope],
  );

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

  // 개요의 접힘 표시: 에디터·미리보기에서 바꾸면 따라간다
  useEffect(() => onFoldsChange((path) => path === docRef.current?.path && setFoldVersion((v) => v + 1)), []);

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
    openOther: (p) => void openOther(p),
    pickIcon: (n, at) => setIconPick({ ...at, node: n.path }),
    pinned: (n) => pins.includes(n),
    togglePin,
    setChildSort: (n, sort) => void setChildSort(n, sort),
    reorder: (p, before) => void reorderNode(p, before),
    moveSibling: (p, dir) => moveSibling(dir, p),
  };

  const treeDecor = useMemo<TreeDecor>(() => {
    // 데일리 폴더 → 그 워크스페이스의 데일리 아이콘(노트 자신의 아이콘이 있으면 그것)
    const dailyIcons = new Map(daily.all().map((d) => [d.config.folder, workspaceSettings(shared, d.workspace, uiLang).daily.icon]));
    const dirs = new Set(dailyIcons.keys());
    return {
      label: (n) => (n.note ? docLabel(n.note) : n.name),
      icon: (n) => (n.note ? iconOf(n.note) : null) ?? (prefs.showIcons ? dailyIcons.get(n.path) || null : null),
      descending: (d) => prefs.dailySortDesc && [...dirs].some((dir) => d === dir || d.startsWith(dir + "/")),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, shared, uiLang, prefs.showIcons, prefs.dailySortDesc, prefs.dailyFriendly, iconMap, docIcon, doc?.path, lang]);

  const words = useMemo(() => {
    const text = doc?.draft ?? "";
    return { chars: text.replace(/\s/g, "").length, words: (text.match(/\S+/g) ?? []).length };
  }, [doc?.draft]);

  const linkCount = refs ? refs.linkedBy.length + refs.sources.length + refs.citedBy.length : 0;
  const railSide = "right" as const;
  const rl = prefs.railLabels && !isNarrow;

  // ── 화면 조각
  const wsIcon = (name: string) => (prefs.showIcons ? (iconMap.get(`${name}.md`) ?? null) : null);
  /**
   * 워크스페이스 전환기 — 트리의 루트 표시를 겸한다. 사이드바 둘째 줄에서는 남는 폭을 다 채우고,
   * 사이드바를 접으면 브레드크럼 첫 칸에 작게(compact) 놓인다(switcherSpot). 둘 다 같은 목록(wsMenuItems)을 연다.
   * spot 은 어느 전환기인지("dock" 또는 칸 id) — 칸마다 하나씩 놓여도 메뉴를 연 그 전환기만 펼친 모양(aria-expanded)이 된다
   */
  const wsName = allWs ? t("ws.all") : ws || t("ws.none");
  const wsSwitcher = (spot: string, compact: boolean) => (
    <button
      type="button"
      className={`ws-switch${compact ? " compact" : ""}`}
      aria-haspopup="menu"
      aria-expanded={wsMenu?.spot === spot}
      aria-label={t("ws.switch", { name: wsName })}
      {...tipProps({ label: wsName, side: "bottom" })}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setWsMenu({ x: r.left, y: r.bottom + 4, spot });
      }}
    >
      {allWs ? (
        <span className="ws-mark" aria-hidden>
          <Layers size={compact ? 14 : 16} strokeWidth={1.75} />
        </span>
      ) : wsIcon(ws) ? (
        <span className="ws-mark ws-emoji" aria-hidden>
          {wsIcon(ws)}
        </span>
      ) : (
        <span className="ws-mark ws-letter" aria-hidden>
          {[...(ws || "?")][0]}
        </span>
      )}
      <span className="ws-switch-name">{wsName}</span>
      <ChevronsUpDown className="ws-switch-caret" size={compact ? 12 : 14} strokeWidth={1.75} aria-hidden />
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
  const wsMenuItems: MenuEntry[] = [
    ...wsNames.map((w) => ({ label: w, lead: wsLead(w), checked: !allWs && w === ws, run: () => void switchScope({ workspace: w, all: false }) })),
    "-",
    { label: t("ws.all"), icon: Layers, checked: allWs, run: () => void switchScope({ all: !allWs }) },
    { label: t("ws.manage"), icon: SettingsIcon, run: () => openSettings("workspaces") },
  ];

  const rail = (
    <nav className={`rail${rl ? " with-labels" : ""}`} aria-label={t("rail.label")}>
      <div className="rail-top">
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
          label={newVersion ? `${t("settings.title")} · ${t("update.availableShort", { version: newVersion.version })}` : t("settings.title")}
          shortLabel={t("settings.title")}
          side={railSide}
          showLabel={rl}
          keys={keyOf("settings")}
          active={!!settings}
          dot={!!newVersion}
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
  // 고정: 지금 있는 노드 중 지금 워크스페이스의 것(지운 것·다른 기기에서 옮겨 간 것은 숨는다)
  const pinnedShown = shownPins(pins, (n) => pinExists(n, resolver.paths), inScope);
  /** 사이드바 둘째 줄: 전환기 + 지금 보기의 단추(파일 보기면 트리 단추). 편집 칸의 문서 머리와 높이를 맞춘다(--head-h) */
  const dockHead = (
    <div className="dock-head">
      {wsSwitcher("dock", false)}
      {prefs.leftView === "files" && (
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
          <TreeOptions
            prefs={prefs}
            rootSort={allWs || !wsNode(ws) ? undefined : { sort: wsNode(ws)!.sort, descending: !!treeDecor.descending?.(ws) }}
            onRootSort={(sort) => void setChildSort(null, sort)}
          />
        </span>
      )}
    </div>
  );
  const leftPanel = (
    <aside className="left-panel" aria-label={leftLabel}>
      {prefs.leftView === "files" && (
        <>
          {pinnedShown.length > 0 && (
            <div className="pins">
              <button type="button" className="pins-head" aria-expanded={prefs.pinsOpen} onClick={() => setPrefs({ pinsOpen: !prefs.pinsOpen })}>
                <ChevronRight size={14} className="pins-chevron" aria-hidden />
                {t("tree.pinned")}
                <span className="meta">{pinnedShown.length}</span>
              </button>
              {prefs.pinsOpen && (
                <ul className="pins-list">
                  {pinnedShown.map((n) => (
                    <li key={n} className={doc && stripMd(doc.path) === n ? "active" : ""}>
                      <a
                        href={`#/${encodeURIComponent(`${n}.md`)}`}
                        {...tipProps({ label: n })}
                        onClick={(e) => {
                          e.preventDefault();
                          void openNode(n, { newTab: true });
                        }}
                      >
                        {iconOf(`${n}.md`) ? <DocIcon icon={iconOf(`${n}.md`)} /> : <FileText size={15} strokeWidth={1.75} aria-hidden className="tree-icon" />}
                        <span className="pins-name">{docLabel(`${n}.md`, { plain: true })}</span>
                        {allWs && <span className="meta pins-where">{parentOf(n)}</span>}
                      </a>
                      <IconButton size={14} icon={PinOff} label={t("tree.unpin")} className="pins-unpin" onClick={() => togglePin(n)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Tree
            ref={treeRef}
            nodes={viewNodes}
            root={scope}
            current={doc?.path ?? null}
            prefs={prefs}
            actions={treeActions}
            decor={treeDecor}
            rootSort={allWs ? null : (wsNode(ws)?.sort ?? null)}
            moveKeys={{ up: keyOf("note-up"), down: keyOf("note-down") }}
            storageKey={`keyring:tree-open:${scopeKey}`}
            readOnly={isGeneratedNote}
          />
        </>
      )}
      {prefs.leftView === "search" && (
        <>
          <div className="panel-head">
            <strong>{t("rail.search")}</strong>
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
          {searchMode === "text" && (
            <SearchFilters
              filter={searchFilter}
              scope={scope}
              tags={filterTags}
              onChange={setSearchFilter}
              onPickFolder={() => setPalette("search-folder")}
              onFocusSearch={() => searchInput.current?.focus()}
            />
          )}
          {hits !== null && (
            <SearchResults
              hits={hits}
              offline={searchOffline}
              query={query.trim()}
              searchKey={searchKey(query, searchFilter)}
              semantic={searchMode === "semantic" && !query.trim().startsWith("#")}
              current={doc?.path ?? null}
              iconOf={iconOf}
              onGo={(path, line, text, newTab) => {
                if (path === doc?.path) return editorHandle.current?.gotoLine(line, text);
                if (line > 1 || text) setPendingAnchor({ path, line, text });
                void open(path, { newTab });
              }}
            />
          )}
        </>
      )}
      {prefs.leftView === "attachments" && (
        <>
          <div className="panel-head">
            <strong>{t("attach.title", { count: attachmentPaths.length })}</strong>
          </div>
          <AttachmentList
            paths={attachmentPaths}
            embedText={embedText}
            onOpen={(p) => treeActions.openAttachment(p)}
            onInsert={canInsert ? (p) => editorHandle.current?.insertText(embedText(p), { keepSelection: true, ownLine: true }) : undefined}
            onUpload={ws ? (files) => void uploadFiles(files, undefined, allWs ? wsOfPath(doc?.path) : ws) : undefined}
          />
        </>
      )}
      {prefs.leftView === "tags" && (
        <>
          <div className="panel-head">
            <strong>{t("tags.title", { count: tags.length })}</strong>
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
                    paneRefs.current.get(layout.focused)?.api.current?.scrollToAnchor({ heading: h.text.toLowerCase() });
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
              !doc.virtual && <p className="meta">{t("common.loading")}</p>
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
        ...(isWsDoc
          ? []
          : [
              pins.includes(docNode)
                ? { label: t("tree.unpin"), icon: PinOff, run: () => togglePin(docNode) }
                : { label: t("tree.pin"), icon: Pin, run: () => togglePin(docNode) },
            ]),
        "-",
        { label: t("doc.openOther"), icon: Columns2, run: () => void openOther(doc.path) },
        { label: t("cmd.modeSplit"), run: () => setFocusedMode("split") },
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
              {cursors[layout.focused]?.line ?? 1}:{cursors[layout.focused]?.col ?? 1}
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

  /** 탭을 끌어 옮길 때 dataTransfer 에 싣는 형식(트리의 끌기와 섞이지 않게 따로) */
  const TAB_DRAG = "application/x-keyring-tab";
  /**
   * 칸 하나의 탭 바(칸이 없으면 빈 탭 바). 탭을 끌어 다른 칸(가운데·가장자리)에 놓아 옮기거나 나눈다 — 놓을 자리는 renderDropZone.
   * 맨 위 줄(top)의 탭 바는 창의 첫 줄이라 빈 자리가 창 끌기 영역이다(macOS 앱)
   */
  const renderTabBar = (pane: Pane | null, withNav: boolean, top: boolean) => (
    <nav className="tabbar" aria-label={t("tab.label")} {...(top ? DRAG_REGION : {})}>
      {withNav && (
        <IconButton
          className="nav-toggle"
          icon={MenuIcon}
          label={t("tab.docList")}
          onClick={() => setDrawer((d) => (d === "left" ? null : "left"))}
          size={18}
        />
      )}
      <div className="tab-list" role="tablist">
        {(pane?.tabs ?? []).map((tp) => {
          const cached = docs[tp]?.doc;
          const tabDirty = !!cached && cached.draft !== cached.saved;
          const on = tp === pane?.active;
          return (
            <span
              key={tp}
              className={`tab${on ? " on" : ""}`}
              {...tipProps({ label: tp })}
              role="tab"
              aria-selected={on}
              draggable
              onDragStart={(e) => {
                if (!pane) return;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(TAB_DRAG, JSON.stringify({ pane: pane.id, path: tp }));
                // 놓을 자리는 다음 틱에 덮는다 — dragstart 안에서 포인터 밑에 요소를 그리면 브라우저가 끌기를 바로 끝낸다
                const from = { pane: pane.id, path: tp };
                setTimeout(() => setTabDrag(from), 0);
              }}
              onDragEnd={(e) => {
                setTabDrag(null);
                setDropAt(null);
                // 데스크톱 앱에서 창 밖에 놓았으면 새 창으로 떼어 낸다(웹은 지금처럼 아무 일도 없다)
                if (pane && canTearOut()) void tearOut(e.nativeEvent, pane.id, tp);
              }}
              onContextMenu={(e) => {
                if (!pane) return;
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, pane: pane.id, path: tp });
              }}
            >
              <button
                className="tab-name"
                onClick={() => void open(tp, { pane: pane?.id })}
                onAuxClick={(e) => e.button === 1 && pane && void closeTab(pane.id, tp)}
              >
                <DocIcon icon={iconOf(tp)} />
                {docLabel(tp)}
              </button>
              {tabDirty ? <span className="tab-dirty" aria-label={t("status.unsaved")} /> : null}
              <button
                className="tab-close"
                aria-label={t("tab.closeName", { name: stemOf(tp) })}
                {...tipProps({ label: t("cmd.closeTab"), keys: keyOf("close-tab") })}
                onClick={() => pane && void closeTab(pane.id, tp)}
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
      {/* 좁은 화면은 탭 줄 대신 탭 개수 단추로 열린 탭 목록을 연다(넓은 화면에서는 CSS 가 숨긴다) */}
      <TabCountButton count={pane?.tabs.length ?? 0} onClick={() => pane && setTabSheet(pane.id)} />
    </nav>
  );

  /** 칸마다 똑같이 넘기는 값·동작 */
  const paneCtx: PaneContext = {
    prefs,
    lang,
    local,
    narrow: isNarrow,
    allWorkspaces: allWs,
    wsSwitcher: switcherSpot(isNarrow, prefs.leftOpen) === "crumbs" ? (pane) => wsSwitcher(pane, true) : null,
    resolver,
    resolverRef,
    daily,
    linkCandidates,
    vaultVersion,
    assetVersion,
    iconOf,
    docLabel,
    keyOf,
    open,
    openNode: (node) => void openNode(node),
    load,
    save,
    onEditorBlur: (pane, path) => {
      if (!prefsRef.current.autosave) return;
      // 포커스가 어디로 갔는지는 다음 틱에 안다. 같은 문서를 연 다른 칸의 에디터면 아직 그 문서를 치는 중이라
      // 이탈 저장을 건너뛴다(자동 저장 타이머가 맡는다) — 안 그러면 칸을 옮길 때마다 쓰기가 한 건씩 더 나간다
      // 창 닫기 물음이 포커스를 가져가서 빠진 것이면 저장하지 않는다(「저장하지 않고 닫기」를 고를 수 있다)
      setTimeout(() => {
        if (savesHeld(closeHold.current)) return;
        const elsewhere = panesOf(curLayout()).some((p) => p.id !== pane && p.active === path && paneRefs.current.get(p.id)?.handle.current?.hasFocus());
        if (elsewhere) return;
        void saveRef.current(path, { auto: true });
      }, 0);
    },
    onDraft: (path, draft, key) => updateDocs((s) => setDraft(s, path, draft, key)),
    onChanges: (pane, path, changes, key) => {
      // 같은 문서를 같은 판으로 보고 있는 다른 칸의 에디터에 같은 변경을 넣는다(원본은 저장소 하나, 에디터는 칸마다).
      // 배치(layoutsRef)는 즉시 바뀌고 에디터는 다시 그린 뒤에 바뀌므로, 칸이 아니라 그 칸의 에디터가 어느 문서의 것인지로 고른다
      const ps = panesOf(curLayout());
      const editorKeys = Object.fromEntries(ps.map((p) => [p.id, paneRefs.current.get(p.id)?.handle.current?.docKey ?? null]));
      for (const j of mirrorTargets(pane, path, key, ps, editorKeys))
        paneRefs.current.get(j)?.handle.current?.applyChanges(changes, docsRef.current[path]?.doc.draft ?? "");
    },
    uploadFiles,
    renameNode,
    setIconPick,
    followLinkEl,
    onWidgetChanged,
    showRight,
    toggleRight,
    propsShown,
    rightOpen,
    linkCount,
    setRevision: setPaneRevision,
    saveConflictCopy,
    rollback,
    setMode: (pane, m) => setLayout((l) => setPaneMode(l, pane, m)),
    setCursor: (pane, c) => setCursors((cs) => (cs[pane]?.line === c.line && cs[pane]?.col === c.col ? cs : { ...cs, [pane]: c })),
    setDocMenu,
    dailyStep,
    openDaily: (offset) => void openDaily(offset),
    clearTitleFocus: () => setTitleFocus(null),
    setPendingAnchor,
  };

  const home = (
    <Home
      workspace={allWs ? null : ws}
      wsIcon={allWs ? null : wsIcon(ws)}
      recent={recent.filter((p) => resolver.paths.includes(p) && inScope(p) && !isWorkspaceNote(p))}
      pinned={pinnedShown}
      onOpenNode={(n) => void openNode(n)}
      tabs={allTabs}
      onOpen={(p) => void open(p)}
      onNew={() => void createDoc()}
      onDaily={dailyCfg ? () => void openDaily(0) : null}
      onQuick={() => setPalette("files")}
      onSearch={() => showLeft("search")}
      onMenu={() => setDrawer("left")}
      onManage={() => openSettings("workspaces")}
      hasWorkspace={wsNames.length > 0}
      pendingCount={pendingCount}
      onReview={() => setReviewOpen(true)}
      onTrash={() => setTrashOpen(true)}
      local={local}
      keyOf={keyOf}
    />
  );

  const multi = panes.length > 1 && !isNarrow;
  /**
   * 탭을 끄는 동안 칸 위에 덮는 놓을 자리. 가장자리 네 곳(그쪽에 새 칸)과 가운데(탭 바 포함, 그 칸의 탭으로).
   * 나누면 절반이 최소보다 작아지는 가장자리와, 끌고 있는 탭이 그 칸의 유일한 탭일 때 그 칸의 가장자리는 가운데로 친다
   */
  const renderDropZone = (p: Pane) => {
    if (!tabDrag) return null;
    const zoneAt = (e: ReactDragEvent<HTMLDivElement>): DropZone => {
      const box = e.currentTarget.getBoundingClientRect();
      const bar = (e.currentTarget.parentElement?.querySelector(".tabbar") as HTMLElement | null)?.offsetHeight ?? 0;
      const y = e.clientY - box.top;
      if (y < bar) return "center";
      const lone = tabDrag.pane === p.id && p.tabs.length < 2;
      return dropZone(e.clientX - box.left, y - bar, box.width, box.height - bar, (side) => !lone && canSplitRect(box.width, box.height, side, isNarrow));
    };
    const zone = dropAt?.pane === p.id ? dropAt.zone : null;
    return (
      <div
        className="split-drop"
        aria-hidden
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const z = zoneAt(e);
          if (zone !== z) setDropAt({ pane: p.id, zone: z });
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropAt((d) => (d?.pane === p.id ? null : d))}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(TAB_DRAG);
          const z = zoneAt(e);
          setDropAt(null);
          setTabDrag(null);
          if (!raw) return;
          e.preventDefault();
          const { pane: from, path } = JSON.parse(raw) as { pane: string; path: string };
          setLayout((l) => dropTab(l, from, path, p.id, z));
        }}
      >
        {zone && <div className={`split-drop-hint ${zone}`} />}
      </div>
    );
  };
  const renderPane = (p: Pane, place: CSSProperties | undefined, edges: string, n: number) => {
    const e = p.active ? docs[p.active] : undefined;
    const focused = p.id === layout.focused;
    const r = refsOf(p.id);
    return (
      <section
        key={p.id}
        ref={r.el as RefObject<HTMLElement>}
        tabIndex={-1}
        className={`split-pane${focused ? " focused" : ""}${edges}`}
        aria-label={multi ? t("pane.label", { n }) : undefined}
        style={place}
        onFocusCapture={() => !focused && setLayout((l) => focusPane(l, p.id))}
        onMouseDownCapture={() => !focused && setLayout((l) => focusPane(l, p.id))}
      >
        {renderTabBar(p, isNarrow || n === 1, !edges.includes("edge-t"))}
        {e ? (
          <DocPane
            pane={p.id}
            entry={e}
            mode={p.mode}
            focused={focused}
            revision={revisionOf(p.id)}
            handle={r.handle}
            paneApi={r.api}
            titleFocus={focused && titleFocus?.path === e.doc.path ? titleFocus.n : 0}
            pendingAnchor={focused ? pendingAnchor : null}
            ctx={paneCtx}
          />
        ) : (
          home
        )}
        {!isNarrow && renderDropZone(p)}
      </section>
    );
  };
  /**
   * 칸들은 트리 모양대로 감싸지 않고 한 층에 나란히 두고 비율로 자리만 잡는다(left·top·width·height %).
   * 감싸면 나누거나 닫을 때 칸의 부모 요소가 바뀌어 에디터가 새로 만들어지고 실행 취소 기록·스크롤·커서를 잃는다
   */
  const rects = rectsOf(layout);
  const center = layout.root ? (
    <div className={`split-root${multi ? " multi" : ""}`}>
      {isNarrow
        ? focusedPane && renderPane(focusedPane, undefined, "", 1)
        : panes.map((p, i) => {
            const q = rects[p.id];
            const place = multi ? { left: pct(q.x), top: pct(q.y), width: pct(q.w), height: pct(q.h) } : undefined;
            return renderPane(p, place, `${q.x > 1e-6 ? " edge-l" : ""}${q.y > 1e-6 ? " edge-t" : ""}`, i + 1);
          })}
      {multi &&
        handlesOf(layout).map((h) => (
          <SplitHandleBar
            key={`${h.at.join(".")}:${h.i}`}
            handle={h}
            node={nodeAt(layout.root!, h.at)}
            size={centerSize}
            label={t("pane.resize")}
            onSizes={(sizes) => setLayout((l) => setSizes(l, h.at, sizes))}
          />
        ))}
    </div>
  ) : (
    <>
      {renderTabBar(null, true, true)}
      {home}
    </>
  );

  // 다 붙이면 가운데가 너무 좁아지면(창이 800~1000px 쯤이고 양쪽 패널이 다 열림) 오른쪽 패널을 가운데 위에 띄운다
  const rightFloat =
    !isNarrow &&
    rightOpen &&
    !!doc &&
    rightPanelFloats(viewportWidth, { rail: rl ? 64 : 44, left: prefs.leftOpen ? prefs.leftWidth : 0, right: prefs.rightWidth });
  const sheetPane = isNarrow && tabSheet !== null ? paneOf(layout, tabSheet) : undefined;
  const leftShown = (prefs.leftOpen && !isNarrow) || drawer === "left";

  return (
    <IconLookup.Provider value={iconOf}>
      <div
        className={`shell${prefs.leftOpen ? " left-open" : " left-closed"}${rightOpen && doc && !isNarrow ? " right-open" : ""}${rightFloat ? " right-float" : ""}${drawer ? ` drawer-${drawer}` : ""}${rl ? " rail-labels" : ""}`}
        style={{
          ["--left-w" as string]: `${prefs.leftWidth}px`,
          ["--right-w" as string]: `${prefs.rightWidth}px`,
          ["--title-over" as string]: `${isNarrow ? 0 : titleOver}px`,
        }}
      >
        {drawer && <div className="nav-backdrop" onClick={() => setDrawer(null)} />}
        {rightFloat && <div className="panel-backdrop" onClick={() => setPrefs({ rightOpen: false })} />}
        {sheetPane && (
          <TabSwitcher
            tabs={sheetPane.tabs}
            active={sheetPane.active}
            isDirty={(tp) => !!docs[tp] && docs[tp].doc.draft !== docs[tp].doc.saved}
            label={(tp) => docLabel(tp)}
            icon={iconOf}
            onPick={(tp) => (setTabSheet(null), void open(tp, { pane: tabSheet! }))}
            onCloseTab={(tp) => void closeTab(tabSheet!, tp)}
            onNew={() => (setTabSheet(null), void createDoc())}
            canNew={!!ws || wsNames.length > 0}
            onClose={() => setTabSheet(null)}
          />
        )}
        <div className="left-dock">
          {!isNarrow && <DockTitle open={prefs.leftOpen} label={t("cmd.left")} keys={keyOf("left")} onToggle={toggleLeft} onOverhang={setTitleOver} />}
          {leftShown && dockHead}
          <div className="dock-body">
            {rail}
            {leftShown && leftPanel}
          </div>
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
        <main className="center" ref={centerRef}>
          {center}
        </main>
        {doc && ((rightOpen && !isNarrow) || drawer === "right") && (
          <>
            {rightOpen && !isNarrow && !rightFloat && (
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
        {tabMenu && (
          <Menu
            at={tabMenu}
            label={t("tab.menu")}
            items={[
              { label: t("cmd.closeTab"), icon: X, keys: keyOf("close-tab"), run: () => void closeTab(tabMenu.pane, tabMenu.path) },
              // 나누기: 그 탭을 새 칸에도 연다(원래 칸에도 남는다). 나눈 절반이 최소보다 작아지면 숨긴다
              ...(["right", "bottom"] as const)
                .filter((side) => canSplitPane(tabMenu.pane, side))
                .map((side) => ({
                  label: t(side === "right" ? "cmd.splitRight" : "cmd.splitDown"),
                  icon: side === "right" ? Columns2 : Rows2,
                  run: () => setLayout((l) => splitPane(l, tabMenu.pane, side, tabMenu.path)),
                })),
              // 다른 칸으로: 칸이 하나면 오른쪽으로 나눠 옮긴다(탭이 둘 이상이고 나눌 자리가 있을 때)
              ...(otherPaneOf(layout, tabMenu.pane) || ((paneOf(layout, tabMenu.pane)?.tabs.length ?? 0) > 1 && canSplitPane(tabMenu.pane, "right"))
                ? [
                    {
                      label: t("tab.moveOther"),
                      icon: ArrowRightLeft,
                      keys: tabMenu.pane === layout.focused ? keyOf("move-tab-other") : undefined,
                      run: () =>
                        setLayout((l) => {
                          const other = otherPaneOf(l, tabMenu.pane);
                          return other ? moveTab(l, tabMenu.pane, other, tabMenu.path) : dropTab(l, tabMenu.pane, tabMenu.path, tabMenu.pane, "right");
                        }),
                    },
                  ]
                : []),
              ...(canOpenSolo()
                ? [
                    {
                      label: t("tab.newWindow"),
                      icon: ExternalLink,
                      run: () => void openSolo(tabMenu.path, stemOf(tabMenu.path)).catch(toastError),
                    },
                  ]
                : []),
            ]}
            onClose={() => setTabMenu(null)}
          />
        )}
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
        {trashOpen && (
          <TrashPanel
            folder={scope || undefined}
            resolver={resolver}
            onClose={() => setTrashOpen(false)}
            onChanged={() => {
              vaultChanged();
              void refreshTree();
            }}
            onOpen={(p) => {
              setTrashOpen(false);
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
              replaceSettingsSection(history, sec);
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
                    : palette === "search-folder"
                      ? t("search.folderPick")
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
                    : palette === "search-folder"
                      ? searchFolderItems
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
          next: formatCombo("Mod+G"),
          prev: formatCombo("Mod+Shift+G"),
          replace: formatCombo("Mod+Alt+F"),
        })}
        <br />
        {t("keys.tree")}
        <br />
        {t("keys.other", { mod: formatCombo("Mod") })}
      </p>
    </Modal>
  );
}

/**
 * 파일 보기 「더 보기」 메뉴. rootSort: 워크스페이스 하나를 볼 때 그 바로 아래 노트들의 정렬(모든 워크스페이스 보기면 없음).
 * 「노트 정렬」 은 트리 행의 「하위 노트 정렬」 처럼 같은 자리에 둘째 메뉴로 네 가지를 띄운다
 */
function TreeOptions({
  prefs,
  rootSort,
  onRootSort,
}: {
  prefs: Prefs;
  rootSort?: { sort: ChildSort | undefined; descending: boolean };
  onRootSort: (sort: ChildSort) => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [sortAt, setSortAt] = useState<{ x: number; y: number } | null>(null);
  const items: MenuEntry[] = [
    { label: t("tree.showAttachments"), icon: prefs.treeAttachments === "show" ? Check : undefined, run: () => setPrefs({ treeAttachments: "show" }) },
    { label: t("tree.hideAttachments"), icon: prefs.treeAttachments === "hide" ? Check : undefined, run: () => setPrefs({ treeAttachments: "hide" }) },
    ...(rootSort ? (["-", { label: t("tree.childSortRoot"), run: () => setSortAt(at) }] satisfies MenuEntry[]) : []),
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
      {sortAt && rootSort && (
        <Menu
          at={sortAt}
          label={t("tree.childSortRoot")}
          items={childSortItems(rootSort.sort, rootSort.descending, onRootSort)}
          onClose={() => setSortAt(null)}
        />
      )}
    </>
  );
}

/**
 * 이웃한 두 칸(또는 가지) 사이의 경계 손잡이. 끌거나(포인터), 방향키(Shift 면 크게)로 옮기고, 두 번 누르면 두 쪽을 반반으로.
 * 두 쪽이 각자 가진 최소 크기(minExtent — 안에 나뉜 칸이 있으면 그 합)를 지킨다
 */
function SplitHandleBar({
  handle,
  node,
  size,
  label,
  onSizes,
}: {
  handle: SplitHandle;
  node: LayoutNode;
  size: { w: number; h: number };
  label: string;
  onSizes: (sizes: number[]) => void;
}) {
  const start = useRef<{ at: number; sizes: number[] } | null>(null);
  if (!isSplit(node)) return null;
  const { i, dir } = handle;
  const row = dir === "row";
  /** 그 가지의 px 크기(손잡이가 옮기는 축) */
  const extent = row ? handle.rect.w * size.w : handle.rect.h * size.h;
  const move = (from: number[], px: number) => {
    if (extent <= 0) return;
    const next = dragSizes(from, i, px / extent, minExtent(node.children[i], dir) / extent, minExtent(node.children[i + 1], dir) / extent);
    if (next !== from) onSizes(next);
  };
  const style: CSSProperties = row
    ? { left: `calc(${pct(handle.pos)} - 3px)`, top: pct(handle.rect.y), height: pct(handle.rect.h) }
    : { top: `calc(${pct(handle.pos)} - 3px)`, left: pct(handle.rect.x), width: pct(handle.rect.w) };
  const end = () => {
    start.current = null;
    document.body.classList.remove("resizing", "resizing-row");
  };
  return (
    <div
      className={`split-handle ${dir}`}
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(node.sizes[i] * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      style={style}
      onDoubleClick={() => move(node.sizes, ((node.sizes[i + 1] - node.sizes[i]) / 2) * extent)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === (row ? "ArrowRight" : "ArrowDown")) move(node.sizes, step);
        else if (e.key === (row ? "ArrowLeft" : "ArrowUp")) move(node.sizes, -step);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { at: row ? e.clientX : e.clientY, sizes: node.sizes };
        document.body.classList.add(row ? "resizing" : "resizing-row");
      }}
      onPointerMove={(e) => {
        const st = start.current;
        if (st) move(st.sizes, (row ? e.clientX : e.clientY) - st.at);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}

function Home({
  workspace,
  wsIcon,
  recent,
  pinned,
  onOpenNode,
  tabs,
  onOpen,
  onNew,
  onDaily,
  onQuick,
  onSearch,
  onMenu,
  onManage,
  hasWorkspace,
  pendingCount,
  onReview,
  onTrash,
  local,
  keyOf,
}: {
  workspace: string | null;
  wsIcon: string | null;
  recent: string[];
  /** 고정한 노드(노트 경로가 아니라 노드 경로) */
  pinned: string[];
  onOpenNode: (node: string) => void;
  tabs: string[];
  onOpen: (p: string) => void;
  onNew: () => void;
  onDaily: (() => void) | null;
  onQuick: () => void;
  onSearch: () => void;
  onMenu: () => void;
  onManage: () => void;
  hasWorkspace: boolean;
  pendingCount: number;
  onReview: () => void;
  onTrash: () => void;
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
            <>
              {wsIcon ? (
                <span className="doc-icon" aria-hidden>
                  {wsIcon}
                </span>
              ) : (
                <House size={22} aria-hidden />
              )}{" "}
              {workspace}
            </>
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
        {pinned.length > 0 && (
          <section>
            <h2>{t("home.pinned")}</h2>
            <ul className="home-list">
              {pinned.map((n) => (
                <li key={n}>
                  <button onClick={() => onOpenNode(n)}>
                    <span className="home-doc">{stemOf(n)}</span>
                    <span className="meta">{parentOf(n)}</span>
                    {tabs.includes(`${n}.md`) && <span className="meta"> · {t("home.inTab")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
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
        {hasWorkspace && (
          <button type="button" className="home-trash" onClick={onTrash}>
            <Trash2 size={14} aria-hidden /> {t("tool.trash")}
          </button>
        )}
        {local && <p className="meta">{t("home.localHint")}</p>}
      </div>
    </div>
  );
}
