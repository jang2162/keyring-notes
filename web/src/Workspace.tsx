import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  BrushCleaning,
  CalendarDays,
  ChevronRight,
  Columns2,
  Copy,
  Ellipsis,
  Eye,
  FilePlus,
  Files,
  FolderInput,
  FolderPlus,
  History,
  House,
  Inbox,
  Keyboard,
  Link,
  ListChecks,
  ListTree,
  LocateFixed,
  LogOut,
  Menu as MenuIcon,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Tag,
  Trash2,
  Waypoints,
  ChevronsDownUp,
  X,
} from "lucide-react";
import { api, ApiError, appMode, review, type CommitInfo, type SearchHit, type SourcesInfo, type TreeNode } from "./api";
import { Editor, type EditorHandle, type LinkCandidate } from "./Editor";
import { AdminPanel } from "./Admin";
import { LintPanel, ReviewPanel } from "./Curation";
import { GraphView } from "./Graph";
import { IngestDialog } from "./Ingest";
import { invalidateWidgets, Widget } from "./Widget";
import { isNetworkError, offline } from "./offline";
import { LinkResolver, renderMarkdown } from "./markdown";
import { enhance, invalidateEmbeds } from "./enhance";
import { Palette, type PaletteItem } from "./Palette";
import { applyTemplate, dailyNotePath, headings, merge3, type PropertyStat } from "@keyring-notes/core";
import { loadNoteSettings, saveNoteSettings, type NoteSettings } from "./noteSettings";
import { Properties } from "./Properties";
import { PdfViewer } from "./PdfViewer";
import { localContext } from "./local/boot";
import { SyncPanel, useSyncStatus } from "./Sync";
import { confirmDialog, promptDialog } from "./dialog";
import { mentionTarget, References, UnlinkedMentions } from "./Links";
import { applyTheme, DEFAULT_PREFS, setPrefs, usePrefs, type Prefs } from "./prefs";
import { toast, toastError, Toasts } from "./toast";
import { commandKey, formatCombo, keyCapture, matchCommand, type Command } from "./shortcuts";
import { IconButton, Menu, Resizer, Segmented, type MenuEntry } from "./ui";
import { invalidNameReason, parentOf, stemOf, Tree, type TreeActions, type TreeHandle } from "./Tree";
import { SettingsPage, KeySettings, type SettingsSection } from "./Settings";
import { AsidePreview, FileViewer } from "./Aside";

type ViewMode = "split" | "edit" | "preview";

interface OpenDoc {
  path: string;
  /** 서버에 저장된 내용과 그 해시. 저장할 때 baseHash로 보낸다. */
  saved: string;
  hash: string;
  draft: string;
  /** 에디터를 새 내용으로 다시 만들 때 올린다. */
  seq: number;
  /** 서버가 만드는 문서(위키 index·log): 읽기 전용 */
  generated: boolean;
  /** 연결이 없어 이 기기의 사본을 보여 주는 중 */
  cachedOffline?: boolean;
}

interface Conflict {
  currentHash: string | null;
}

interface RevisionView {
  commit: CommitInfo;
  content: string | null;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "queued" } | { kind: "error"; message: string } | { kind: "conflict" };

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

function folderPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.type !== "dir") continue;
      out.push(n.path);
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

function filesUnder(nodes: TreeNode[], dir: string): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.type === "dir") walk(n.children ?? []);
      else if (n.path.startsWith(dir + "/")) out.push(n.path);
    }
  };
  walk(nodes);
  return out;
}

