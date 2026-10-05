import { diffLines } from "diff";
import { useCallback, useEffect, useState } from "react";
import { api, review, type LintKind, type LintReport, type Proposal, type ProposalSummary } from "./api";

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const CHANGE_LABEL = { add: "추가", modify: "수정", delete: "삭제" } as const;

/** 줄 단위 diff. 바뀌지 않은 긴 구간은 앞뒤 3줄만 남기고 접는다. */
function DiffView({ before, after }: { before: string | null; after: string | null }) {
  const parts = diffLines(before ?? "", after ?? "");
  const rows: { kind: "add" | "del" | "ctx" | "fold"; text: string }[] = [];
  parts.forEach((p, i) => {
    const lines = p.value.replace(/\n$/, "").split("\n");
    if (p.added) lines.forEach((t) => rows.push({ kind: "add", text: t }));
    else if (p.removed) lines.forEach((t) => rows.push({ kind: "del", text: t }));
    else if (lines.length > 8) {
      const head = i === 0 ? [] : lines.slice(0, 3);
      const tail = i === parts.length - 1 ? [] : lines.slice(-3);
      head.forEach((t) => rows.push({ kind: "ctx", text: t }));
      rows.push({ kind: "fold", text: `… 바뀌지 않은 ${lines.length - head.length - tail.length}줄 …` });
      tail.forEach((t) => rows.push({ kind: "ctx", text: t }));
    } else lines.forEach((t) => rows.push({ kind: "ctx", text: t }));
  });
  return (
    <pre className="diff">
      {rows.map((r, i) => (
        <div key={i} className={`diff-${r.kind}`}>
          <span className="diff-sign">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>
          {r.text || " "}
        </div>
      ))}
    </pre>
  );
}

