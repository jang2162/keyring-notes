import { useEffect, useState, type FormEvent } from "react";
import type { SyncReport } from "@keyring-notes/core";
import { confirmDialog } from "./dialog";
import type { LocalContext } from "./local/boot";
import { defaultDeviceName, type SyncStatus } from "./local/syncController";

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function useSyncStatus(ctx: LocalContext | null): SyncStatus | null {
  const [s, setS] = useState<SyncStatus | null>(() => ctx?.sync.get() ?? null);
  useEffect(() => (ctx ? ctx.sync.subscribe(setS) : undefined), [ctx]);
  return s;
}

function Report({ r, onOpen }: { r: SyncReport; onOpen: (p: string) => void }) {
  const link = (p: string) => (
    <a
      href={`#/${encodeURIComponent(p)}`}
      onClick={(e) => {
        e.preventDefault();
        if (p.toLowerCase().endsWith(".md")) onOpen(p);
      }}
    >
      {p}
    </a>
  );
  const merged = r.merged ?? [];
  const total = r.pulled.length + r.pushed.length + r.deletedLocal.length + r.deletedRemote.length + r.conflicts.length + merged.length;
  return (
    <div className="sync-report">
      <p className="meta">
        {new Date(r.finishedAt).toLocaleString()} · 받음 {r.pulled.length} · 보냄 {r.pushed.length} · 지움 {r.deletedLocal.length + r.deletedRemote.length} · 자동 병합 {merged.length} · 충돌 {r.conflicts.length}
      </p>
      {total === 0 && r.errors.length === 0 && <p className="note-ok">이 기기와 서버가 같습니다.</p>}
      {merged.length > 0 && (
        <p className="note-ok">
          양쪽에서 서로 다른 부분을 고친 문서를 자동으로 합쳤습니다: {merged.map((p, i) => <span key={p}>{i > 0 && ", "}{link(p)}</span>)}. 이력에서 되돌릴 수 있습니다.
        </p>
      )}
      {r.conflicts.length > 0 && (
        <div className="banner conflict">
          양쪽에서 같은 부분을 다르게 고친 문서가 있어 덮어쓰지 않았습니다. 원래 문서는 서버 버전이고, 이 기기에서 고친 내용은 사본으로 남겼습니다.
          <ul>
            {r.conflicts.map((c) => (
              <li key={c.copy}>
                {link(c.path)} → {link(c.copy)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.errors.length > 0 && (
        <ul className="form-error">
          {r.errors.map((e) => (
            <li key={e.path}>
              {e.path}: {e.message}
            </li>
          ))}
        </ul>
      )}
      {r.skipped.length > 0 && (
        <details>
          <summary className="meta">건너뜀 {r.skipped.length}</summary>
          <ul>
            {r.skipped.map((s) => (
              <li key={s.path} className="meta">
                {s.path}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** 이 기기의 볼트와 (선택) 서버 동기화 설정. */
export function SyncPanel({ ctx, onClose, onOpen }: { ctx: LocalContext; onClose: () => void; onOpen: (p: string) => void }) {
  const status = useSyncStatus(ctx)!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = status.settings;

  const connect = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const get = (n: string) => (f.namedItem(n) as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    try {
      await ctx.sync.connect(get("server"), get("password"), get("device").trim() || defaultDeviceName());
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin" role="dialog" aria-label="이 기기와 동기화">
      <div className="admin-head">
        <strong>이 기기 · 동기화</strong>
        <nav />
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="admin-body">
        <section>
          <h3>이 기기의 볼트</h3>
          <p className="meta">
            문서는 {ctx.kind === "app" ? "이 기기의 폴더" : "이 브라우저(IndexedDB)"}에 마크다운으로 저장되며, 서버에 연결하지 않아도 모든 편집·검색·위젯·이력을 쓸 수
            있습니다.
          </p>
          {ctx.vaultDir && (
            <p>
              <code className="vault-dir">{ctx.vaultDir}</code>{" "}
              {ctx.chooseFolder && (
                <button onClick={() => ctx.chooseFolder!().catch((e) => setError(msg(e)))} title="Obsidian 볼트 폴더도 열 수 있습니다">
                  다른 폴더 열기
                </button>
              )}
            </p>
          )}
        </section>

        <section>
          <h3>서버 동기화 (선택)</h3>
          {error && (
            <p className="form-error" onClick={() => setError(null)}>
              {error}
            </p>
          )}
          {!s ? (
            <form className="sync-form" onSubmit={connect}>
              <p className="meta">자체 호스팅한 Keyring Notes 서버와 이 기기의 문서를 맞춥니다. 양쪽에서 다르게 고친 문서는 덮어쓰지 않고 사본으로 남깁니다.</p>
              <label>
                서버 주소
                <input name="server" placeholder="https://notes.example.com" required autoComplete="url" inputMode="url" />
              </label>
              <label>
                이 기기 이름
                <input name="device" defaultValue={defaultDeviceName()} maxLength={40} />
              </label>
              <label>
                서버 비밀번호
                <input name="password" type="password" required autoComplete="current-password" />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "연결 중…" : "연결하고 동기화"}
              </button>
            </form>
          ) : (
            <>
              <p>
                <strong>{s.server}</strong> · {s.device}
                <br />
                <span className="meta">
                  {status.running ? "동기화 중…" : status.lastSync ? `마지막 동기화 ${new Date(status.lastSync).toLocaleString()}` : "아직 동기화하지 않았습니다"}
                </span>
              </p>
              {status.lastError && <p className="form-error">{status.lastError}</p>}
              <p className="sync-actions">
                <button disabled={status.running} onClick={() => void ctx.sync.run()}>
                  지금 동기화
                </button>
                <label>
                  <input type="checkbox" checked={s.auto} onChange={(e) => ctx.sync.setAuto(e.target.checked)} /> 자동(열 때·저장 뒤·5분마다)
                </label>
                <button
                  onClick={async () =>
                    (await confirmDialog("서버 연결을 끊을까요? 이 기기의 문서는 그대로 남고, 다시 연결하면 그때 맞춥니다.", "연결 끊기")) && ctx.sync.disconnect()
                  }
                >
                  연결 끊기
                </button>
              </p>
              {status.lastReport && <Report r={status.lastReport} onOpen={onOpen} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
