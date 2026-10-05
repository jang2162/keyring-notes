import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, type CommitInfo, type SearchHit, type TreeNode } from "./api";
import { Editor, type EditorHandle, type LinkCandidate } from "./Editor";
import { ClipPage, IngestDialog } from "./Ingest";
import { invalidateWidgets, Widget } from "./Widget";
import { Login } from "./Login";
import { LinkResolver, renderMarkdown } from "./markdown";

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

function conflictCopyPath(path: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return path.replace(/\.md$/i, ` (충돌 사본 ${stamp}).md`);
}

function TreeView({
  nodes,
  current,
  onOpen,
}: {
  nodes: TreeNode[];
  current: string | null;
  onOpen: (path: string) => void;
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
                onOpen(n.path);
              }}
            >
              {n.name.replace(/\.md$/i, "")}
            </a>
          </li>
        ) : (
          <li key={n.path}>
            <a href={api.rawUrl(n.path)} className="file attachment" target="_blank" rel="noreferrer">
              {n.name}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

export function App() {
  const [auth, setAuth] = useState({ ready: false, ok: false, wasIn: false, passwordSet: true });

  const checkAuth = useCallback(async () => {
    try {
      const s = await api.status();
      const ok = s.authenticated && s.principal?.kind === "owner";
      setAuth((a) => ({ ready: true, ok, wasIn: a.wasIn || ok, passwordSet: s.passwordSet }));
    } catch {
      setAuth((a) => ({ ...a, ready: true, ok: false }));
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
    return auth.ok ? <ClipPage /> : <Login passwordSet={auth.passwordSet} onDone={checkAuth} />;
  }
  // 세션이 끊겨도 작업 화면은 남겨 두어 저장하지 않은 내용을 잃지 않게 한다.
  return (
    <>
      {(auth.ok || auth.wasIn) && (
        <Workspace
          onLogout={() =>
            api.logout().finally(() => {
              setAuth((a) => ({ ...a, wasIn: false }));
              void checkAuth();
            })
          }
        />
      )}
      {!auth.ok && <Login passwordSet={auth.passwordSet} onDone={checkAuth} />}
    </>
  );
}

function Workspace({ onLogout }: { onLogout: () => void }) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [mode, setMode] = useState<ViewMode>("split");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [revision, setRevision] = useState<RevisionView | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [backlinks, setBacklinks] = useState<{ path: string; title: string }[]>([]);
  /** 볼트 내용이 바뀔 때마다 올려 태그·백링크·위젯을 다시 불러온다. */
  const [vaultVersion, setVaultVersion] = useState(0);
  const editorHandle = useRef<EditorHandle | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [widgetSlots, setWidgetSlots] = useState<HTMLElement[]>([]);
  const [ingestOpen, setIngestOpen] = useState(false);
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
    setVaultVersion((v) => v + 1);
    // 위키 index·log를 열어 두었다면 서버가 새로 만든 내용으로 바꾼다.
    const cur = docRef.current;
    if (cur?.generated) setTimeout(() => void load(cur.path), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.tags().then(setTags).catch(() => undefined);
  }, [vaultVersion]);

  useEffect(() => {
    if (!doc?.path) return setBacklinks([]);
    api.backlinks(doc.path).then(setBacklinks).catch(() => setBacklinks([]));
  }, [doc?.path, vaultVersion]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    const t = setTimeout(() => {
      api.search(q).then(setHits).catch((e) => {
        setHits([]);
        report(e);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query, vaultVersion]);

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
      }));
      setConflict(null);
      setRevision(null);
      setError(null);
      if (pathFromLocation() !== d.path) history.replaceState(null, "", `#/${encodeURIComponent(d.path)}`);
    } catch (e) {
      report(e);
    }
  }, []);

  const open = useCallback(
    (path: string) => {
      if (dirty && !confirm("저장하지 않은 변경이 있습니다. 버리고 이동할까요?")) return;
      void load(path);
    },
    [dirty, load],
  );

  useEffect(() => {
    void refreshTree();
    const initial = pathFromLocation();
    if (initial) void load(initial);
  }, [refreshTree, load]);

  useEffect(() => {
    const onHash = () => {
      const p = pathFromLocation();
      if (p && p !== doc?.path) open(p);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [doc?.path, open]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!historyOpen || !doc) return;
    api.history(doc.path).then(setCommits).catch(report);
  }, [historyOpen, doc?.path, doc?.hash]);

  const save = useCallback(async () => {
    if (!doc || saving || doc.generated || doc.draft === doc.saved) return;
    setSaving(true);
    const content = doc.draft;
    try {
      const d = await api.write(doc.path, content, doc.hash);
      // 저장하는 동안 더 입력한 내용(draft)은 그대로 둔다.
      setDoc((prev) => (prev && prev.path === d.path ? { ...prev, saved: content, hash: d.hash } : prev));
      setConflict(null);
      setError(null);
      vaultChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict({ currentHash: e.currentHash ?? null });
      else report(e);
    } finally {
      setSaving(false);
    }
  }, [doc, saving, vaultChanged]);

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
    const input = prompt("새 문서 경로 (.md 생략 가능)", dir);
    if (!input) return;
    const path = /\.md$/i.test(input) ? input : `${input}.md`;
    const title = path.split("/").pop()!.replace(/\.md$/i, "");
    try {
      await api.write(path, `# ${title}\n`, null);
      vaultChanged();
      await refreshTree();
      open(path);
    } catch (e) {
      report(e);
    }
  };

  const moveDoc = async () => {
    if (!doc) return;
    if (dirty) return setError("먼저 저장한 뒤 이동하세요.");
    const input = prompt("새 경로", doc.path);
    if (!input || input === doc.path) return;
    const to = /\.md$/i.test(input) ? input : `${input}.md`;
    try {
      const d = await api.move(doc.path, to, doc.hash);
      vaultChanged();
      await refreshTree();
      await load(d.path);
    } catch (e) {
      report(e);
    }
  };

  const deleteDoc = async () => {
    if (!doc || !confirm(`"${doc.path}" 문서를 삭제할까요? (이력에서 되돌릴 수 있습니다)`)) return;
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
    if (dirty && !confirm("저장하지 않은 변경을 버리고 이 버전으로 되돌릴까요?")) return;
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
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wikilink]");
    if (!a) return;
    e.preventDefault();
    const target = a.dataset.wikilink!;
    if (a.dataset.resolved === "1") {
      if (target.toLowerCase().endsWith(".md")) open(target);
      else window.open(api.rawUrl(target), "_blank", "noreferrer");
    } else if (confirm(`"${target}" 문서가 없습니다. 새로 만들까요?`)) {
      const path = /\.md$/i.test(target) ? target : `${target}.md`;
      api
        .write(path, `# ${path.split("/").pop()!.replace(/\.md$/i, "")}\n`, null)
        .then(refreshTree)
        .then(() => open(path))
        .catch(report);
    }
  };

  const previewSource = revision ? (revision.content ?? "") : (doc?.draft ?? "");
  const rendered = useMemo(
    () => (doc ? renderMarkdown(previewSource, { resolver, docPath: doc.path }) : { html: "", widgets: [] }),
    [previewSource, resolver, doc?.path],
  );

  // innerHTML이 바뀐 뒤 위젯 자리를 찾아 React 포털로 위젯을 그린다.
  useLayoutEffect(() => {
    setWidgetSlots(Array.from(previewRef.current?.querySelectorAll<HTMLElement>(".widget-slot") ?? []));
  }, [rendered.html]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <strong>Keyring Notes</strong>
          <span>
            <button onClick={createDoc} title="새 문서">＋</button>{" "}
            <button onClick={() => setIngestOpen(true)} title="원본 수집(파일·URL·붙여넣기)">
              📥
            </button>{" "}
            <button onClick={() => (!dirty || confirm("저장하지 않은 변경이 있습니다. 로그아웃할까요?")) && onLogout()} title="로그아웃">
              ⎋
            </button>
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
                  <span className="hit-title">{h.title}</span>
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
            <header className="toolbar">
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
            </header>

            {doc.generated && (
              <div className="banner generated">
                서버가 자동으로 만드는 문서입니다(위키 목차·작업 기록). 직접 고칠 수 없고, 위키가 바뀌면 다시 만들어집니다.
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
                  : "이 문서는 다른 곳(다른 탭이나 에이전트)에서 먼저 수정되었습니다. 덮어쓰지 않았습니다."}
                <button onClick={saveConflictCopy}>내 변경을 사본으로 저장</button>
                {conflict.currentHash !== null && (
                  <button
                    onClick={() => confirm("내 변경을 버리고 서버 버전을 불러올까요?") && load(doc.path)}
                  >
                    서버 버전 불러오기
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

            <div className={`panes mode-${revision ? "preview" : mode}`}>
              <div className="pane edit-pane">
                <Editor
                  docKey={`${doc.path}#${doc.seq}`}
                  initial={doc.draft}
                  onChange={(draft) => setDoc((prev) => (prev ? { ...prev, draft } : prev))}
                  onSave={save}
                  linkCandidates={() => linkCandidates}
                  handle={editorHandle}
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
                {!revision && (
                  <section className="backlinks">
                    <h4>백링크 {backlinks.length}</h4>
                    {backlinks.length === 0 ? (
                      <p className="meta">이 문서를 링크한 문서가 없습니다.</p>
                    ) : (
                      <ul>
                        {backlinks.map((b) => (
                          <li key={b.path}>
                            <a
                              href={`#/${encodeURIComponent(b.path)}`}
                              onClick={(e) => {
                                e.preventDefault();
                                open(b.path);
                              }}
                            >
                              {b.title}
                            </a>{" "}
                            <span className="meta">{b.path}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            {error && <div className="banner info">{error}</div>}
            <p>왼쪽에서 문서를 고르거나 ＋ 로 새 문서를 만드세요.</p>
          </div>
        )}
      </main>

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
