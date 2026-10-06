import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, appMode, review, type CommitInfo, type MentionsInfo, type SearchHit, type SourcesInfo, type TreeNode } from "./api";
import { Editor, type EditorHandle, type LinkCandidate } from "./Editor";
import { AdminPanel } from "./Admin";
import { LintPanel, ReviewPanel } from "./Curation";
import { GraphView } from "./Graph";
import { ClipPage, IngestDialog } from "./Ingest";
import { invalidateWidgets, Widget } from "./Widget";
import { Login } from "./Login";
import { authMemo, isNetworkError, offline } from "./offline";
import { LinkResolver, renderMarkdown } from "./markdown";
import { enhance, invalidateEmbeds } from "./enhance";
import { Palette, type PaletteItem } from "./Palette";
import { applyTemplate, blockText, dailyNotePath, headings, linkMentions, pdfAnnotations, section, type Mention, type PropertyStat } from "@keyring-notes/core";
import { loadNoteSettings, saveNoteSettings, type NoteSettings } from "./noteSettings";
import { NoteSettingsDialog } from "./NoteSettingsDialog";
import { Properties } from "./Properties";
import { PdfViewer } from "./PdfViewer";
import { localContext } from "./local/boot";
import { SyncPanel, useSyncStatus } from "./Sync";
import { confirmDialog, promptDialog } from "./dialog";
import { merge3 } from "@keyring-notes/core";

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

function pathFromLocation(): string | null {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  return h || null;
}

/** [[ ]] 안에 쓸 이름: 파일 이름만으로 이 문서를 가리키면 파일 이름, 아니면 확장자 뺀 경로 */
function mentionTarget(path: string, resolver: LinkResolver): string {
  const stem = path.split("/").pop()!.replace(/\.md$/i, "");
  return resolver.resolve(stem) === path ? stem : path.replace(/\.md$/i, "");
}

/** 문단·제목을 가리키는 출처: 그 부분의 원문을 짧게 인용해 보인다(없으면 점검 대상) */
function SourceQuote({ path, anchor }: { path: string; anchor: string }) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api
      .read(path)
      .then((d) => {
        if (!alive) return;
        // PDF 주석 줄은 "3쪽 “인용” — 메모"로 보인다(링크 문법 없이)
        const pdfNote = anchor.startsWith("^pdf-") ? pdfAnnotations(d.content).find((a) => a.id === anchor.slice(1)) : undefined;
        if (pdfNote) setText(`${pdfNote.page}쪽 “${pdfNote.quote}”${pdfNote.note ? ` — ${pdfNote.note}` : ""}`);
        else if (anchor.startsWith("^")) setText(blockText(d.content, anchor.slice(1)));
        else {
          try {
            setText(section(d.content, { heading: anchor }).content);
          } catch {
            setText(null);
          }
        }
      })
      .catch(() => alive && setText(null));
    return () => {
      alive = false;
    };
  }, [path, anchor]);
  if (text === undefined) return null;
  if (text === null) return <div className="source-quote broken">가리키는 {anchor.startsWith("^") ? "블록" : "제목"}이 원본에 없습니다</div>;
  const short = text.length > 280 ? `${text.slice(0, 280)}…` : text;
  return <blockquote className="source-quote">{short}</blockquote>;
}

/**
 * 연결되지 않은 언급: 다른 문서에 이 문서 이름이 링크 없이 나온 곳. 펼칠 때 찾고(문서마다 원문을 읽으므로),
 * "링크로"를 누르면 그 문서를 읽었던 버전(hash) 기준으로 고쳐 쓴다(그 사이 바뀌었으면 충돌로 막힌다).
 */