/** 변경 검토 대기열(W5): 에이전트 제안의 diff를 보고 승인·거절. */
export function ReviewPanel({ onClose, onChanged, onOpen }: { onClose: () => void; onChanged: () => void; onOpen: (p: string) => void }) {
  const [tab, setTab] = useState<"pending" | "done" | "settings">("pending");
  const [list, setList] = useState<ProposalSummary[]>([]);
  const [open, setOpen] = useState<Proposal | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [paths, setPaths] = useState("");

  const load = useCallback(async () => {
    try {
      const all = await review.list();
      setList(all);
    } catch (e) {
      setNote({ ok: false, text: msg(e) });
    }
  }, []);
  useEffect(() => {
    void load();
    review
      .settings()
      .then((s) => setPaths(s.reviewPaths.join("\n")))
      .catch(() => undefined);
  }, [load]);

  const decide = async (p: ProposalSummary | Proposal, approve: boolean) => {
    try {
      if (approve) await review.approve(p.id);
      else {
        const reason = prompt("거절 사유(에이전트가 my_proposals로 볼 수 있습니다)", "") ?? undefined;
        if (reason === undefined) return;
        await review.reject(p.id, reason);
      }
      setNote({ ok: true, text: approve ? `승인했습니다: ${p.message}` : `거절했습니다: ${p.message}` });
      setOpen(null);
      await load();
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: approve ? `승인하지 못했습니다: ${msg(e)} — 그 사이 문서가 바뀌었다면 거절하고 에이전트에게 다시 맡기세요.` : msg(e) });
      await load();
    }
  };

  const pending = list.filter((p) => p.status === "pending");
  const done = list.filter((p) => p.status !== "pending");

  return (
    <div className="admin" role="dialog" aria-label="변경 검토">
      <div className="admin-head">
        <strong>변경 검토</strong>
        <nav>
          <button className={tab === "pending" ? "on" : ""} onClick={() => setTab("pending")}>
            대기 {pending.length}
          </button>
          <button className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>
            처리됨
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            검토 대상
          </button>
        </nav>
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="admin-body">
        {note && (
          <p className={note.ok ? "note-ok" : "form-error"} onClick={() => setNote(null)}>
            {note.text}
          </p>
        )}
        {tab === "settings" && (
          <div>
            <p className="meta">
              여기 적은 폴더(한 줄에 하나, <code>/</code>는 볼트 전체)에 에이전트가 쓰면 바로 반영하지 않고 이 대기열에 쌓습니다. 사람이 쓰는 것은 늘 바로 반영됩니다. 권한·충돌 검사는 제안을 받을 때 이미 합니다.
            </p>
            <textarea className="paths-input" rows={6} value={paths} onChange={(e) => setPaths(e.target.value)} placeholder={"경제/wiki\n업무"} />
            <div className="agent-actions">
              <button
                className="on"
                onClick={async () => {
                  try {
                    const r = await review.saveSettings(paths.split("\n").map((s) => s.trim()).filter(Boolean));
                    setPaths(r.reviewPaths.join("\n"));
                    setNote({ ok: true, text: r.reviewPaths.length ? `검토 대상: ${r.reviewPaths.join(", ")}` : "검토 대상이 없습니다(모두 바로 반영)." });
                  } catch (e) {
                    setNote({ ok: false, text: msg(e) });
                  }
                }}
              >
                저장
              </button>
            </div>
          </div>
        )}
        {tab !== "settings" && !open && (
          <ul className="proposal-list">
            {(tab === "pending" ? pending : done).map((p) => (
              <li key={p.id}>
                <button className="proposal-item" onClick={async () => setOpen(await review.get(p.id))}>
                  <span className="proposal-msg">
                    {p.message}
                    {p.stale && <span className="badge warn">문서가 그 사이 바뀜</span>}
                    {p.status !== "pending" && <span className={`badge ${p.status === "approved" ? "" : "muted"}`}>{p.status === "approved" ? "승인" : "거절"}</span>}
                  </span>
                  <span className="meta">
                    {p.agent} · {new Date(p.createdAt).toLocaleString()} · {p.files.map((f) => `${CHANGE_LABEL[f.change]} ${f.path.split("/").pop()}`).join(", ")}
                    {p.reason && ` · 사유: ${p.reason}`}
                  </span>
                </button>
              </li>
            ))}
            {(tab === "pending" ? pending : done).length === 0 && <li className="meta">{tab === "pending" ? "검토할 제안이 없습니다." : "처리한 제안이 없습니다."}</li>}
          </ul>
        )}
        {open && (
          <div>
            <div className="agent-actions">
              <button onClick={() => setOpen(null)}>← 목록</button>
              <span className="spacer" />
              {open.status === "pending" && (
                <>
                  <button className="on" onClick={() => decide(open, true)}>
                    승인하고 반영
                  </button>
                  <button onClick={() => decide(open, false)}>거절</button>
                </>
              )}
            </div>
            <h4>{open.message}</h4>
            <p className="meta">
              {open.agent} · {new Date(open.createdAt).toLocaleString()}
              {open.status !== "pending" && ` · ${open.status === "approved" ? "승인" : "거절"}: ${open.decidedBy} ${new Date(open.decidedAt!).toLocaleString()}`}
            </p>
            {open.preview.map((f) => (
              <section key={f.path} className="diff-file">
                <div className="diff-head">
                  <a
                    href={`#/${encodeURIComponent(f.path)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (f.beforeHash !== null) onOpen(f.path);
                    }}
                  >
                    {f.path}
                  </a>{" "}
                  <span className="meta">{f.beforeHash === null ? "새 파일" : f.afterHash === null ? "삭제" : "수정"}</span>
                </div>
                {f.binary ? <p className="meta">첨부 파일(내용 미리보기 없음)</p> : <DiffView before={f.before} after={f.after} />}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const LINT_LABEL: Record<LintKind, string> = {
  broken_link: "깨진 링크",
  broken_source: "깨진 출처",
  missing_frontmatter: "프런트매터 누락",
  no_sources: "출처 없는 위키 페이지",
  orphan: "고아 위키 페이지",
  stale: "오래된 위키 페이지",
  unprocessed_raw: "아직 반영 안 된 원본",
};

/** 구조적 정리(W7) 결과. */
export function LintPanel({ folders, onClose, onOpen }: { folders: string[]; onClose: () => void; onOpen: (p: string) => void }) {
  const [folder, setFolder] = useState("");
  const [report, setReport] = useState<LintReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (f: string) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.lint(f || undefined));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void run("");
  }, [run]);
  const groups = report ? (Object.keys(LINT_LABEL) as LintKind[]).map((k) => [k, report.issues.filter((i) => i.kind === k)] as const).filter(([, l]) => l.length) : [];
  return (
    <div className="admin" role="dialog" aria-label="정리 점검">
      <div className="admin-head">
        <strong>정리 점검</strong>
        <nav>
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">볼트 전체</option>
            {folders
              .filter((f) => !f.includes("/"))
              .map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
          </select>
          <button disabled={busy} onClick={() => run(folder)}>
            {busy ? "점검 중…" : "점검"}
          </button>
        </nav>
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="admin-body">
        {error && <p className="form-error">{error}</p>}
        {report && (
          <>
            <p className="meta">
              {new Date(report.checkedAt).toLocaleString()} · {report.folder ?? "볼트 전체"} · 문제 {report.issues.length}개. 위키 페이지 규칙(출처·고아·오래됨)은 위키 토픽의 wiki/ 폴더에만 적용합니다.
            </p>
            {groups.length === 0 && <p className="note-ok">문제가 없습니다.</p>}
            {groups.map(([k, issues]) => (
              <details key={k} className="lint-group" open={issues.length <= 20}>
                <summary>
                  {LINT_LABEL[k]} <span className="count">{issues.length}</span>
                </summary>
                <ul>
                  {issues.map((i, n) => (
                    <li key={n}>
                      <a
                        href={`#/${encodeURIComponent(i.path)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onOpen(i.path);
                        }}
                      >
                        {i.path}
                      </a>{" "}
                      <span className="meta">{i.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
