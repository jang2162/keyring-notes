import { diffLines } from "diff";
import { useCallback, useEffect, useState } from "react";
import { api, review, type LintKind, type LintReport, type Proposal, type ProposalSummary } from "./api";
import { Modal, useCloseGuard } from "./Modal";
import { promptDialog } from "./dialog";
import { errorText } from "./toast";
import { fmtDateTime, t } from "./i18n";

const msg = errorText;

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
      rows.push({ kind: "fold", text: t("review.unchanged", { count: lines.length - head.length - tail.length }) });
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
  const [savedPaths, setSavedPaths] = useState("");
  const pathsDirty = paths.trim() !== savedPaths.trim();

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
      .then((s) => {
        setPaths(s.reviewPaths.join("\n"));
        setSavedPaths(s.reviewPaths.join("\n"));
      })
      .catch(() => undefined);
  }, [load]);

  const decide = async (p: ProposalSummary | Proposal, approve: boolean) => {
    try {
      if (approve) await review.approve(p.id);
      else {
        const reason = await promptDialog(t("review.rejectReason"), "", t("review.reject"));
        if (reason === null) return;
        await review.reject(p.id, reason);
      }
      setNote({ ok: true, text: approve ? t("review.approved", { message: p.message }) : t("review.rejected", { message: p.message }) });
      setOpen(null);
      await load();
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: approve ? t("review.approveFailed", { message: msg(e) }) : msg(e) });
      await load();
    }
  };

  const pending = list.filter((p) => p.status === "pending");
  const done = list.filter((p) => p.status !== "pending");

  return (
    <Modal
      title={t("tool.review")}
      onClose={onClose}
      head={
        <div className="kmodal-tabs" role="tablist">
          <button className={tab === "pending" ? "on" : ""} onClick={() => setTab("pending")}>
            {t("review.pending", { count: pending.length })}
          </button>
          <button className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>
            {t("review.done")}
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            {t("review.targets")}
          </button>
        </div>
      }
    >
      <PathsGuard dirty={pathsDirty} />
      <div className="admin-body">
        {note && (
          <p className={note.ok ? "note-ok" : "form-error"} onClick={() => setNote(null)}>
            {note.text}
          </p>
        )}
        {tab === "settings" && (
          <div>
            <p className="meta">{t("review.targetsHint")}</p>
            <textarea className="paths-input" rows={6} value={paths} onChange={(e) => setPaths(e.target.value)} aria-label={t("review.targets")} placeholder={t("review.targetsPlaceholder")} />
            <div className="agent-actions">
              <button
                className="on"
                onClick={async () => {
                  try {
                    const r = await review.saveSettings(paths.split("\n").map((s) => s.trim()).filter(Boolean));
                    setPaths(r.reviewPaths.join("\n"));
                    setSavedPaths(r.reviewPaths.join("\n"));
                    setNote({ ok: true, text: r.reviewPaths.length ? t("review.targetsSaved", { list: r.reviewPaths.join(", ") }) : t("review.targetsNone") });
                  } catch (e) {
                    setNote({ ok: false, text: msg(e) });
                  }
                }}
              >
                {t("common.save")}
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
                    {p.stale && <span className="badge warn">{t("review.stale")}</span>}
                    {p.status !== "pending" && <span className={`badge ${p.status === "approved" ? "" : "muted"}`}>{p.status === "approved" ? t("review.statusApproved") : t("review.statusRejected")}</span>}
                  </span>
                  <span className="meta">
                    {p.agent} · {fmtDateTime(p.createdAt)} · {p.files.map((f) => `${t(`review.change.${f.change}`)} ${f.path.split("/").pop()}`).join(", ")}
                    {p.reason && ` · ${t("review.reason", { reason: p.reason })}`}
                  </span>
                </button>
              </li>
            ))}
            {(tab === "pending" ? pending : done).length === 0 && <li className="meta">{tab === "pending" ? t("review.noPending") : t("review.noDone")}</li>}
          </ul>
        )}
        {open && (
          <div>
            <div className="agent-actions">
              <button onClick={() => setOpen(null)}>← {t("review.list")}</button>
              <span className="spacer" />
              {open.status === "pending" && (
                <>
                  <button className="on" onClick={() => decide(open, true)}>
                    {t("review.approve")}
                  </button>
                  <button onClick={() => decide(open, false)}>{t("review.reject")}</button>
                </>
              )}
            </div>
            <h4>{open.message}</h4>
            <p className="meta">
              {open.agent} · {fmtDateTime(open.createdAt)}
              {open.status !== "pending" && ` · ${open.status === "approved" ? t("review.statusApproved") : t("review.statusRejected")}: ${open.decidedBy} ${fmtDateTime(open.decidedAt!)}`}
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
                  <span className="meta">{f.beforeHash === null ? t("review.newFile") : f.afterHash === null ? t("review.change.delete") : t("review.change.modify")}</span>
                </div>
                {f.binary ? <p className="meta">{t("review.binary")}</p> : <DiffView before={f.before} after={f.after} />}
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PathsGuard({ dirty }: { dirty: boolean }) {
  useCloseGuard(dirty ? { kind: "confirm", reason: t("review.targetsUnsaved") } : null);
  return null;
}

const LINT_KINDS: LintKind[] = ["broken_link", "broken_source", "missing_frontmatter", "no_sources", "orphan", "stale", "unprocessed_raw", "daily_mismatch"];

/** 정리 점검 설명: 종류와 끼워 넣을 값으로 화면 언어 글을 만든다 */
function lintDetail(i: LintReport["issues"][number]): string {
  const p = { ...(i.params ?? {}), target: i.target ?? "" };
  if (i.kind === "broken_source" && i.params?.anchor) return t(String(i.params.anchor).startsWith("^") ? "lint.d.brokenBlock" : "lint.d.brokenHeading", p);
  return t(`lint.d.${i.kind}`, p);
}

/** 구조적 정리(W7) 결과. */
/** initialFolder: 처음 점검할 범위(지금 워크스페이스, ""면 볼트 전체) */
export function LintPanel({ folders, initialFolder = "", onClose, onOpen }: { folders: string[]; initialFolder?: string; onClose: () => void; onOpen: (p: string) => void }) {
  const [folder, setFolder] = useState(initialFolder);
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
    void run(initialFolder);
  }, [run, initialFolder]);
  const groups = report ? LINT_KINDS.map((k) => [k, report.issues.filter((i) => i.kind === k)] as const).filter(([, l]) => l.length) : [];
  return (
    <Modal
      title={t("tool.lint")}
      onClose={onClose}
      head={
        <>
          <select value={folder} aria-label={t("lint.scope")} onChange={(e) => setFolder(e.target.value)}>
            <option value="">{t("lint.wholeVault")}</option>
            {folders
              .filter((f) => f.split("/").length <= 2)
              .map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
          </select>
          <button disabled={busy} onClick={() => run(folder)}>
            {busy ? t("lint.running") : t("lint.run")}
          </button>
        </>
      }
    >
      <div className="admin-body">
        {error && <p className="form-error">{error}</p>}
        {report && (
          <>
            <p className="meta">{t("lint.summary", { date: fmtDateTime(report.checkedAt), scope: report.folder ?? t("lint.wholeVault"), count: report.issues.length })}</p>
            {groups.length === 0 && <p className="note-ok">{t("lint.none")}</p>}
            {groups.map(([k, issues]) => (
              <details key={k} className="lint-group" open={issues.length <= 20}>
                <summary>
                  {t(`lint.k.${k}`)} <span className="count">{issues.length}</span>
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
                      <span className="meta">{lintDetail(i)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