function UnlinkedMentions({ path, target, version, onOpen, onChanged }: { path: string; target: string; version: number; onOpen: (p: string) => void; onChanged: () => void }) {
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<MentionsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInfo(null);
    setError(null);
    if (!shown) return;
    let alive = true;
    api
      .mentions(path)
      .then((r) => alive && setInfo(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [path, shown, version]);

  const link = async (doc: MentionsInfo["docs"][number], ms: Mention[]) => {
    setBusy(true);
    setError(null);
    try {
      const cur = await api.read(doc.path);
      if (cur.hash !== doc.hash) throw new Error(`${doc.path}이(가) 그 사이 바뀌었습니다. 다시 찾은 뒤 바꾸세요.`);
      await api.write(doc.path, linkMentions(cur.content, ms, target), doc.hash);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInfo(null);
      api.mentions(path).then(setInfo).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const total = info?.docs.reduce((n, d) => n + d.mentions.length, 0) ?? 0;
  return (
    <details className="mentions" open={shown} onToggle={(e) => setShown((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <h4>연결되지 않은 언급{info ? ` ${total}` : ""}</h4>
      </summary>
      {error && <p className="mention-error">{error}</p>}
      {!info && !error && <p className="meta">찾는 중…</p>}
      {info && info.docs.length === 0 && <p className="meta">다른 문서에서 이 이름({info.names.join(", ")})을 링크 없이 쓴 곳이 없습니다.</p>}
      {info && info.docs.length > 0 && (
        <ul>
          {info.docs.map((d) => (
            <li key={d.path}>
              <a
                href={`#/${encodeURIComponent(d.path)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(d.path);
                }}
              >
                {d.title}
              </a>{" "}
              <span className="meta">{d.path}</span>{" "}
              {d.mentions.length > 1 && (
                <button className="link-btn" disabled={busy} onClick={() => void link(d, d.mentions)}>
                  모두 링크로
                </button>
              )}
              <ul className="mention-list">
                {d.mentions.map((m) => (
                  <li key={`${m.line}:${m.start}`}>
                    <span className="mention-context">
                      {m.context.slice(0, m.contextAt)}
                      <mark>{m.context.slice(m.contextAt, m.contextAt + m.text.length)}</mark>
                      {m.context.slice(m.contextAt + m.text.length)}
                    </span>{" "}
                    <button className="link-btn" disabled={busy} title={`${m.line}번째 줄의 "${m.text}"를 [[${target}]] 링크로`} onClick={() => void link(d, [m])}>
                      링크로
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** 미리보기 아래: 출처(프런트매터 sources), 이 문서를 출처로 인용한 문서, 본문 백링크. */
function References({ refs, onOpen }: { refs: SourcesInfo; onOpen: (p: string, anchor?: string) => void }) {
  const link = (p: string, label: string, anchor?: string) => (
    <a
      href={`#/${encodeURIComponent(p)}`}
      onClick={(e) => {
        e.preventDefault();
        if (/\.(md|pdf)$/i.test(p)) onOpen(p, anchor);
        else window.open(api.rawUrl(p), "_blank", "noreferrer");
      }}
    >
      {label}
    </a>
  );
  return (
    <section className="backlinks">
      {refs.sources.length > 0 && (
        <>
          <h4>출처 {refs.sources.length}</h4>
          <ul>
            {refs.sources.map((s) => (
              <li key={`${s.target}#${s.anchor ?? ""}`}>
                {s.path ? link(s.path, s.path.split("/").pop()!.replace(/\.md$/i, "") + (s.anchor ? ` › ${s.anchor.replace(/^\^/, "¶ ")}` : ""), s.anchor) : <span className="broken">{s.target}</span>}{" "}
                <span className="meta">{s.path ?? "없거나 볼 수 없는 출처"}</span>
                {s.path && s.anchor && <SourceQuote path={s.path} anchor={s.anchor} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {refs.citedBy.length > 0 && (
        <>
          <h4>이 문서를 출처로 인용한 페이지 {refs.citedBy.length}</h4>
          <ul>
            {refs.citedBy.map((b) => (
              <li key={b.path}>
                {link(b.path, b.title)} <span className="meta">{b.path}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>백링크 {refs.linkedBy.length}</h4>
      {refs.linkedBy.length === 0 ? (
        <p className="meta">이 문서를 본문에서 링크한 문서가 없습니다.</p>
      ) : (
        <ul>
          {refs.linkedBy.map((b) => (
            <li key={b.path}>
              {link(b.path, b.title)} <span className="meta">{b.path}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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

function conflictCopyPath(path: string, label = "충돌 사본") {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return path.replace(/\.md$/i, ` (${label} ${stamp}).md`);
}

function TreeView({
  nodes,
  current,
  onOpen,
}: {
  nodes: TreeNode[];
  current: string | null;
  /** newTab: Ctrl/Cmd+클릭·가운데 클릭 */
  onOpen: (path: string, opts?: { newTab?: boolean }) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((n) =>
        n.type === "dir" ? (
          <li key={n.path}>
            <details open={current?.startsWith(n.path + "/") || undefined}>
              <summary>{n.name}</summary>
              <TreeView nodes={n.children ?? []} current={current} onOpen={onOpen} />
            </details>
          </li>
        ) : n.name.toLowerCase().endsWith(".md") ? (
          <li key={n.path}>
            <a
              href={`#/${encodeURIComponent(n.path)}`}
              className={n.path === current ? "file active" : "file"}
              onClick={(e) => {
                e.preventDefault();
                onOpen(n.path, { newTab: e.ctrlKey || e.metaKey });
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                onOpen(n.path, { newTab: true });
              }}
            >
              {n.name.replace(/\.md$/i, "")}
            </a>
          </li>
        ) : (
          <li key={n.path}>
            <a
              href={api.rawUrl(n.path)}
              className="file attachment"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                // PDF는 앱 안에서 연다(주석 달기). 새 탭으로 원본을 보려면 가운데 단추·Ctrl+클릭
                if (!/\.pdf$/i.test(n.path) || e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                onOpen(n.path);
              }}
            >
              {n.name}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

export function App() {
  // 데스크톱·모바일 앱(또는 브라우저 ?local): 기기 볼트라 로그인이 없다
  return appMode.local ? <Workspace onLogout={() => undefined} /> : <ServerApp />;
}

function ServerApp() {
  const [auth, setAuth] = useState({ ready: false, ok: false, wasIn: false, passwordSet: true, passkey: false });

  const checkAuth = useCallback(async () => {
    try {
      const s = await api.status();
      const ok = s.authenticated && s.principal?.kind === "owner";
      authMemo.set(ok);
      setAuth((a) => ({ ready: true, ok, wasIn: a.wasIn || ok, passwordSet: s.passwordSet, passkey: s.passkey === true }));
    } catch (e) {
      // 연결이 없을 때: 이 기기에서 로그인했었다면 오프라인으로 연다
      const offlineOk = isNetworkError(e) && authMemo.get();
      setAuth((a) => ({ ...a, ready: true, ok: offlineOk, wasIn: a.wasIn || offlineOk }));
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const onUnauthorized = () => setAuth((a) => ({ ...a, ok: false }));
    window.addEventListener("keyring:unauthorized", onUnauthorized);
    return () => window.removeEventListener("keyring:unauthorized", onUnauthorized);
  }, [checkAuth]);

  if (!auth.ready) return null;
  // 북마클릿이 연 클리퍼 창
  if (location.hash.startsWith("#/clip")) {
    return auth.ok ? <ClipPage /> : <Login passwordSet={auth.passwordSet} passkey={auth.passkey} onDone={checkAuth} />;
  }
  // 세션이 끊겨도 작업 화면은 남겨 두어 저장하지 않은 내용을 잃지 않게 한다.
  return (
    <>
      {(auth.ok || auth.wasIn) && (
        <Workspace
          onLogout={() =>
            api.logout().finally(() => {
              authMemo.set(false);
              void offline.clear().catch(() => undefined);
              setAuth((a) => ({ ...a, wasIn: false }));
              void checkAuth();
            })
          }
        />
      )}
      {!auth.ok && <Login passwordSet={auth.passwordSet} passkey={auth.passkey} onDone={checkAuth} />}
    </>
  );
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  // 좁은 화면에서는 나란히 보기 대신 미리보기로 시작
  const [mode, setMode] = useState<ViewMode>(() => (window.matchMedia?.("(max-width: 800px)").matches ? "preview" : "split"));
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const [navOpen, setNavOpen] = useState(false);
  const [semanticOn, setSemanticOn] = useState(false);
  const [searchMode, setSearchMode] = useState<"text" | "semantic">("text");
  /** 볼트 내용이 바뀔 때마다 올려 태그·백링크·위젯을 다시 불러온다. */
  const [vaultVersion, setVaultVersion] = useState(0);
  const editorHandle = useRef<EditorHandle | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [widgetSlots, setWidgetSlots] = useState<HTMLElement[]>([]);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  // 탭: 열린 문서 경로(이 기기에 기억)와, 뒤에 있는 탭의 초안
  const [tabs, setTabs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("keyring:tabs") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabCache = useRef(new Map<string, OpenDoc>());
  useEffect(() => {
    try {
      localStorage.setItem("keyring:tabs", JSON.stringify(tabs.slice(0, 30)));
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [tabs]);
  const [palette, setPalette] = useState<"files" | "commands" | "templates" | "new-from-template" | null>(null);
  const [noteSettings, setNoteSettings] = useState<NoteSettings>(loadNoteSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // 편집 중 렌더링(이 기기에 기억)
  const [live, setLive] = useState(() => {
    try {
      return localStorage.getItem("keyring:live") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("keyring:live", live ? "1" : "0");
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [live]);
  // 속성 입력 화면(이 기기에 기억, 처음에는 켬)
  const [propsOpen, setPropsOpen] = useState(() => {
    try {
      return localStorage.getItem("keyring:props") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("keyring:props", propsOpen ? "1" : "0");
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [propsOpen]);
  const [propStats, setPropStats] = useState<PropertyStat[]>([]);
  useEffect(() => {
    if (!propsOpen) return;
    api.properties().then(setPropStats).catch(() => undefined);
  }, [propsOpen, vaultVersion]);
  const [pendingAnchor, setPendingAnchor] = useState<{ path: string; heading?: string; block?: string } | null>(null);
  // 앱 안 PDF 보기(주석 달기)
  const [pdfView, setPdfView] = useState<{ path: string; page?: number } | null>(null);
  /** 브라우저 로컬 볼트의 첨부(blob URL)가 준비되면 올려 미리보기를 다시 그린다 */
  const [assetVersion, setAssetVersion] = useState(0);
  const local = appMode.local;
  const syncStatus = useSyncStatus(localContext);
  const docRef = useRef<OpenDoc | null>(null);
  docRef.current = doc;

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

  const refreshTree = useCallback(() => api.tree().then(setTree).catch((e) => setError(String(e.message ?? e))), []);

  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const vaultChanged = useCallback(() => {
    invalidateWidgets();
    invalidateEmbeds();
    setVaultVersion((v) => v + 1);
    // 위키 index·log를 열어 두었다면 서버가 새로 만든 내용으로 바꾼다.
    const cur = docRef.current;
    if (cur?.generated) setTimeout(() => void load(cur.path), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            report(e);
          });
      },
      semantic ? 400 : 200,
    );
    return () => clearTimeout(t);
  }, [query, vaultVersion, searchMode]);

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
      setError(null);
      if (pathFromLocation() !== d.path) history.replaceState(null, "", `#/${encodeURIComponent(d.path)}`);
    } catch (e) {
      report(e);
    }
  }, []);

  /**
   * 문서 열기. 탭: 이미 열린 탭이면 그 탭으로(저장 안 한 초안은 탭마다 그대로), newTab이면 새 탭에,
   * 아니면 지금 탭을 바꾼다(저장 안 한 변경이 있으면 묻는다).
   */
  const open = useCallback(
    async (path: string, opts: { newTab?: boolean } = {}) => {
      if (/\.pdf$/i.test(path)) return setPdfView({ path });
      const cur = docRef.current;
      if (cur?.path === path) return;
      const keep = tabsRef.current.includes(path) || opts.newTab;
      if (cur) {
        if (keep) tabCache.current.set(cur.path, cur);
        else if (cur.draft !== cur.saved && !(await confirmDialog("저장하지 않은 변경이 있습니다. 버리고 이동할까요?", "버리고 이동"))) return;
      }
      setTabs((t) => {
        if (t.includes(path)) return t;
        if (!cur || keep || !t.includes(cur.path)) return [...t, path];
        return t.map((x) => (x === cur.path ? path : x));
      });
      setNavOpen(false);
      const cached = tabCache.current.get(path);
      if (cached) {
        tabCache.current.delete(path);
        setDoc({ ...cached, seq: cached.seq + 1 });
        setConflict(null);
        setRevision(null);
        if (pathFromLocation() !== path) history.replaceState(null, "", `#/${encodeURIComponent(path)}`);
      } else void load(path);
    },
    [load],
  );

  /** 탭 닫기. 닫는 탭에 저장 안 한 변경이 있으면 묻는다 */
  const closeTab = async (path: string) => {
    const cur = docRef.current;
    const target = cur?.path === path ? cur : tabCache.current.get(path);
    if (target && target.draft !== target.saved && !(await confirmDialog(`"${path}"에 저장하지 않은 변경이 있습니다. 버리고 닫을까요?`, "버리고 닫기"))) return;
    tabCache.current.delete(path);
    const list = tabsRef.current;
    const i = list.indexOf(path);
    const rest = list.filter((p) => p !== path);
    setTabs(rest);
    if (cur?.path === path) {
      const next = rest[Math.min(i, rest.length - 1)];
      if (next) {
        const cached = tabCache.current.get(next);
        if (cached) {
          tabCache.current.delete(next);
          setDoc({ ...cached, seq: cached.seq + 1 });
          history.replaceState(null, "", `#/${encodeURIComponent(next)}`);
        } else void load(next);
      } else {
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
      void load(initial);
    }
  }, [refreshTree, load]);

  useEffect(() => {
    const onHash = () => {
      const p = pathFromLocation();
      if (p && p !== doc?.path) open(p);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [doc?.path, open]);

  // 저장 안 한 변경(지금 문서 또는 뒤에 있는 탭)이 있으면 창을 닫기 전에 묻는다
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const cur = docRef.current;
      const any = (cur && cur.draft !== cur.saved) || [...tabCache.current.values()].some((d) => d.draft !== d.saved);
      if (any) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (!historyOpen || !doc) return;
    api.history(doc.path).then(setCommits).catch(report);
  }, [historyOpen, doc?.path, doc?.hash]);

  const save = useCallback(async () => {
    if (!doc || saving || doc.generated || doc.draft === doc.saved) return;
    setSaving(true);
    const content = doc.draft;
    try {
      const d = await api.write(doc.path, content, doc.hash || null);
      await offline.done(doc.path).catch(() => undefined);
      setOutboxCount((await offline.pending().catch(() => [])).length);
      // 저장하는 동안 더 입력한 내용(draft)은 그대로 둔다.
      setDoc((prev) => (prev && prev.path === d.path ? { ...prev, saved: content, hash: d.hash } : prev));
      setConflict(null);
      setError(null);
      vaultChanged();
    } catch (e) {
      if (isNetworkError(e)) {
        // 오프라인: 이 기기에 저장해 두고, 연결되면 보낸다
        await offline.queue(doc.path, content, doc.hash || null, doc.hash ? doc.saved : null);
        setDoc((prev) => (prev && prev.path === doc.path ? { ...prev, saved: content } : prev));
        setOutboxCount((await offline.pending()).length);
      } else if (e instanceof ApiError && e.status === 409) {
        // 다른 곳(다른 탭·에이전트·동기화)에서 먼저 고쳤다: 서로 다른 부분이면 자동으로 합친다
        const merged = e.currentHash && doc.hash ? await saveMerged(doc.path, doc.saved, content).catch(() => null) : null;
        if (!merged) setConflict({ currentHash: e.currentHash ?? null });
        else {
          const prev = docRef.current;
          // 저장하는 동안 더 입력했다면 그 입력도 합친다
          const draft = !prev || prev.draft === content ? merged.text : (() => {
            const more = merge3(content, prev.draft, merged.text);
            return more.ok ? more.text : null;
          })();
          if (prev && prev.path === doc.path && draft !== null) {
            setDoc({ ...prev, saved: merged.text, hash: merged.hash, draft, seq: prev.seq + 1 });
            setConflict(null);
            setError("다른 곳에서 바뀐 내용과 자동으로 합쳐 저장했습니다(서로 다른 부분을 고쳤습니다). 이력에서 되돌릴 수 있습니다.");
          } else setConflict({ currentHash: merged.hash });
          vaultChanged();
        }
      } else report(e);
    } finally {
      setSaving(false);
    }
  }, [doc, saving, vaultChanged]);

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
      // 다시 불러오기가 알림을 지우지 않도록 먼저 끝낸다
      if (cur && (synced.includes(cur.path) || merged.includes(cur.path) || conflicts.length) && cur.draft === cur.saved) await load(cur.path);
      setError(
        `오프라인에서 저장한 ${synced.length + conflicts.length + merged.length}개를 보냈습니다.` +
          (merged.length ? ` 그 사이 서버에서 다른 부분이 바뀐 ${merged.length}개는 자동으로 합쳤습니다.` : "") +
          (conflicts.length ? ` 그 사이 서버에서 바뀐 문서는 덮어쓰지 않고 사본으로 남겼습니다: ${conflicts.join(", ")}` : ""),
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
    void offline.pending().then((p) => {
      setOutboxCount(p.length);
      if (p.length && navigator.onLine) void flushOutbox();
    }).catch(() => undefined);
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
        else setError(source === "sync" ? "동기화로 이 문서가 바뀌었습니다. 지금 저장하면 충돌이 납니다. 사본으로 저장하거나 새 버전을 불러오세요." : "다른 편집기에서 이 문서가 바뀌었습니다.");
      }
    });
    return () => {
      off();
      window.removeEventListener("keyring:asset-loaded", onAsset);
    };
  }, [vaultChanged, refreshTree, load]);

  // 빠른 전환(Ctrl/Cmd+O)·명령 팔레트(Ctrl/Cmd+P, Ctrl/Cmd+Shift+P). 에디터보다 먼저 받는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        setPalette("files");
      } else if (k === "p") {
        e.preventDefault();
        setPalette("commands");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // 에디터 밖(로그인 직후 등)에서도 Ctrl/Cmd+S로 저장한다. 에디터 안에서는 에디터 키맵이 먼저 처리한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !e.defaultPrevented) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

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
          report(e);
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
      setError(`내 변경은 "${copy}"에 저장했습니다.`);
    } catch (e) {
      report(e);
    }
  };

  const createDoc = async () => {
    const dir = doc?.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/") + 1) : "";
    const input = await promptDialog("새 문서 경로 (.md 생략 가능)", dir, "만들기");
    if (!input) return;
    const path = /\.md$/i.test(input) ? input : `${input}.md`;
    const title = path.split("/").pop()!.replace(/\.md$/i, "");
    try {
      await api.write(path, `# ${title}\n`, null);
      vaultChanged();
      await refreshTree();
      open(path);
    } catch (e) {
      if (isNetworkError(e)) {
        await offline.queue(path, `# ${title}\n`, null);
        setOutboxCount((await offline.pending()).length);
        open(path);
      } else report(e);
    }
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
        if (!(e instanceof ApiError && e.status === 409)) return report(e);
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

  const createFromTemplate = async (tplPath: string) => {
    const tpl = await readTemplate(tplPath);
    if (tpl === null) return;
    const dir = doc?.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/") + 1) : "";
    const input = await promptDialog("새 문서 경로 (.md 생략 가능)", dir, "만들기");
    if (!input) return;
    const path = /\.md$/i.test(input) ? input : `${input}.md`;
    const title = path.split("/").pop()!.replace(/\.md$/i, "");
    try {
      await api.write(path, applyTemplate(tpl, { title, date: new Date() }), null);
      vaultChanged();
      await refreshTree();
      void open(path);
    } catch (e) {
      report(e);
    }
  };

  const moveDoc = async () => {
    if (!doc) return;
    if (dirty) return setError("먼저 저장한 뒤 이동하세요.");
    const input = await promptDialog("새 경로", doc.path, "이동");
    if (!input || input === doc.path) return;
    const to = /\.md$/i.test(input) ? input : `${input}.md`;
    try {
      const d = await api.move(doc.path, to, doc.hash);
      vaultChanged();
      await refreshTree();
      await load(d.path);
      // 이 문서를 가리키던 링크(다른 문서, 이 문서 자신의 상대 링크)를 같이 고쳤다
      const others = (d.linksUpdated ?? []).filter((p) => p !== d.path).length;
      if (d.linkCount) setError(`이동했습니다. 링크 ${d.linkCount}곳을 고쳤습니다(다른 문서 ${others}개${d.linksUpdated?.includes(d.path) ? ", 이 문서의 상대 링크 포함" : ""}).`);
    } catch (e) {
      report(e);
    }
  };

  const deleteDoc = async () => {
    if (!doc || !(await confirmDialog(`"${doc.path}" 문서를 삭제할까요? (이력에서 되돌릴 수 있습니다)`, "삭제"))) return;
    try {
      await api.remove(doc.path, doc.hash);
      vaultChanged();
      setDoc(null);
      history.replaceState(null, "", "#");
      await refreshTree();
    } catch (e) {
      report(e);
    }
  };

  const showRevision = async (commit: CommitInfo) => {
    if (!doc) return;
    try {
      setRevision({ commit, content: await api.revision(doc.path, commit.rev) });
    } catch (e) {
      report(e);
    }
  };

  const rollback = async () => {
    if (!doc || !revision) return;
    if (dirty && !(await confirmDialog("저장하지 않은 변경을 버리고 이 버전으로 되돌릴까요?", "되돌리기"))) return;
    try {
      await api.rollback(doc.path, revision.commit.rev, doc.hash);
      vaultChanged();
      await load(doc.path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError("그 사이 문서가 바뀌었습니다. 다시 불러온 뒤 시도하세요.");
      else report(e);
    }
  };

  /** 위젯에서 문서를 바꿨을 때: 지금 연 문서면(저장 안 한 변경이 없을 때) 다시 불러온다. */
  const onWidgetChanged = (path: string) => {
    setVaultVersion((v) => v + 1);
    if (doc?.path === path) {
      if (doc.draft === doc.saved) void load(path);
      else setError("위젯에서 이 문서를 바꿨습니다. 지금 저장하면 충돌이 납니다. 사본으로 저장하거나 서버 버전을 불러오세요.");
    }
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
    const local = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]:not([data-wikilink])');
    if (local) {
      const id = decodeURIComponent(local.getAttribute("href")!.slice(1));
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
    if (a.dataset.resolved === "1") {
      if (target.toLowerCase().endsWith(".md")) {
        if (anchor && target === doc?.path) scrollToAnchor(anchor);
        else {
          if (anchor) setPendingAnchor({ path: target, ...anchor });
          void open(target);
        }
      } else if (/\.pdf$/i.test(target)) {
        // [[x.pdf#page=3]] → 앱 안 PDF 보기의 그 쪽
        const page = /^page=(\d+)$/.exec(a.dataset.heading ?? "")?.[1];
        setPdfView({ path: target, ...(page ? { page: Number(page) } : {}) });
      } else window.open(api.rawUrl(target), "_blank", "noreferrer");
    } else {
      void confirmDialog(`"${target}" 문서가 없습니다. 새로 만들까요?`, "만들기").then((yes) => {
        if (!yes) return;
        const path = /\.md$/i.test(target) ? target : `${target}.md`;
        api
          .write(path, `# ${path.split("/").pop()!.replace(/\.md$/i, "")}\n`, null)
          .then(refreshTree)
          .then(() => open(path))
          .catch(report);
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

  // 빠른 전환: 열린 탭을 먼저, 나머지 문서
  const fileItems = useMemo<PaletteItem[]>(() => {
    const docs = resolver.paths.filter((p) => /\.md$/i.test(p));
    const order = (p: string) => (tabs.includes(p) ? 0 : 1);
    return docs
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b, "ko"))
      .map((p) => ({
        id: p,
        label: p.split("/").pop()!.replace(/\.md$/i, ""),
        detail: p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : undefined,
        run: (alt: boolean) => void open(p, { newTab: alt }),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver, tabs]);

  const commandItems: PaletteItem[] = [
    { id: "quick", label: "문서 빠르게 열기", detail: "Ctrl+O", run: () => setPalette("files") },
    { id: "new", label: "새 문서", run: () => void createDoc() },
    { id: "daily", label: "오늘 노트", detail: dailyNotePath(noteSettings.dailyFolder, noteSettings.dailyFormat, new Date()), run: () => void openDaily(0) },
    { id: "daily-prev", label: "어제 노트", run: () => void openDaily(-1) },
    { id: "daily-next", label: "내일 노트", run: () => void openDaily(1) },
    { id: "tpl-new", label: "템플릿으로 새 문서", detail: noteSettings.templateFolder, run: () => setPalette("new-from-template") },
    ...(doc && !doc.generated ? [{ id: "tpl-insert", label: "템플릿 넣기", detail: noteSettings.templateFolder, run: () => setPalette("templates") }] : []),
    { id: "note-settings", label: "데일리 노트·템플릿 설정", run: () => setSettingsOpen(true) },
    ...(doc
      ? [
          { id: "save", label: "저장", detail: "Ctrl+S", run: () => void save() },
          { id: "move", label: "이동·이름 바꾸기", run: () => void moveDoc() },
          { id: "delete", label: "삭제", run: () => void deleteDoc() },
          { id: "history", label: historyOpen ? "이력 닫기" : "이력 보기", run: () => setHistoryOpen((v) => !v) },
          { id: "outline", label: outlineOpen ? "개요 닫기" : "개요 보기", run: () => setOutlineOpen((v) => !v) },
          { id: "close-tab", label: "탭 닫기", run: () => void closeTab(doc.path) },
          { id: "mode-edit", label: "보기: 편집", run: () => setMode("edit") },
          { id: "mode-split", label: "보기: 나란히", run: () => setMode("split") },
          { id: "mode-preview", label: "보기: 미리보기", run: () => setMode("preview") },
        ]
      : []),
    { id: "live", label: live ? "편집 중 렌더링 끄기" : "편집 중 렌더링 켜기", run: () => setLive((v) => !v) },
    { id: "props", label: propsOpen ? "속성 화면 닫기" : "속성 화면 열기", run: () => setPropsOpen((v) => !v) },
    { id: "graph", label: "그래프 뷰", run: () => setGraphOpen(true) },
    { id: "lint", label: "정리 점검", run: () => setLintOpen(true) },
    ...(local
      ? [{ id: "sync", label: "이 기기·동기화", run: () => setSyncOpen(true) }]
      : [
          { id: "ingest", label: "원본 수집", run: () => setIngestOpen(true) },
          { id: "review", label: "변경 검토", run: () => setReviewOpen(true) },
          { id: "admin", label: "관리 콘솔", run: () => setAdminOpen(true) },
        ]),
  ];

  const outline = useMemo(() => (outlineOpen && doc ? headings(doc.draft) : []), [outlineOpen, doc?.draft]);

  // 수식·다이어그램·문서 임베드는 그린 뒤에 채운다(enhance.ts)
  useEffect(() => {
    if (!previewRef.current || !doc) return;
    return enhance(previewRef.current, { resolver, docPath: doc.path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html]);

  // 다른 문서의 제목·블록 링크로 왔으면 그 위치로
  useEffect(() => {
    if (!pendingAnchor || doc?.path !== pendingAnchor.path) return;
    const anchor = pendingAnchor;
    setPendingAnchor(null);
    // 그린 직후(임베드·다이어그램이 자리를 잡을 틈을 조금 두고)
    setTimeout(() => scrollToAnchor(anchor), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered.html, doc?.path, pendingAnchor]);

  // innerHTML이 바뀐 뒤 위젯 자리를 찾아 React 포털로 위젯을 그린다.
  useLayoutEffect(() => {
    setWidgetSlots(Array.from(previewRef.current?.querySelectorAll<HTMLElement>(".widget-slot") ?? []));
  }, [rendered.html]);

  return (
    <div className={`app${navOpen ? " nav-open" : ""}`}>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className="sidebar">
        <div className="sidebar-head">
          <strong>Keyring Notes</strong>
          <span>
            <button onClick={createDoc} title="새 문서">＋</button>{" "}
            <button onClick={() => void openDaily(0)} title="오늘 노트(데일리 노트)">
              📅
            </button>{" "}
            {local ? (
              <>
                <button
                  onClick={() => setSyncOpen(true)}
                  title={syncStatus?.settings ? `동기화: ${syncStatus.settings.server}` : "이 기기 · 서버 동기화(선택)"}
                  className={`sync-button${syncStatus?.running ? " running" : ""}${syncStatus?.lastError ? " has-error" : ""}`}
                >
                  ⇅
                </button>{" "}
              </>
            ) : (
              <>
                <button onClick={() => setIngestOpen(true)} title="원본 수집(파일·URL·붙여넣기)">
                  📥
                </button>{" "}
                <button onClick={() => setReviewOpen(true)} title="변경 검토(에이전트 제안)" className={pendingCount ? "has-badge" : ""}>
                  ✔{pendingCount > 0 && <span className="badge-count">{pendingCount}</span>}
                </button>{" "}
              </>
            )}
            <button onClick={() => setGraphOpen(true)} title="그래프 뷰">
              ◎
            </button>{" "}
            <button onClick={() => setLintOpen(true)} title="정리 점검(깨진 링크·고아·출처 없음…)">
              🧹
            </button>{" "}
            {!local && (
              <>
                <button onClick={() => setAdminOpen(true)} title="관리 콘솔(상태·에이전트·백업·업데이트)">
                  ⚙
                </button>{" "}
                <button
                  onClick={async () => (!dirty || (await confirmDialog("저장하지 않은 변경이 있습니다. 로그아웃할까요?", "로그아웃"))) && onLogout()}
                  title="로그아웃"
                >
                  ⎋
                </button>
              </>
            )}
          </span>
        </div>
        <div className="search-box">
          <input
            type="search"
            placeholder="검색 (#태그)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
          {semanticOn && (
            <button
              className={`search-mode${searchMode === "semantic" ? " on" : ""}`}
              title="의미 검색: 단어가 달라도 뜻이 가까운 문서"
              onClick={() => setSearchMode((m) => (m === "text" ? "semantic" : "text"))}
            >
              의미
            </button>
          )}
        </div>
        {hits !== null ? (
          <ul className="search-results">
            {hits.map((h) => (
              <li key={h.path}>
                <a
                  href={`#/${encodeURIComponent(h.path)}`}
                  className={h.path === doc?.path ? "active" : ""}
                  onClick={(e) => {
                    e.preventDefault();
                    open(h.path);
                  }}
                >
                  <span className="hit-title">
                    {h.title} {h.score !== undefined && <span className="hit-score">{h.score.toFixed(2)}</span>}
                  </span>
                  <span className="hit-path">{h.path}</span>
                  {h.snippet && <span className="hit-snippet">{h.snippet}</span>}
                </a>
              </li>
            ))}
            {hits.length === 0 && <li className="meta">결과가 없습니다.</li>}
          </ul>
        ) : (
          <>
            <TreeView nodes={tree} current={doc?.path ?? null} onOpen={open} />
            {tags.length > 0 && (
              <details className="tag-list">
                <summary>태그 {tags.length}</summary>
                <div>
                  {tags.map((t) => (
                    <button key={t.tag} className="tag" onClick={() => setQuery(`#${t.tag}`)}>
                      #{t.tag} <span className="count">{t.count}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </aside>

      <main className="main">
        {doc ? (
          <>
            {tabs.length > 1 && (
              <nav className="tabs" aria-label="열린 문서">
                {tabs.map((t) => {
                  const cached = t === doc.path ? doc : tabCache.current.get(t);
                  const isDirty = !!cached && cached.draft !== cached.saved;
                  return (
                    <span key={t} className={`tab${t === doc.path ? " on" : ""}`} title={t}>
                      <button className="tab-name" onClick={() => void open(t)} onAuxClick={(e) => e.button === 1 && void closeTab(t)}>
                        {t.split("/").pop()!.replace(/\.md$/i, "")}
                        {isDirty && <span className="dirty"> ●</span>}
                      </button>
                      <button className="tab-close" aria-label={`${t} 닫기`} onClick={() => void closeTab(t)}>
                        ×
                      </button>
                    </span>
                  );
                })}
              </nav>
            )}
            <header className="toolbar">
              <button className="nav-toggle" aria-label="문서 목록" onClick={() => setNavOpen((v) => !v)}>
                ☰
              </button>
              <span className="doc-path" title={doc.path}>
                {doc.path}
                {dirty && <span className="dirty"> ●</span>}
              </span>
              <div className="modes">
                {(["edit", "split", "preview"] as const).map((m) => (
                  <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                    {{ edit: "편집", split: "나란히", preview: "미리보기" }[m]}
                  </button>
                ))}
                <button
                  className={live ? "on" : ""}
                  aria-pressed={live}
                  title="편집 중 렌더링: 커서가 없는 줄은 # · ** · [[ ]] 같은 기호를 숨기고 모양만 보입니다"
                  onClick={() => setLive((v) => !v)}
                >
                  Aa
                </button>
                <button
                  className={propsOpen ? "on" : ""}
                  aria-pressed={propsOpen}
                  title="속성(프런트매터)을 입력칸으로 보고 고칩니다"
                  onClick={() => setPropsOpen((v) => !v)}
                >
                  속성
                </button>
              </div>
              <button onClick={save} disabled={!dirty || saving || doc.generated}>
                {saving ? "저장 중…" : "저장"}
              </button>
              <button onClick={moveDoc} disabled={doc.generated}>
                이동
              </button>
              <button onClick={deleteDoc} disabled={doc.generated}>
                삭제
              </button>
              <button className={historyOpen ? "on" : ""} onClick={() => setHistoryOpen((v) => !v)}>
                이력
              </button>
              <button className={outlineOpen ? "on" : ""} onClick={() => setOutlineOpen((v) => !v)} title="개요: 제목 목록">
                개요
              </button>
            </header>

            {!local && (!online || outboxCount > 0) && (
              <div className="banner offline">
                {!online ? "오프라인입니다. 이 기기에서 연 문서만 열 수 있고, " : "연결되었습니다. "}
                {outboxCount > 0 ? `저장한 변경 ${outboxCount}개를 ${online ? "보내는 중…" : "연결되면 서버로 보냅니다."}` : "저장하면 연결될 때 서버로 보냅니다."}
                {online && outboxCount > 0 && <button onClick={() => void flushOutbox()}>지금 보내기</button>}
              </div>
            )}
            {doc.cachedOffline && <div className="banner info">연결이 없어 이 기기에 남은 사본을 보여 줍니다.</div>}
            {doc.generated && (
              <div className="banner generated">
                {local ? "앱이" : "서버가"} 자동으로 만드는 문서입니다(위키 목차·작업 기록). 직접 고칠 수 없고, 위키가 바뀌면 다시 만들어집니다.
              </div>
            )}
            {error && (
              <div className="banner info" onClick={() => setError(null)}>
                {error}
              </div>
            )}
            {conflict && (
              <div className="banner conflict">
                {conflict.currentHash === null
                  ? "이 문서는 다른 곳에서 삭제되었습니다."
                  : local
                    ? "이 문서는 다른 곳(동기화·다른 편집기)에서 먼저 수정되었습니다. 덮어쓰지 않았습니다."
                    : "이 문서는 다른 곳(다른 탭이나 에이전트)에서 먼저 수정되었습니다. 덮어쓰지 않았습니다."}
                <button onClick={saveConflictCopy}>내 변경을 사본으로 저장</button>
                {conflict.currentHash !== null && (
                  <button
                    onClick={async () => (await confirmDialog(`내 변경을 버리고 ${local ? "저장된" : "서버"} 버전을 불러올까요?`, "불러오기")) && load(doc.path)}
                  >
                    {local ? "저장된 버전 불러오기" : "서버 버전 불러오기"}
                  </button>
                )}
              </div>
            )}
            {revision && (
              <div className="banner revision">
                {revision.commit.rev.slice(0, 7)} · {revision.commit.author} ·{" "}
                {new Date(revision.commit.date).toLocaleString()} 버전을 보는 중
                {revision.content !== null && <button onClick={rollback}>이 버전으로 되돌리기</button>}
                <button onClick={() => setRevision(null)}>닫기</button>
              </div>
            )}

            {propsOpen && !revision && (
              <Properties content={doc.draft} stats={propStats} readOnly={doc.generated} onChange={(next) => editorHandle.current?.setContent(next)} />
            )}
            <div className={`panes mode-${revision ? "preview" : mode}`}>
              <div className="pane edit-pane">
                <Editor
                  docKey={`${doc.path}#${doc.seq}`}
                  initial={doc.draft}
                  onChange={(draft) => setDoc((prev) => (prev ? { ...prev, draft } : prev))}
                  onSave={save}
                  linkCandidates={() => linkCandidates}
                  handle={editorHandle}
                  onFiles={uploadFiles}
                  live={live}
                  readOnly={doc.generated}
                />
              </div>
              <div className="pane preview-pane" onClick={onPreviewClick}>
                <div className="markdown-body" ref={previewRef} dangerouslySetInnerHTML={{ __html: rendered.html }} />
                {widgetSlots.map((el, i) =>
                  rendered.widgets[i] === undefined
                    ? null
                    : createPortal(
                        <Widget source={rendered.widgets[i]} onOpen={open} onChanged={onWidgetChanged} />,
                        el,
                        `${i}:${rendered.widgets[i]}`,
                      ),
                )}
                {!revision && refs && (
                  <References
                    refs={refs}
                    onOpen={(p, anchor) => {
                      if (anchor) setPendingAnchor({ path: p, ...(anchor.startsWith("^") ? { block: anchor.slice(1) } : { heading: anchor.toLowerCase() }) });
                      void open(p);
                    }}
                  />
                )}
                {!revision && doc.path && !doc.generated && (
                  <section className="backlinks mentions-wrap">
                    <UnlinkedMentions path={doc.path} target={mentionTarget(doc.path, resolver)} version={vaultVersion} onOpen={(p) => void open(p)} onChanged={vaultChanged} />
                  </section>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            <button className="nav-toggle empty-nav" aria-label="문서 목록" onClick={() => setNavOpen(true)}>
              ☰ 문서 목록
            </button>
            {error && <div className="banner info">{error}</div>}
            <p>왼쪽에서 문서를 고르거나 ＋ 로 새 문서를 만드세요.</p>
            {local && <p className="meta">문서는 이 기기에 저장되며 서버 없이도 쓸 수 있습니다. 서버와 맞추려면 ⇅ 를 누르세요.</p>}
          </div>
        )}
      </main>

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
            open(p);
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
            open(p);
          }}
        />
      )}
      {lintOpen && (
        <LintPanel
          folders={folderPaths(tree)}
          onClose={() => setLintOpen(false)}
          onOpen={(p) => {
            setLintOpen(false);
            open(p);
          }}
        />
      )}

      {syncOpen && localContext && (
        <SyncPanel
          ctx={localContext}
          onClose={() => setSyncOpen(false)}
          onOpen={(p) => {
            setSyncOpen(false);
            open(p);
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
              open(openPath);
            }
          }}
        />
      )}

      {outlineOpen && doc && (
        <aside className="history outline">
          <div className="sidebar-head">
            <strong>개요</strong>
          </div>
          <ol>
            {outline.map((h) => (
              <li key={h.line} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
                <button
                  onClick={() => {
                    editorHandle.current?.gotoLine(h.line);
                    scrollToAnchor({ heading: h.text.toLowerCase() });
                  }}
                >
                  <span className="msg">{h.text}</span>
                </button>
              </li>
            ))}
            {outline.length === 0 && <li className="meta">제목이 없습니다.</li>}
          </ol>
        </aside>
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
      {palette && (
        <Palette
          key={palette}
          placeholder={
            palette === "files" ? "문서 이름으로 열기 (Ctrl+Enter: 새 탭)" : palette === "commands" ? "명령" : `템플릿 (${noteSettings.templateFolder} 폴더)`
          }
          items={
            palette === "files"
              ? fileItems
              : palette === "commands"
                ? commandItems
                : templatePaths.map((p) => ({
                    id: p,
                    label: p.split("/").pop()!.replace(/\.md$/i, ""),
                    detail: p,
                    run: () => void (palette === "templates" ? insertTemplate(p) : createFromTemplate(p)),
                  }))
          }
          hint={palette === "files" ? "↑↓ 고르기 · Enter 열기 · Ctrl+Enter 새 탭 · Esc 닫기" : "↑↓ 고르기 · Enter 실행 · Esc 닫기"}
          onClose={() => setPalette(null)}
        />
      )}
      {settingsOpen && (
        <NoteSettingsDialog
          value={noteSettings}
          onSave={(v) => {
            setNoteSettings(v);
            saveNoteSettings(v);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {historyOpen && doc && (
        <aside className="history">
          <div className="sidebar-head">
            <strong>변경 이력</strong>
          </div>
          <ol>
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
        </aside>
      )}
    </div>
  );
}