function conflictCopyPath(path: string, label = "충돌 사본") {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return path.replace(/\.md$/i, ` (${label} ${stamp}).md`);
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** 같은 이름이 있으면 " 2", " 3"… */
function uniquePath(dir: string, stem: string, taken: string[], ext = ".md"): string {
  const set = new Set(taken.map((p) => p.toLowerCase()));
  for (let i = 1; ; i++) {
    const p = join(dir, `${stem}${i > 1 ? ` ${i}` : ""}${ext}`);
    if (!set.has(p.toLowerCase())) return p;
  }
}

function useStored<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
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

function timeAgo(at: number, now: number) {
  const s = Math.round((now - at) / 1000);
  if (s < 5) return "방금";
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** 문서 위 큰 제목 칸: 고치고 Enter나 포커스 이탈 때 파일 이름을 바꾼다 */
function InlineTitle({
  path,
  readOnly,
  focusSignal,
  onFocused,
  onRename,
  onDone,
}: {
  path: string;
  readOnly: boolean;
  focusSignal: number;
  onFocused: () => void;
  onRename: (stem: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const stem = stemOf(path);
  const [v, setV] = useState(stem);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(stem), [stem]);
  useEffect(() => {
    if (!focusSignal) return;
    // 에디터가 열리며 포커스를 가져간 뒤에 잡는다
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
      onFocused();
    }, 30);
    return () => clearTimeout(t);
  }, [focusSignal]);
  const err = v.trim() === stem ? null : invalidNameReason(v);
  const commit = async () => {
    const name = v.trim();
    if (busy || name === stem) return setV(stem);
    if (err) return;
    setBusy(true);
    const ok = await onRename(name);
    setBusy(false);
    if (!ok) setV(stem);
  };
  return (
    <div className="inline-title-wrap">
      <input
        ref={ref}
        className="inline-title"
        value={v}
        readOnly={readOnly}
        aria-label="문서 제목(파일 이름)"
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
            setV(stem);
            onDone();
          }
        }}
      />
      {err && (
        <p className="inline-title-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

export function Workspace({ onLogout }: { onLogout: () => void }) {
  const prefs = usePrefs();
  const local = appMode.local;
  const [tree, setTree] = useState<TreeNode[]>([]);
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
  const [adminOpen, setAdminOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(settingsFromLocation);
  const [keysOpen, setKeysOpen] = useState(false);
  const [aside, setAside] = useState<string | null>(null);
  const [fileView, setFileView] = useState<string | null>(null);
  const [docMenu, setDocMenu] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  /** 제목 칸에 커서를 둘 문서(새 문서·F2). 문서가 열린 뒤 에디터보다 늦게 잡는다 */
  const [titleFocus, setTitleFocus] = useState<{ path: string; n: number } | null>(null);
  const focusTitle = (path: string) => setTitleFocus({ path, n: Date.now() });
  const [now, setNow] = useState(Date.now());
  // 탭: 열린 문서 경로(이 기기에 기억)와, 뒤에 있는 탭의 초안
  const [tabs, setTabs] = useStored<string[]>("keyring:tabs", []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabCache = useRef(new Map<string, OpenDoc>());
  const closedTabs = useRef<string[]>([]);
  const [recent, setRecent] = useStored<string[]>("keyring:recent", []);
  /** 열어 본 문서 기록(뒤로·앞으로) */
  const nav = useRef<{ list: string[]; i: number }>({ list: [], i: -1 });
  const [palette, setPalette] = useState<"files" | "commands" | "templates" | "new-from-template" | "move" | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ path: string; kind: "dir" | "file" } | null>(null);
  const [noteSettings, setNoteSettings] = useState<NoteSettings>(loadNoteSettings);
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

  const live = prefs.live;
  const propsOpen = prefs.props;
  const rightTab = prefs.rightTab;
  const rightOpen = prefs.rightOpen;

  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!propsOpen) return;
    api.properties().then(setPropStats).catch(() => undefined);
  }, [propsOpen, vaultVersion]);

  const resolver = useMemo(() => new LinkResolver(tree), [tree]);

  const linkCandidates = useMemo<LinkCandidate[]>(() => {
    const paths = resolver.paths;
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

  const refreshTree = useCallback(() => api.tree().then(setTree).catch(toastError), []);

  const vaultChanged = useCallback(() => {
    invalidateWidgets();
    invalidateEmbeds();
    setVaultVersion((v) => v + 1);
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
    api.tags().then(setTags).catch(() => undefined);
  }, [vaultVersion]);

  // 검토 대기 수: 볼트가 바뀔 때와 1분마다
  useEffect(() => {
    if (local) return;
    const load = () =>
      review
        .list("pending")
        .then((l) => setPendingCount(l.length))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [vaultVersion]);

  useEffect(() => {
    if (!doc?.path) return setRefs(null);
    api.sources(doc.path).then(setRefs).catch(() => setRefs(null));
  }, [doc?.path, vaultVersion]);

  useEffect(() => {
    api
      .semanticStatus()
      .then((s) => setSemanticOn(s.enabled))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    const semantic = searchMode === "semantic" && !q.startsWith("#");
    const t = setTimeout(
      () => {
        (semantic
          ? api.semantic(q).then((hs) => hs.map((h) => ({ path: h.path, title: h.title, line: 1, snippet: (h.heading ? `${h.heading} · ` : "") + h.snippet, score: h.score })))
          : api.search(q)
        )
          .then(setHits)
          .catch((e) => {
            setHits([]);
            toastError(e);
          });
      },
      semantic ? 400 : 200,
    );
    return () => clearTimeout(t);
  }, [query, vaultVersion, searchMode]);

  const remember = (path: string) => setRecent((r) => [path, ...r.filter((p) => p !== path)].slice(0, 20));

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
        patchDoc(d.path, (prev) => ({ ...prev, saved: content, hash: r.hash }));
        setSaveState({ kind: "saved", at: Date.now() });
        ok = true;
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
            toast("다른 곳에서 바뀐 내용과 자동으로 합쳐 저장했습니다(서로 다른 부분을 고쳤습니다). 이력에서 되돌릴 수 있습니다.", { kind: "info" });
            ok = true;
            vaultChanged();
          } else {
            if (docRef.current?.path === d.path) setConflict({ currentHash: merged?.hash ?? e.currentHash ?? null });
            setSaveState({ kind: "conflict" });
            toast("다른 곳에서 먼저 고친 부분과 겹쳐 저장하지 못했습니다. 자동 저장을 멈췄습니다.", { kind: "warn", duration: 8000 });
          }
        } else {
          const message = e instanceof Error ? e.message : String(e);
          setSaveState({ kind: "error", message });
          // 자동 저장이 잇달아 실패하면 처음 한 번만 알린다(상태 표시줄에는 계속 보인다)
          if (!opts.auto || saveStateRef.current.kind !== "error") toast(`저장하지 못했습니다: ${message}`, { kind: "error", action: { label: "다시 시도", run: () => void save() } });
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
    const t = setTimeout(() => void saveRef.current({ auto: true }), prefs.autosaveDelay);
    return () => clearTimeout(t);
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
   */
  const open = useCallback(
    async (path: string, opts: { newTab?: boolean; noHistory?: boolean } = {}) => {
      if (/\.pdf$/i.test(path)) return setPdfView({ path });
      if (!/\.md$/i.test(path)) return setFileView(path);
      if (settingsFromLocation()) closeSettings(false);
      const cur = docRef.current;
      setDrawer(null);
      if (cur?.path === path) return;
      const keep = tabsRef.current.includes(path) || opts.newTab;
      if (cur) {
        await flush();
        const now = docRef.current;
        if (now && now.path === cur.path) {
          if (keep) tabCache.current.set(now.path, now);
          else if (now.draft !== now.saved && !(await confirmDialog("저장하지 않은 변경이 있습니다. 버리고 이동할까요?", "버리고 이동"))) return;
        }
      }
      setTabs((t) => {
        if (t.includes(path)) return t;
        if (!cur || keep || !t.includes(cur.path)) return [...t, path];
        return t.map((x) => (x === cur.path ? path : x));
      });
      if (!opts.noHistory) pushNav(path);
      showDoc(path);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, prefs.autosave],
  );
  const openRef = useRef(open);
  openRef.current = open;

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
    const now = docRef.current;
    const target = now?.path === path ? now : tabCache.current.get(path);
    if (target && target.draft !== target.saved && !(await confirmDialog(`"${path}"에 저장하지 않은 변경이 있습니다. 버리고 닫을까요?`, "버리고 닫기"))) return;
    tabCache.current.delete(path);
    closedTabs.current = [path, ...closedTabs.current.filter((p) => p !== path)].slice(0, 20);
    const list = tabsRef.current;
    const i = list.indexOf(path);
    const rest = list.filter((p) => p !== path);
    setTabs(rest);
    if (now?.path === path) {
      const next = rest[Math.min(i, rest.length - 1)];
      if (next) showDoc(next);
      else {
        setDoc(null);
        history.replaceState(null, "", "#");
      }
    }
  };

  useEffect(() => {
    void refreshTree();
    const initial = pathFromLocation();
    if (initial) {
      setTabs((t) => (t.includes(initial) ? t : [...t, initial]));
      pushNav(initial);
      void load(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTree, load]);

  useEffect(() => {
    const onHash = () => {
      setSettings(settingsFromLocation());
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
    if (!(rightOpen || drawer === "right") || rightTab !== "history" || !doc) return;
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
            const m =
              e.currentHash && item.baseContent != null ? await saveMerged(item.path, item.baseContent, item.content).catch(() => null) : null;
            if (m) {
              await offline.done(item.path);
              await offline.saveDoc({ path: item.path, content: m.text, hash: m.hash });
              merged.push(item.path);
              continue;
            }
            const copy = conflictCopyPath(item.path, "오프라인 충돌 사본");
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
        `오프라인에서 저장한 ${synced.length + conflicts.length + merged.length}개를 보냈습니다.` +
          (merged.length ? ` 그 사이 서버에서 다른 부분이 바뀐 ${merged.length}개는 자동으로 합쳤습니다.` : "") +
          (conflicts.length ? ` 그 사이 서버에서 바뀐 문서는 덮어쓰지 않고 사본으로 남겼습니다: ${conflicts.join(", ")}` : ""),
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
    const t = setInterval(() => {
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
      clearInterval(t);
    };
  }, [flushOutbox]);

  // 기기 볼트: 동기화로 받은 변경, 다른 편집기에서 고친 파일을 화면에 반영한다
  useEffect(() => {
    if (!localContext) return;
    const onAsset = () => setAssetVersion((v) => v + 1);
    window.addEventListener("keyring:asset-loaded", onAsset);
    const off = localContext.vault.onChange((paths, source) => {
      if (source === "local") return;
      vaultChanged();
      void refreshTree();
      const cur = docRef.current;
      if (cur && paths.includes(cur.path)) {
        if (cur.draft === cur.saved) void load(cur.path);
        else toast(source === "sync" ? "동기화로 이 문서가 바뀌었습니다. 지금 저장하면 충돌이 납니다. 사본으로 저장하거나 새 버전을 불러오세요." : "다른 편집기에서 이 문서가 바뀌었습니다.", { kind: "warn", duration: 0 });
      }
    });
    return () => {
      off();
      window.removeEventListener("keyring:asset-loaded", onAsset);
    };
  }, [vaultChanged, refreshTree, load]);

  /**
   * 붙여넣거나 끌어 놓은 파일을 문서 옆 attachments/ 폴더에 첨부로 올린다(이름이 겹치면 " 2"…).
   * 넣을 링크: 이미지는 ![[이름]], 나머지는 [[이름]]. 같은 이름이 볼트에 또 있으면 전체 경로로.
   */
  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!doc) return [];
    const dir = doc.path.includes("/") ? `${doc.path.slice(0, doc.path.lastIndexOf("/"))}/attachments` : "attachments";
    const taken = new Set(resolver.paths.map((p) => p.toLowerCase()));
    const out: string[] = [];
    for (const f of files) {
      const ext = (/\.[A-Za-z0-9]+$/.exec(f.name)?.[0] ?? (f.type.startsWith("image/") ? `.${f.type.slice(6).replace("jpeg", "jpg").replace(/\+.*/, "")}` : "")).toLowerCase();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      // 클립보드 이미지는 이름이 image.png라 날짜로 바꾼다
      const stem = !f.name || /^image\.\w+$/i.test(f.name) ? `붙여넣은 이미지 ${stamp}` : f.name.replace(/\.[A-Za-z0-9]+$/, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "첨부";
      let path = "";
      for (let i = 1; ; i++) {
        const cand = `${dir}/${stem}${i > 1 ? ` ${i}` : ""}${ext}`;
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
      const target = unique ? name : path;
      out.push(/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path) ? `![[${target}]]` : `[[${target}]]`);
    }
    vaultChanged();
    await refreshTree();
    return out;
  };

  const saveConflictCopy = async () => {
    if (!doc) return;
    const copy = conflictCopyPath(doc.path);
    try {
      await api.write(copy, doc.draft, null);
      vaultChanged();
      await refreshTree();
      await load(doc.path);
      toast(`내 변경은 "${copy}"에 저장했습니다.`, { kind: "success", action: { label: "열기", run: () => void open(copy, { newTab: true }) } });
    } catch (e) {
      toastError(e);
    }
  };

  /** 지금 폴더: 지금 문서의 폴더(없으면 맨 위) */
  const currentFolder = () => (docRef.current ? parentOf(docRef.current.path) : "");

  /** 새 문서: 폴더에 "제목 없음"으로 바로 만들고 제목 칸에 커서를 둔다 */
  const createDoc = async (folder = currentFolder(), content = "") => {
    const path = uniquePath(folder, "제목 없음", resolver.paths);
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

  /** 새 폴더: 이름을 묻고 그 안에 "제목 없음" 문서를 만든다(빈 폴더는 이력에 남지 않는다) */
  const createFolder = async (parent = currentFolder()) => {
    const name = await promptDialog(`새 폴더 이름${parent ? ` (${parent} 안)` : ""}`, "", "만들기");
    if (!name) return;
    const reason = invalidNameReason(name);
    if (reason) return toast(reason, { kind: "error" });
    if (folderPaths(tree).some((p) => p.toLowerCase() === join(parent, name.trim()).toLowerCase())) return toast("같은 이름의 폴더가 이미 있습니다.", { kind: "error" });
    await createDoc(join(parent, name.trim()));
  };

  /** 템플릿 문서 원문(없으면 null) */
  const readTemplate = async (path: string): Promise<string | null> => {
    try {
      return (await api.read(path)).content;
    } catch {
      return null;
    }
  };

  /** 데일리 노트 열기(없으면 템플릿으로 만든다). offset: 0 오늘, -1 어제, 1 내일 */
  const openDaily = async (offset = 0) => {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    const path = dailyNotePath(noteSettings.dailyFolder, noteSettings.dailyFormat, day);
    if (!resolver.paths.includes(path)) {
      const title = path.split("/").pop()!.replace(/\.md$/i, "");
      const tpl = noteSettings.dailyTemplate ? await readTemplate(noteSettings.dailyTemplate) : null;
      try {
        await api.write(path, applyTemplate(tpl ?? "# {{date:YYYY년 M월 D일 dddd}}\n\n", { title, date: day }), null);
        vaultChanged();
        await refreshTree();
      } catch (e) {
        // 그 사이 다른 곳에서 만들었으면 그것을 연다
        if (!(e instanceof ApiError && e.status === 409)) return toastError(e);
      }
    }
    void open(path);
  };

  /** 템플릿 폴더의 문서들 */
  const templatePaths = resolver.paths.filter((p) => {
    const f = noteSettings.templateFolder.replace(/^\/+|\/+$/g, "");
    return /\.md$/i.test(p) && !!f && p.startsWith(f + "/");
  });

  const insertTemplate = async (path: string) => {
    const tpl = await readTemplate(path);
    if (tpl === null || !doc) return;
    const title = doc.path.split("/").pop()!.replace(/\.md$/i, "");
    editorHandle.current?.insertText(applyTemplate(tpl, { title, date: new Date() }));
  };

  /** 템플릿으로 새 문서: 템플릿이 제목을 쓰므로 제목만 묻는다(위치는 지금 폴더) */
  const createFromTemplate = async (tplPath: string) => {
    const tpl = await readTemplate(tplPath);
    if (tpl === null) return;
    const name = await promptDialog("새 문서 제목", "", "만들기");
    if (!name) return;
    const reason = invalidNameReason(name);
    if (reason) return toast(reason, { kind: "error" });
    const path = uniquePath(currentFolder(), name.trim(), resolver.paths);
    try {
      await api.write(path, applyTemplate(tpl, { title: stemOf(path), date: new Date() }), null);
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
        toast("저장하지 못한 변경이 있어 옮기지 않았습니다. 먼저 저장하세요.", { kind: "error" });
        return null;
      }
      return docRef.current!.hash;
    }
    const cached = tabCache.current.get(path);
    if (cached && cached.draft !== cached.saved) {
      toast(`"${stemOf(path)}" 탭에 저장하지 않은 변경이 있습니다. 그 탭을 먼저 저장하세요.`, { kind: "error" });
      return null;
    }
    return (await api.read(path, { fresh: true })).hash;
  };

  /** 이동이 끝난 뒤: 탭·열린 문서·기록의 경로를 바꾼다 */
  const afterMove = async (from: string, to: string, content: string, hash: string) => {
    setTabs((t) => t.map((p) => (p === from ? to : p)));
    setRecent((r) => r.map((p) => (p === from ? to : p)));
    nav.current.list = nav.current.list.map((p) => (p === from ? to : p));
    const cached = tabCache.current.get(from);
    if (cached) {
      tabCache.current.delete(from);
      tabCache.current.set(to, { ...cached, path: to, saved: content, draft: content, hash, seq: cached.seq + 1 });
    }
    const cur = docRef.current;
    if (cur?.path === from) {
      // 내용이 그대로면(상대 링크를 고치지 않았으면) 에디터를 다시 만들지 않는다
      if (cur.draft === content) setDoc({ ...cur, path: to, saved: content, hash });
      else setDoc({ ...cur, path: to, saved: content, draft: content, hash, seq: cur.seq + 1 });
      history.replaceState(null, "", `#/${encodeURIComponent(to)}`);
    }
    if (aside === from) setAside(to);
  };

  /** 문서 하나 옮기기·이름 바꾸기. 이 문서를 가리키던 링크는 서버가 같이 고친다 */
  const moveFile = async (from: string, to: string, opts: { quiet?: boolean; undo?: boolean } = {}): Promise<boolean> => {
    if (from === to) return true;
    if (resolver.paths.some((p) => p.toLowerCase() === to.toLowerCase() && p.toLowerCase() !== from.toLowerCase())) {
      toast(`같은 이름의 문서가 이미 있습니다: ${to}`, { kind: "error" });
      return false;
    }
    const hash = await hashOf(from);
    if (hash === null) return false;
    try {
      const d = await api.move(from, to, hash);
      await afterMove(from, d.path, d.content, d.hash);
      vaultChanged();
      await refreshTree();
      if (!opts.quiet) {
        const others = (d.linksUpdated ?? []).filter((p) => p !== d.path).length;
        const renamed = parentOf(from) === parentOf(d.path);
        toast(
          `${renamed ? `"${stemOf(d.path)}"(으)로 이름을 바꿨습니다` : `${parentOf(d.path) || "맨 위"}(으)로 옮겼습니다`}.` + (d.linkCount ? ` 링크 ${d.linkCount}곳을 고쳤습니다(다른 문서 ${others}개).` : ""),
          { kind: "success", action: opts.undo === false ? undefined : { label: "되돌리기", run: () => void moveFile(d.path, from, { undo: false }) } },
        );
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast("그 사이 문서가 바뀌었습니다. 다시 시도하세요.", { kind: "error" });
      else toastError(e);
      return false;
    }
  };

  /** 폴더 옮기기·이름 바꾸기: 안의 문서를 하나씩 옮긴다(첨부가 있으면 아직 못 옮긴다) */
  const moveFolder = async (from: string, to: string): Promise<boolean> => {
    if (from === to) return true;
    if (folderPaths(tree).some((p) => p.toLowerCase() === to.toLowerCase())) {
      toast(`같은 이름의 폴더가 이미 있습니다: ${to}`, { kind: "error" });
      return false;
    }
    const files = filesUnder(tree, from);
    const attachments = files.filter((p) => !/\.md$/i.test(p));
    if (attachments.length) {
      toast(`폴더에 첨부 파일 ${attachments.length}개가 있어 옮길 수 없습니다(첨부는 아직 옮기기를 지원하지 않습니다).`, { kind: "error" });
      return false;
    }
    let moved = 0;
    for (const f of files) {
      const ok = await moveFile(f, to + f.slice(from.length), { quiet: true });
      if (!ok) break;
      moved++;
    }
    if (moved === files.length) toast(`폴더를 옮겼습니다: ${from} → ${to} (문서 ${moved}개)`, { kind: "success" });
    else toast(`${files.length}개 중 ${moved}개만 옮겼습니다.`, { kind: "error" });
    return moved === files.length;
  };

  const renameDoc = (path: string, stem: string) => moveFile(path, join(parentOf(path), `${stem}.md`));

  const deleteFile = async (path: string) => {
    if (!(await confirmDialog(`"${stemOf(path)}" 문서를 삭제할까요?\n${path}`, "삭제"))) return;
    try {
      const cur = docRef.current;
      const d = cur?.path === path ? { content: cur.draft, hash: cur.hash } : await api.read(path, { fresh: true });
      await api.remove(path, cur?.path === path && cur.draft !== cur.saved ? cur.hash : d.hash);
      vaultChanged();
      await refreshTree();
      tabCache.current.delete(path);
      const rest = tabsRef.current.filter((p) => p !== path);
      setTabs(rest);
      setRecent((r) => r.filter((p) => p !== path));
      if (cur?.path === path) {
        setDoc(null);
        history.replaceState(null, "", "#");
        if (rest.length) showDoc(rest[rest.length - 1]);
      }
      toast(`"${stemOf(path)}"을(를) 삭제했습니다.`, {
        kind: "info",
        action: {
          label: "되돌리기",
          run: () =>
            void api
              .write(path, d.content, null)
              .then(async () => {
                vaultChanged();
                await refreshTree();
                void open(path);
              })
              .catch(toastError),
        },
      });
    } catch (e) {
      toastError(e);
    }
  };

  const duplicateFile = async (path: string) => {
    try {
      const d = await api.read(path);
      const copy = uniquePath(parentOf(path), `${stemOf(path)} 사본`, resolver.paths);
      await api.write(copy, d.content, null);
      vaultChanged();
      await refreshTree();
      void open(copy, { newTab: true });
    } catch (e) {
      toastError(e);
    }
  };

  const copyText = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast(`${what}를 복사했습니다: ${text}`, { kind: "success", duration: 2500 }))
      .catch(() => toast("클립보드에 복사하지 못했습니다.", { kind: "error" }));

  const startMove = (path: string, kind: "dir" | "file") => {
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
    if (dirty && !(await confirmDialog("저장하지 않은 변경을 버리고 이 버전으로 되돌릴까요?", "되돌리기"))) return;
    try {
      await api.rollback(doc.path, revision.commit.rev, doc.hash);
      vaultChanged();
      await load(doc.path);
      toast("이 버전으로 되돌렸습니다.", { kind: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast("그 사이 문서가 바뀌었습니다. 다시 불러온 뒤 시도하세요.", { kind: "error" });
      else toastError(e);
    }
  };

  /** 위젯에서 문서를 바꿨을 때: 지금 연 문서면(저장 안 한 변경이 없을 때) 다시 불러온다. */
  const onWidgetChanged = (path: string) => {
    setVaultVersion((v) => v + 1);
    if (doc?.path === path) {
      if (doc.draft === doc.saved) void load(path);
      else toast("위젯에서 이 문서를 바꿨습니다. 지금 저장하면 충돌이 납니다. 사본으로 저장하거나 서버 버전을 불러오세요.", { kind: "warn", duration: 0 });
    }
  };

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

  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
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
    const target = a.dataset.wikilink!;
    const anchor = a.dataset.block ? { block: a.dataset.block } : a.dataset.heading ? { heading: a.dataset.heading } : null;
    if (a.dataset.resolved === "1") followLink(target, anchor, e.ctrlKey || e.metaKey, a.dataset.heading);
    else {
      void confirmDialog(`"${target}" 문서가 없습니다. 새로 만들까요?`, "만들기").then((yes) => {
        if (!yes) return;
        const path = /\.md$/i.test(target) ? target : `${target}.md`;
        api
          .write(path, "", null)
          .then(refreshTree)
          .then(() => open(path))
          .catch(toastError);
      });
    }
  };

  /** [[문서#제목]]·[[문서#^블록]]: 그 위치로 스크롤하고 잠깐 표시한다 */
  const scrollToAnchor = (anchor: { heading?: string; block?: string }) => {
    const root = previewRef.current;
    if (!root) return;
    const el = anchor.block
      ? root.querySelector<HTMLElement>(`[data-block="${CSS.escape(anchor.block)}"]`)
      : root.querySelector<HTMLElement>(`[data-heading="${CSS.escape(anchor.heading ?? "")}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.classList.add("anchor-flash");
    setTimeout(() => el.classList.remove("anchor-flash"), 1600);
  };

  const previewSource = revision ? (revision.content ?? "") : (doc?.draft ?? "");
  const rendered = useMemo(
    // 속성 화면이 열려 있으면 미리보기에서는 프런트매터 상자를 빼고 본다(같은 내용을 두 번 보이지 않게)
    () => (doc ? renderMarkdown(previewSource, { resolver, docPath: doc.path, hideFrontmatter: propsOpen && !revision }) : { html: "", widgets: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewSource, resolver, doc?.path, assetVersion, propsOpen, revision],
  );

  // ── 패널
  const toggleLeft = () => {
    if (narrow()) return setDrawer((d) => (d === "left" ? null : "left"));
    setPrefs((p) => ({ leftOpen: !p.leftOpen }));
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
    history.pushState(null, "", `${SETTINGS_HASH}/${s}`);
    setSettings(s);
  };
  /** restore: 지금 문서 주소로 되돌린다(아니면 곧 다른 문서를 여는 중이라 비워 둔다) */
  const closeSettings = (restore = true) => {
    setSettings(null);
    const cur = docRef.current;
    history.replaceState(null, "", restore && cur ? `#/${encodeURIComponent(cur.path)}` : "#");
  };

  const toggleMode = () => setMode((m) => (m === "preview" ? "edit" : "preview"));

  // ── 명령: 팔레트·단축키·설정의 단축키 목록이 같이 쓴다
  const commands: Command[] = [
    { id: "quick-open", group: "탐색", label: "문서 빠르게 열기", keys: "Mod+O", run: () => setPalette("files") },
    { id: "palette", group: "탐색", label: "명령 팔레트", keys: "Mod+P", run: () => setPalette("commands") },
    { id: "palette-2", group: "탐색", label: "명령 팔레트(다른 키)", keys: "Mod+Shift+P", run: () => setPalette("commands"), hidden: true },
    { id: "search", group: "탐색", label: "볼트 검색", keys: "Mod+Shift+F", run: () => (setPrefs({ leftOpen: true, leftView: "search" }), narrow() && setDrawer("left"), setTimeout(() => searchInput.current?.focus(), 0)) },
    { id: "back", group: "탐색", label: "뒤로(열어 본 문서)", keys: "Mod+Alt+ArrowLeft", run: () => goNav(-1) },
    { id: "forward", group: "탐색", label: "앞으로(열어 본 문서)", keys: "Mod+Alt+ArrowRight", run: () => goNav(1) },
    { id: "home", group: "탐색", label: "홈", run: () => void (async () => { await flush(); if (docRef.current) tabCache.current.set(docRef.current.path, docRef.current); setDoc(null); closeSettings(false); history.replaceState(null, "", "#"); })() },
    { id: "new", group: "문서", label: "새 문서", keys: "Mod+N", webKeys: "Alt+N", run: () => void createDoc() },
    { id: "new-folder", group: "문서", label: "새 폴더", run: () => void createFolder() },
    { id: "daily", group: "문서", label: "오늘 노트", keys: "Mod+Shift+D", run: () => void openDaily(0) },
    { id: "daily-prev", group: "문서", label: "어제 노트", run: () => void openDaily(-1) },
    { id: "daily-next", group: "문서", label: "내일 노트", run: () => void openDaily(1) },
    { id: "tpl-new", group: "문서", label: "템플릿으로 새 문서", run: () => setPalette("new-from-template") },
    ...(doc && !doc.generated
      ? [
          { id: "tpl-insert", group: "문서", label: "템플릿 넣기", run: () => setPalette("templates") },
          { id: "save", group: "문서", label: "지금 저장", keys: "Mod+S", run: () => void save() },
          { id: "rename", group: "문서", label: "이름 바꾸기", keys: "F2", inInputs: false, run: () => focusTitle(doc.path) },
          { id: "move", group: "문서", label: "다른 폴더로 옮기기…", run: () => startMove(doc.path, "file") },
          { id: "duplicate", group: "문서", label: "복제", run: () => void duplicateFile(doc.path) },
          { id: "delete", group: "문서", label: "삭제", run: () => void deleteFile(doc.path) },
        ]
      : []),
    ...(doc
      ? [
          { id: "copy-path", group: "문서", label: "경로 복사", run: () => void copyText(doc.path, "경로") },
          { id: "copy-link", group: "문서", label: "링크 복사", run: () => void copyText(`[[${mentionTarget(doc.path, resolver)}]]`, "링크") },
          { id: "reveal", group: "탐색", label: "트리에서 지금 문서 찾기", run: () => (setPrefs({ leftOpen: true, leftView: "files" }), setTimeout(() => treeRef.current?.reveal(), 0)) },
        ]
      : []),
    { id: "close-tab", group: "탭", label: "탭 닫기", keys: "Mod+W", webKeys: "Alt+W", run: () => doc && void closeTab(doc.path) },
    { id: "reopen-tab", group: "탭", label: "닫은 탭 다시 열기", keys: "Mod+Shift+T", webKeys: "Alt+Shift+T", run: () => closedTabs.current[0] && void open(closedTabs.current.shift()!, { newTab: true }) },
    { id: "next-tab", group: "탭", label: "다음 탭", keys: "Ctrl+Tab", webKeys: "Alt+]", run: () => cycleTab(1) },
    { id: "prev-tab", group: "탭", label: "이전 탭", keys: "Ctrl+Shift+Tab", webKeys: "Alt+[", run: () => cycleTab(-1) },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `tab-${i + 1}`,
      group: "탭",
      label: `${i + 1}번째 탭`,
      keys: `Mod+${i + 1}`,
      webKeys: `Alt+${i + 1}`,
      hidden: true,
      run: () => {
        const t = tabsRef.current;
        const p = i === 8 ? t[t.length - 1] : t[i];
        if (p) void open(p);
      },
    })),
    { id: "toggle-mode", group: "보기", label: "편집 ↔ 미리보기", keys: "Mod+E", run: toggleMode },
    { id: "mode-edit", group: "보기", label: "보기: 편집", run: () => setMode("edit") },
    { id: "mode-split", group: "보기", label: "보기: 원문과 미리보기 나란히", run: () => setMode("split") },
    { id: "mode-preview", group: "보기", label: "보기: 미리보기", run: () => setMode("preview") },
    { id: "aside", group: "보기", label: aside ? "옆 칸 닫기" : "옆 칸에 미리보기 띄우기", keys: "Mod+\\", run: () => setAside((a) => (a ? null : (doc?.path ?? null))) },
    { id: "left", group: "보기", label: "왼쪽 패널 접기·펴기", keys: "Mod+Alt+[", run: toggleLeft },
    { id: "right", group: "보기", label: "오른쪽 패널 접기·펴기", keys: "Mod+Alt+]", run: () => toggleRight() },
    { id: "outline", group: "보기", label: "개요", run: () => toggleRight("outline") },
    { id: "links", group: "보기", label: "백링크·출처", run: () => toggleRight("links") },
    { id: "history", group: "보기", label: "변경 이력", run: () => toggleRight("history") },
    { id: "live", group: "보기", label: live ? "Live Preview 끄기" : "Live Preview 켜기", run: () => setPrefs({ live: !live }) },
    { id: "props", group: "보기", label: propsOpen ? "속성 칸 닫기" : "속성 칸 열기", run: () => setPrefs({ props: !propsOpen }) },
    { id: "lines", group: "보기", label: prefs.lineNumbers ? "줄 번호 끄기" : "줄 번호 켜기", run: () => setPrefs({ lineNumbers: !prefs.lineNumbers }) },
    { id: "width", group: "보기", label: prefs.readableWidth ? "넓게 보기" : "읽기 폭으로 보기", run: () => setPrefs({ readableWidth: !prefs.readableWidth }) },
    { id: "theme", group: "보기", label: "테마 바꾸기(시스템 → 밝게 → 어둡게)", run: () => setPrefs((p) => ({ theme: p.theme === "system" ? "light" : p.theme === "light" ? "dark" : "system" })) },
    { id: "graph", group: "도구", label: "그래프 뷰", run: () => setGraphOpen(true) },
    { id: "lint", group: "도구", label: "정리 점검", run: () => setLintOpen(true) },
    ...(local
      ? [{ id: "sync", group: "도구", label: "이 기기·동기화", run: () => setSyncOpen(true) }]
      : [
          { id: "ingest", group: "도구", label: "원본 수집", run: () => setIngestOpen(true) },
          { id: "review", group: "도구", label: "변경 검토", run: () => setReviewOpen(true) },
          { id: "admin", group: "도구", label: "관리 콘솔", run: () => setAdminOpen(true) },
        ]),
    { id: "settings", group: "도구", label: "설정", keys: "Mod+,", run: () => openSettings() },
    { id: "keys", group: "도구", label: "단축키 목록", keys: "Mod+/", run: () => setKeysOpen(true) },
  ];
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const keyOf = (id: string) => {
    const c = commands.find((x) => x.id === id);
    return c ? commandKey(c, prefs.keys) : undefined;
  };

  function cycleTab(dir: number) {
    const t = tabsRef.current;
    if (t.length < 2 || !docRef.current) return;
    const i = t.indexOf(docRef.current.path);
    void open(t[(i + dir + t.length) % t.length]);
  }

  // 단축키: 에디터보다 먼저 받는다(Mod+S 등은 에디터 키맵과 같은 동작)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyCapture.active || e.defaultPrevented) return;
      // 대화상자(확인·입력·팔레트) 안에서는 Mod 조합만
      const c = matchCommand(e, commandsRef.current, prefsRef.current.keys);
      if (!c) return;
      if ((e.target as HTMLElement).closest?.(".modal-backdrop") && !/^(palette|quick-open)/.test(c.id)) return;
      e.preventDefault();
      e.stopPropagation();
      c.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // 빠른 전환: 열린 탭, 최근 문서를 먼저
  const fileItems = useMemo<PaletteItem[]>(() => {
    const docs = resolver.paths.filter((p) => /\.md$/i.test(p));
    const order = (p: string) => (tabs.includes(p) ? 0 : recent.includes(p) ? 1 + recent.indexOf(p) / 100 : 2);
    return docs
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b, "ko"))
      .map((p) => ({
        id: p,
        label: stemOf(p),
        detail: p.includes("/") ? parentOf(p) : undefined,
        run: (alt: boolean) => void open(p, { newTab: alt }),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver, tabs, recent]);

  const commandItems: PaletteItem[] = commands
    .filter((c) => !c.hidden)
    .map((c) => ({ id: c.id, label: c.label, detail: formatCombo(commandKey(c, prefs.keys)) || undefined, run: () => c.run() }));

  const moveItems: PaletteItem[] = useMemo(() => {
    if (!moveTarget) return [];
    const { path, kind } = moveTarget;
    const here = parentOf(path);
    return ["", ...folderPaths(tree)]
      .filter((f) => f !== here && !(kind === "dir" && (f === path || f.startsWith(path + "/"))))
      .map((f) => ({
        id: f || "/",
        label: f || "(맨 위)",
        run: () => void (kind === "dir" ? moveFolder(path, join(f, path.split("/").pop()!)) : moveFile(path, join(f, path.split("/").pop()!))),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveTarget, tree]);

  const outline = useMemo(() => (doc && ((rightOpen && !isNarrow) || drawer === "right") && rightTab === "outline" ? headings(doc.draft) : []), [rightOpen, drawer, rightTab, doc?.draft]);

  // 수식·다이어그램·문서 임베드는 그린 뒤에 채운다(enhance.ts)
  useEffect(() => {
    if (!previewRef.current || !doc) return;
    return enhance(previewRef.current, { resolver, docPath: doc.path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, mode]);

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
    open: (p, o) => void open(p, o),
    openAttachment: (p) => (/\.pdf$/i.test(p) ? setPdfView({ path: p }) : setFileView(p)),
    newDoc: (f) => void createDoc(f),
    newFolder: (f) => void createFolder(f),
    rename: (p, kind, name) => (kind === "dir" ? moveFolder(p, join(parentOf(p), name)) : renameDoc(p, name)),
    move: (p, kind, folder) => void (kind === "dir" ? moveFolder(p, join(folder, p.split("/").pop()!)) : moveFile(p, join(folder, p.split("/").pop()!))),
    moveTo: startMove,
    duplicate: (p) => void duplicateFile(p),
    remove: (p) => void deleteFile(p),
    copyPath: (p) => void copyText(p, "경로"),
    copyLink: (p) => void copyText(/\.md$/i.test(p) ? `[[${mentionTarget(p, resolver)}]]` : `[[${p.split("/").pop()}]]`, "링크"),
    openAside: (p) => setAside(p),
  };

  const words = useMemo(() => {
    const t = doc?.draft ?? "";
    return { chars: t.replace(/\s/g, "").length, words: (t.match(/\S+/g) ?? []).length };
  }, [doc?.draft]);

  const linkCount = refs ? refs.linkedBy.length + refs.sources.length + refs.citedBy.length : 0;

  // ── 화면 조각
  const rail = (
    <nav className="rail" aria-label="도구">
      <div className="rail-top">
        <IconButton icon={Files} label="파일" active={prefs.leftOpen && prefs.leftView === "files"} onClick={() => showLeft("files")} />
        <IconButton icon={Search} label="검색" keys={keyOf("search")} active={prefs.leftOpen && prefs.leftView === "search"} onClick={() => showLeft("search")} />
        <IconButton icon={Tag} label="태그" active={prefs.leftOpen && prefs.leftView === "tags"} onClick={() => showLeft("tags")} />
        <span className="rail-sep" />
        <IconButton icon={CalendarDays} label="오늘 노트" keys={keyOf("daily")} onClick={() => void openDaily(0)} />
        <IconButton icon={Waypoints} label="그래프 뷰" onClick={() => setGraphOpen(true)} />
        {!local && <IconButton icon={Inbox} label="원본 수집(파일·URL·붙여넣기)" onClick={() => setIngestOpen(true)} />}
        {!local && <IconButton icon={ListChecks} label={`변경 검토(에이전트 제안)${pendingCount ? ` · 대기 ${pendingCount}` : ""}`} badge={pendingCount} onClick={() => setReviewOpen(true)} />}
        <IconButton icon={BrushCleaning} label="정리 점검(깨진 링크·고아·출처 없음…)" onClick={() => setLintOpen(true)} />
      </div>
      <div className="rail-bottom">
        {local && (
          <IconButton
            icon={RefreshCw}
            label={syncStatus?.settings ? `동기화: ${syncStatus.settings.server}` : "이 기기 · 서버 동기화(선택)"}
            className={`sync-button${syncStatus?.running ? " running" : ""}${syncStatus?.lastError ? " has-error" : ""}`}
            onClick={() => setSyncOpen(true)}
          />
        )}
        <IconButton icon={Keyboard} label="단축키 목록" keys={keyOf("keys")} onClick={() => setKeysOpen(true)} />
        <IconButton icon={SettingsIcon} label="설정" keys={keyOf("settings")} active={!!settings} onClick={() => (settings ? closeSettings() : openSettings())} />
        {!local && (
          <IconButton
            icon={LogOut}
            label="로그아웃"
            onClick={async () => {
              await flush();
              const d = docRef.current;
              if (!d || d.draft === d.saved || (await confirmDialog("저장하지 않은 변경이 있습니다. 로그아웃할까요?", "로그아웃"))) onLogout();
            }}
          />
        )}
      </div>
    </nav>
  );

  const leftPanel = (
    <aside className="left-panel" aria-label={{ files: "파일", search: "검색", tags: "태그" }[prefs.leftView]}>
      {prefs.leftView === "files" && (
        <>
          <div className="panel-head">
            <strong>파일</strong>
            <span className="panel-tools">
              <IconButton size={16} icon={FilePlus} label="새 문서" keys={keyOf("new")} onClick={() => void createDoc()} />
              <IconButton size={16} icon={FolderPlus} label="새 폴더" onClick={() => void createFolder()} />
              <IconButton size={16} icon={LocateFixed} label="지금 문서 찾기" disabled={!doc} onClick={() => treeRef.current?.reveal()} />
              <IconButton size={16} icon={ChevronsDownUp} label="모두 접기" onClick={() => treeRef.current?.collapseAll()} />
              <TreeOptions prefs={prefs} />
            </span>
          </div>
          <Tree ref={treeRef} nodes={tree} current={doc?.path ?? null} prefs={prefs} actions={treeActions} />
        </>
      )}
      {prefs.leftView === "search" && (
        <>
          <div className="panel-head">
            <strong>검색</strong>
          </div>
          <div className="search-box">
            <input
              ref={searchInput}
              type="search"
              placeholder="검색 (#태그)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              aria-label="볼트 검색"
            />
            {semanticOn && (
              <button className={`search-mode${searchMode === "semantic" ? " on" : ""}`} title="의미 검색: 단어가 달라도 뜻이 가까운 문서" onClick={() => setSearchMode((m) => (m === "text" ? "semantic" : "text"))}>
                의미
              </button>
            )}
          </div>
          {hits === null ? (
            <p className="meta panel-note">단어를 입력하세요. #태그로 태그 검색, 결과를 누르면 그 줄로 갑니다.</p>
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
                      {h.title} {h.score !== undefined && <span className="hit-score">{h.score.toFixed(2)}</span>}
                    </span>
                    <span className="hit-path">
                      {h.path}
                      {h.line > 1 ? ` · ${h.line}줄` : ""}
                    </span>
                    {h.snippet && <span className="hit-snippet">{h.snippet}</span>}
                  </a>
                </li>
              ))}
              {hits.length === 0 && <li className="meta">결과가 없습니다.</li>}
            </ul>
          )}
        </>
      )}
      {prefs.leftView === "tags" && (
        <>
          <div className="panel-head">
            <strong>태그 {tags.length}</strong>
          </div>
          <div className="tag-cloud">
            {tags.map((t) => (
              <button
                key={t.tag}
                className="tag"
                onClick={() => {
                  setQuery(`#${t.tag}`);
                  showLeft("search");
                }}
              >
                #{t.tag} <span className="count">{t.count}</span>
              </button>
            ))}
            {tags.length === 0 && <p className="meta">태그가 없습니다. 본문에 #태그나 프런트매터 tags를 쓰면 여기 모입니다.</p>}
          </div>
        </>
      )}
    </aside>
  );

  const rightPanel = doc && (
    <aside className="right-panel" aria-label="문서 정보">
      <div className="panel-head">
        <Segmented
          label="오른쪽 패널"
          value={rightTab}
          onChange={(v) => setPrefs({ rightTab: v })}
          options={[
            { value: "outline", label: "개요" },
            { value: "links", label: `연결${linkCount ? ` ${linkCount}` : ""}`, title: "백링크·출처·연결되지 않은 언급" },
            { value: "history", label: "이력" },
          ]}
        />
        <IconButton size={16} icon={X} label="오른쪽 패널 닫기" keys={keyOf("right")} onClick={() => (narrow() ? setDrawer(null) : setPrefs({ rightOpen: false }))} />
      </div>
      <div className="panel-body">
        {rightTab === "outline" && (
          <ol className="outline-list">
            {outline.map((h) => (
              <li key={h.line} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
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
            {outline.length === 0 && <li className="meta">제목(#)이 없습니다.</li>}
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
              <p className="meta">불러오는 중…</p>
            )}
            {!doc.generated && (
              <section className="backlinks mentions-wrap">
                <UnlinkedMentions path={doc.path} target={mentionTarget(doc.path, resolver)} version={vaultVersion} onOpen={(p) => void open(p)} onChanged={vaultChanged} />
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
                    {c.author} · {new Date(c.date).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
            {commits.length === 0 && <li className="meta">이력이 없습니다.</li>}
          </ol>
        )}
      </div>
    </aside>
  );

  const docMenuItems: MenuEntry[] = doc
    ? [
        { label: "지금 저장", icon: Pencil, keys: keyOf("save"), disabled: !dirty || doc.generated, run: () => void save() },
        { label: "이름 바꾸기", keys: keyOf("rename"), disabled: doc.generated, run: () => focusTitle(doc.path) },
        { label: "다른 폴더로 옮기기…", icon: FolderInput, disabled: doc.generated, run: () => startMove(doc.path, "file") },
        { label: "복제", icon: Copy, run: () => void duplicateFile(doc.path) },
        "-",
        { label: "옆 칸에 미리보기 띄우기", icon: Columns2, keys: keyOf("aside"), run: () => setAside(doc.path) },
        { label: "원문과 미리보기 나란히", run: () => setMode("split") },
        { label: "트리에서 찾기", icon: LocateFixed, run: () => (setPrefs({ leftOpen: true, leftView: "files" }), setTimeout(() => treeRef.current?.reveal(), 0)) },
        "-",
        { label: "경로 복사", run: () => void copyText(doc.path, "경로") },
        { label: "링크 복사", icon: Link, run: () => void copyText(`[[${mentionTarget(doc.path, resolver)}]]`, "링크") },
        { label: "변경 이력", icon: History, run: () => toggleRight("history") },
        "-",
        { label: "삭제", icon: Trash2, danger: true, disabled: doc.generated, run: () => void deleteFile(doc.path) },
      ]
    : [];

  const crumbs = doc ? doc.path.split("/").slice(0, -1) : [];

  const saveLabel = (() => {
    if (!doc || doc.generated) return null;
    if (conflict || saveState.kind === "conflict") return { cls: "warn", text: "충돌 — 저장 멈춤" };
    if (saveState.kind === "saving") return { cls: "", text: "저장 중…" };
    if (saveState.kind === "error" && dirty) return { cls: "error", text: "저장 못 함" };
    if (dirty) return { cls: "dirty", text: prefs.autosave ? "고치는 중" : "저장 안 함" };
    if (saveState.kind === "queued" || doc.cachedOffline) return { cls: "warn", text: "이 기기에 저장됨" };
    if (saveState.kind === "saved") return { cls: "ok", text: `저장됨 · ${timeAgo(saveState.at, now)}` };
    return { cls: "ok", text: "저장됨" };
  })();

  const statusBar = (
    <footer className="statusbar" aria-label="상태">
      {saveLabel && (
        <button
          className={`status-item save-status ${saveLabel.cls}`}
          title={saveState.kind === "error" ? `${saveState.message} — 눌러서 다시 저장` : prefs.autosave ? "자동 저장 켜짐 · 눌러서 지금 저장" : "자동 저장 꺼짐 · 눌러서 저장"}
          onClick={() => void save()}
        >
          <span className="dot" aria-hidden /> {saveLabel.text}
        </button>
      )}
      {!local && !online && <span className="status-item warn">오프라인{outboxCount ? ` · 보낼 변경 ${outboxCount}` : ""}</span>}
      {!local && online && outboxCount > 0 && (
        <button className="status-item warn" onClick={() => void flushOutbox()} title="오프라인에서 저장한 변경을 지금 서버로 보냅니다">
          보낼 변경 {outboxCount} · 지금 보내기
        </button>
      )}
      {local && syncStatus?.settings && (
        <button className={`status-item${syncStatus.lastError ? " error" : ""}`} onClick={() => setSyncOpen(true)} title={syncStatus.lastError ?? `동기화: ${syncStatus.settings.server}`}>
          {syncStatus.running ? "동기화 중…" : syncStatus.lastError ? "동기화 실패" : syncStatus.lastSync ? `동기화 ${timeAgo(new Date(syncStatus.lastSync).getTime(), now)}` : "동기화 대기"}
        </button>
      )}
      {!local && pendingCount > 0 && (
        <button className="status-item" onClick={() => setReviewOpen(true)}>
          검토 대기 {pendingCount}
        </button>
      )}
      <span className="status-spacer" />
      {doc && (
        <>
          <span className="status-item muted" title={`단어 ${words.words}`}>
            {words.chars.toLocaleString()}자
          </span>
          {mode !== "preview" && !revision && (
            <span className="status-item muted">
              {cursor.line}:{cursor.col}
            </span>
          )}
          <button className={`status-item${live ? "" : " muted"}`} onClick={() => setPrefs({ live: !live })} title="편집 중 렌더링: 커서가 없는 줄은 기호를 숨깁니다">
            Live Preview {live ? "켬" : "끔"}
          </button>
        </>
      )}
    </footer>
  );

  const tabBar = (
    <nav className="tabbar" aria-label="열린 문서">
      <IconButton className="nav-toggle" icon={MenuIcon} label="문서 목록" onClick={() => setDrawer((d) => (d === "left" ? null : "left"))} size={18} />
      <div className="tab-list" role="tablist">
        {tabs.map((t) => {
          const cached = t === doc?.path ? doc : tabCache.current.get(t);
          const isDirty = !!cached && cached.draft !== cached.saved;
          return (
            <span key={t} className={`tab${t === doc?.path ? " on" : ""}`} title={t} role="tab" aria-selected={t === doc?.path}>
              <button className="tab-name" onClick={() => void open(t)} onAuxClick={(e) => e.button === 1 && void closeTab(t)}>
                {stemOf(t)}
              </button>
              {isDirty ? (
                <span className="tab-dirty" aria-label="저장 안 함" title="저장 안 함" />
              ) : null}
              <button className="tab-close" aria-label={`${stemOf(t)} 닫기`} title={`닫기 (${formatCombo(keyOf("close-tab"))})`} onClick={() => void closeTab(t)}>
                <X size={13} />
              </button>
            </span>
          );
        })}
      </div>
      <IconButton className="tab-new" icon={FilePlus} label="새 문서" keys={keyOf("new")} onClick={() => void createDoc()} size={16} />
    </nav>
  );

  const center = doc ? (
    <>
      <header className="doc-head">
        <nav className="crumbs" aria-label="경로">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              <button
                className="crumb-btn"
                onClick={() => {
                  setPrefs({ leftOpen: true, leftView: "files" });
                  setTimeout(() => treeRef.current?.reveal(), 0);
                }}
              >
                {c}
              </button>
              <ChevronRight size={12} aria-hidden />
            </span>
          ))}
          <span className="crumb current">{stemOf(doc.path)}</span>
        </nav>
        <div className="doc-tools">
          <Segmented
            label="보기"
            value={revision ? "preview" : mode}
            onChange={(m) => setMode(m)}
            options={[
              { value: "edit", label: <Pencil size={15} aria-label="편집" />, title: `편집 (${formatCombo(keyOf("toggle-mode"))})` },
              { value: "split", label: <Columns2 size={15} aria-label="나란히" />, title: "원문과 미리보기 나란히" },
              { value: "preview", label: <Eye size={15} aria-label="미리보기" />, title: `미리보기 (${formatCombo(keyOf("toggle-mode"))})` },
            ]}
          />
          <IconButton icon={SlidersHorizontal} label="속성 칸" active={propsOpen} onClick={() => setPrefs({ props: !propsOpen })} size={16} />
          <IconButton icon={ListTree} label="개요·백링크·이력" keys={keyOf("right")} active={rightOpen} badge={!rightOpen && linkCount ? linkCount : undefined} onClick={() => toggleRight()} size={16} />
          <IconButton
            icon={Ellipsis}
            label="문서 메뉴"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setDocMenu({ x: r.right - 220, y: r.bottom + 4 });
            }}
            size={16}
          />
        </div>
      </header>

      {doc.cachedOffline && <div className="banner info">연결이 없어 이 기기에 남은 사본을 보여 줍니다.</div>}
      {doc.generated && <div className="banner generated">{local ? "앱이" : "서버가"} 자동으로 만드는 문서입니다(위키 목차·작업 기록). 직접 고칠 수 없고, 위키가 바뀌면 다시 만들어집니다.</div>}
      {conflict && (
        <div className="banner conflict" role="alert">
          {conflict.currentHash === null
            ? "이 문서는 다른 곳에서 삭제되었습니다."
            : local
              ? "이 문서는 다른 곳(동기화·다른 편집기)에서 먼저 수정되었습니다. 덮어쓰지 않았고, 자동 저장을 멈췄습니다."
              : "이 문서는 다른 곳(다른 탭이나 에이전트)에서 먼저 같은 부분이 수정되었습니다. 덮어쓰지 않았고, 자동 저장을 멈췄습니다."}
          <button onClick={saveConflictCopy}>내 변경을 사본으로 저장</button>
          {conflict.currentHash !== null && (
            <button onClick={async () => (await confirmDialog(`내 변경을 버리고 ${local ? "저장된" : "서버"} 버전을 불러올까요?`, "불러오기")) && load(doc.path)}>{local ? "저장된 버전 불러오기" : "서버 버전 불러오기"}</button>
          )}
        </div>
      )}
      {revision && (
        <div className="banner revision">
          {revision.commit.rev.slice(0, 7)} · {revision.commit.author} · {new Date(revision.commit.date).toLocaleString()} 버전을 보는 중
          {revision.content !== null && <button onClick={rollback}>이 버전으로 되돌리기</button>}
          <button onClick={() => setRevision(null)}>닫기</button>
        </div>
      )}

      <div className="doc-area">
        <div className={`panes mode-${revision ? "preview" : mode}${prefs.readableWidth ? " readable" : ""} font-${prefs.editorFont}`} style={{ ["--editor-size" as string]: `${prefs.editorSize}px` }}>
          <div className="pane edit-pane">
            <div className="page">
              <InlineTitle path={doc.path} readOnly={doc.generated || !!revision} focusSignal={titleFocus?.path === doc.path ? titleFocus.n : 0}
                onFocused={() => setTitleFocus(null)} onRename={(stem) => renameDoc(doc.path, stem)} onDone={() => editorHandle.current?.focus()} />
              {propsOpen && !revision && <Properties content={doc.draft} stats={propStats} readOnly={doc.generated} onChange={(next) => editorHandle.current?.setContent(next)} />}
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
                foldFrontmatter={propsOpen && !revision}
                readOnly={doc.generated}
                onCursor={(line, col) => setCursor({ line, col })}
                onBlur={() => prefs.autosave && void saveRef.current({ auto: true })}
              />
            </div>
          </div>
          <div className="pane preview-pane" onClick={onPreviewClick}>
            <div className="page">
              {(mode === "preview" || revision) && <h1 className="inline-title static">{stemOf(doc.path)}</h1>}
              <div className="markdown-body" ref={previewRef} dangerouslySetInnerHTML={{ __html: rendered.html }} />
              {widgetSlots.map((el, i) =>
                rendered.widgets[i] === undefined ? null : createPortal(<Widget source={rendered.widgets[i]} onOpen={open} onChanged={onWidgetChanged} />, el, `${i}:${rendered.widgets[i]}`),
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
      recent={recent.filter((p) => resolver.paths.includes(p))}
      tabs={tabs}
      onOpen={(p) => void open(p)}
      onNew={() => void createDoc("")}
      onDaily={() => void openDaily(0)}
      onQuick={() => setPalette("files")}
      onSearch={() => showLeft("search")}
      onMenu={() => setDrawer("left")}
      pendingCount={pendingCount}
      onReview={() => setReviewOpen(true)}
      local={local}
      keyOf={keyOf}
    />
  );

  return (
    <div
      className={`shell${prefs.leftOpen ? " left-open" : ""}${rightOpen && doc && !settings && !isNarrow ? " right-open" : ""}${drawer ? ` drawer-${drawer}` : ""}`}
      style={{ ["--left-w" as string]: `${prefs.leftWidth}px`, ["--right-w" as string]: `${prefs.rightWidth}px` }}
    >
      {drawer && <div className="nav-backdrop" onClick={() => setDrawer(null)} />}
      <div className="left-dock">
        {rail}
        {((prefs.leftOpen && !isNarrow) || drawer === "left") && leftPanel}
      </div>
      {prefs.leftOpen && !isNarrow && (
        <Resizer side="left" label="왼쪽 패널 폭" width={prefs.leftWidth} min={180} max={520} onChange={(w) => setPrefs({ leftWidth: w })} onReset={() => setPrefs({ leftWidth: DEFAULT_PREFS.leftWidth })} />
      )}
      <main className="center">
        {settings ? (
          <SettingsPage
            section={settings}
            onSection={(s) => {
              history.replaceState(null, "", `${SETTINGS_HASH}/${s}`);
              setSettings(s);
            }}
            onClose={() => closeSettings()}
            noteSettings={noteSettings}
            onNoteSettings={(v) => {
              setNoteSettings(v);
              saveNoteSettings(v);
            }}
            commands={commands}
            local={local}
            onOpenAdmin={() => setAdminOpen(true)}
            onOpenSync={() => setSyncOpen(true)}
          />
        ) : (
          <>
            {tabBar}
            {center}
          </>
        )}
      </main>
      {doc && !settings && ((rightOpen && !isNarrow) || drawer === "right") && (
        <>
          {rightOpen && !isNarrow && (
            <Resizer side="right" label="오른쪽 패널 폭" width={prefs.rightWidth} min={200} max={560} onChange={(w) => setPrefs({ rightWidth: w })} onReset={() => setPrefs({ rightWidth: DEFAULT_PREFS.rightWidth })} />
          )}
          {rightPanel}
        </>
      )}
      {statusBar}

      {docMenu && <Menu at={docMenu} items={docMenuItems} onClose={() => setDocMenu(null)} />}

      {reviewOpen && (
        <ReviewPanel
          onClose={() => setReviewOpen(false)}
          onChanged={() => {
            vaultChanged();
            void refreshTree();
            if (doc && doc.draft === doc.saved) void load(doc.path);
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
          folders={folderPaths(tree)}
          onClose={() => setGraphOpen(false)}
          onOpen={(p) => {
            setGraphOpen(false);
            void open(p);
          }}
        />
      )}
      {lintOpen && (
        <LintPanel
          folders={folderPaths(tree)}
          onClose={() => setLintOpen(false)}
          onOpen={(p) => {
            setLintOpen(false);
            void open(p);
          }}
        />
      )}

      {syncOpen && localContext && (
        <SyncPanel
          ctx={localContext}
          onClose={() => setSyncOpen(false)}
          onOpen={(p) => {
            setSyncOpen(false);
            void open(p);
          }}
        />
      )}

      {adminOpen && (
        <AdminPanel
          folders={folderPaths(tree)}
          onClose={() => {
            setAdminOpen(false);
            // 복원 등으로 볼트가 바뀌었을 수 있다
            vaultChanged();
            void refreshTree();
            if (doc && doc.draft === doc.saved) void load(doc.path);
          }}
        />
      )}

      {ingestOpen && (
        <IngestDialog
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
          from={doc && !doc.generated && !revision ? { path: doc.path, draft: doc.draft } : null}
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
      {palette && (
        <Palette
          key={palette}
          placeholder={
            palette === "files"
              ? "문서 이름으로 열기 (Ctrl+Enter: 새 탭)"
              : palette === "commands"
                ? "명령"
                : palette === "move"
                  ? `"${moveTarget ? moveTarget.path.split("/").pop() : ""}"을(를) 옮길 폴더`
                  : `템플릿 (${noteSettings.templateFolder} 폴더)`
          }
          items={
            palette === "files"
              ? fileItems
              : palette === "commands"
                ? commandItems
                : palette === "move"
                  ? moveItems
                  : templatePaths.map((p) => ({
                      id: p,
                      label: stemOf(p),
                      detail: p,
                      run: () => void (palette === "templates" ? insertTemplate(p) : createFromTemplate(p)),
                    }))
          }
          hint={palette === "files" ? "↑↓ 고르기 · Enter 열기 · Ctrl+Enter 새 탭 · Esc 닫기" : "↑↓ 고르기 · Enter 실행 · Esc 닫기"}
          onClose={() => setPalette(null)}
        />
      )}
      {keysOpen && <KeysDialog commands={commands} onClose={() => setKeysOpen(false)} onEdit={() => (setKeysOpen(false), openSettings("keys"))} />}
      <Toasts />
    </div>
  );
}

function KeysDialog({ commands, onClose, onEdit }: { commands: Command[]; onClose: () => void; onEdit: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal keys-dialog" role="dialog" aria-label="단축키">
        <div className="modal-head">
          <strong>단축키</strong>
          <span>
            <button onClick={onEdit}>바꾸기…</button> <IconButton icon={X} label="닫기" onClick={onClose} size={16} />
          </span>
        </div>
        <KeySettings commands={commands} query="" readOnly />
        <p className="meta">
          편집기: 굵게 {formatCombo("Mod+B")} · 기울임 {formatCombo("Mod+I")} · 링크 {formatCombo("Mod+K")} · 형광펜 {formatCombo("Mod+Shift+H")} · 할 일 체크 {formatCombo("Mod+Enter")} · 문서 안 찾기 {formatCombo("Mod+F")}
          <br />
          트리: ↑↓ 이동 · ←→ 접기·펴기 · Enter 열기 · F2 이름 바꾸기 · Delete 삭제 · 오른쪽 클릭 메뉴 · 끌어서 옮기기
          <br />
          링크를 {formatCombo("Mod")}+클릭하면 옆 칸에서 엽니다.
        </p>
      </div>
    </div>
  );
}

function TreeOptions({ prefs }: { prefs: Prefs }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const items: MenuEntry[] = [
    { label: `${prefs.treeAttachments === "bottom" ? "✓ " : ""}첨부를 폴더 아래쪽에 모으기`, run: () => setPrefs({ treeAttachments: "bottom" }) },
    { label: `${prefs.treeAttachments === "show" ? "✓ " : ""}첨부를 문서와 섞어 보이기`, run: () => setPrefs({ treeAttachments: "show" }) },
    { label: `${prefs.treeAttachments === "hide" ? "✓ " : ""}첨부 숨기기`, run: () => setPrefs({ treeAttachments: "hide" }) },
    "-",
    { label: `${prefs.treeHideAttachmentFolders ? "✓ " : ""}attachments 폴더 숨기기`, run: () => setPrefs({ treeHideAttachmentFolders: !prefs.treeHideAttachmentFolders }) },
  ];
  return (
    <>
      <IconButton
        size={16}
        icon={Ellipsis}
        label="트리 표시 옵션"
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
  recent,
  tabs,
  onOpen,
  onNew,
  onDaily,
  onQuick,
  onSearch,
  onMenu,
  pendingCount,
  onReview,
  local,
  keyOf,
}: {
  recent: string[];
  tabs: string[];
  onOpen: (p: string) => void;
  onNew: () => void;
  onDaily: () => void;
  onQuick: () => void;
  onSearch: () => void;
  onMenu: () => void;
  pendingCount: number;
  onReview: () => void;
  local: boolean;
  keyOf: (id: string) => string | undefined;
}) {
  const k = (id: string) => (keyOf(id) ? <kbd>{formatCombo(keyOf(id))}</kbd> : null);
  return (
    <div className="home">
      <button className="nav-toggle home-nav" aria-label="문서 목록" onClick={onMenu}>
        <MenuIcon size={18} aria-hidden /> 문서 목록
      </button>
      <div className="home-inner">
        <h1>
          <House size={22} aria-hidden /> Keyring Notes
        </h1>
        <div className="home-actions">
          <button onClick={onNew}>
            <FilePlus size={16} aria-hidden /> 새 문서 {k("new")}
          </button>
          <button onClick={onDaily}>
            <CalendarDays size={16} aria-hidden /> 오늘 노트 {k("daily")}
          </button>
          <button onClick={onQuick}>
            <Files size={16} aria-hidden /> 빠르게 열기 {k("quick-open")}
          </button>
          <button onClick={onSearch}>
            <Search size={16} aria-hidden /> 검색 {k("search")}
          </button>
        </div>
        {!local && pendingCount > 0 && (
          <button className="home-review" onClick={onReview}>
            <ListChecks size={16} aria-hidden /> 에이전트 변경 {pendingCount}건이 검토를 기다립니다
          </button>
        )}
        {recent.length > 0 && (
          <section>
            <h2>최근 문서</h2>
            <ul className="home-list">
              {recent.slice(0, 12).map((p) => (
                <li key={p}>
                  <button onClick={() => onOpen(p)}>
                    <span className="home-doc">{stemOf(p)}</span>
                    <span className="meta">{parentOf(p)}</span>
                    {tabs.includes(p) && <span className="meta"> · 탭</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {local && <p className="meta">문서는 이 기기에 저장되며 서버 없이도 쓸 수 있습니다. 서버와 맞추려면 왼쪽 아래 동기화 단추를 누르세요.</p>}
      </div>
    </div>
  );
}
