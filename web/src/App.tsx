import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { api, ApiError, type CommitInfo, type TreeNode } from "./api";
import { Editor } from "./Editor";
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

  const resolver = useMemo(() => new LinkResolver(tree), [tree]);
  const dirty = doc !== null && doc.draft !== doc.saved;

  const refreshTree = useCallback(() => api.tree().then(setTree).catch((e) => setError(String(e.message ?? e))), []);

  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const load = useCallback(async (path: string) => {
    try {
      const d = await api.read(path);
      setDoc((prev) => ({ path: d.path, saved: d.content, hash: d.hash, draft: d.content, seq: (prev?.seq ?? 0) + 1 }));
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
    if (!doc || saving || doc.draft === doc.saved) return;
    setSaving(true);
    const content = doc.draft;
    try {
      const d = await api.write(doc.path, content, doc.hash);
      // 저장하는 동안 더 입력한 내용(draft)은 그대로 둔다.
      setDoc((prev) => (prev && prev.path === d.path ? { ...prev, saved: content, hash: d.hash } : prev));
      setConflict(null);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict({ currentHash: e.currentHash ?? null });
      else report(e);
    } finally {
      setSaving(false);
    }
  }, [doc, saving]);

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
      await load(doc.path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError("그 사이 문서가 바뀌었습니다. 다시 불러온 뒤 시도하세요.");
      else report(e);
    }
  };

  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
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
  const previewHtml = useMemo(
    () => (doc ? renderMarkdown(previewSource, { resolver, docPath: doc.path }) : ""),
    [previewSource, resolver, doc?.path],
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <strong>Keyring Notes</strong>
          <span>
            <button onClick={createDoc} title="새 문서">＋</button>{" "}
            <button onClick={() => (!dirty || confirm("저장하지 않은 변경이 있습니다. 로그아웃할까요?")) && onLogout()} title="로그아웃">
              ⎋
            </button>
          </span>
        </div>
        <TreeView nodes={tree} current={doc?.path ?? null} onOpen={open} />
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
              <button onClick={save} disabled={!dirty || saving}>
                {saving ? "저장 중…" : "저장"}
              </button>
              <button onClick={moveDoc}>이동</button>
              <button onClick={deleteDoc}>삭제</button>
              <button className={historyOpen ? "on" : ""} onClick={() => setHistoryOpen((v) => !v)}>
                이력
              </button>
            </header>

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
                />
              </div>
              <div
                className="pane preview-pane markdown-body"
                onClick={onPreviewClick}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </>
        ) : (
          <div className="empty">
            {error && <div className="banner info">{error}</div>}
            <p>왼쪽에서 문서를 고르거나 ＋ 로 새 문서를 만드세요.</p>
          </div>
        )}
      </main>

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
