import { useEffect, useState, type FormEvent } from "react";
import type { SyncReport } from "@keyring-notes/core";
import { confirmDialog } from "./dialog";
import { useCloseGuard } from "./Modal";
import type { LocalContext } from "./local/boot";
import { defaultDeviceName, type SyncStatus } from "./local/syncController";
import { fmtDateTime, t } from "./i18n";
import { errorText } from "./toast";
import { isSynced, setLocalOverride, type SyncedKey } from "./prefs";
import { SOLO } from "./soloWindow";

const msg = errorText;

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
        {fmtDateTime(r.finishedAt)} ·{" "}
        {t("sync.report.counts", {
          pulled: r.pulled.length,
          pushed: r.pushed.length,
          deleted: r.deletedLocal.length + r.deletedRemote.length,
          merged: merged.length,
          conflicts: r.conflicts.length,
        })}
      </p>
      {total === 0 && r.errors.length === 0 && (r.settingsConflicts ?? []).length === 0 && <p className="note-ok">{t("sync.report.same")}</p>}
      {merged.length > 0 && (
        <p className="note-ok">
          {t("sync.report.merged")}{" "}
          {merged.map((p, i) => (
            <span key={p}>
              {i > 0 && ", "}
              {link(p)}
            </span>
          ))}
        </p>
      )}
      <SettingsConflicts list={r.settingsConflicts ?? []} />
      {r.conflicts.length > 0 && (
        <div className="banner conflict">
          {t("sync.report.conflicts")}
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
          <summary className="meta">{t("sync.report.skipped", { count: r.skipped.length })}</summary>
          <ul>
            {r.skipped.map((s) => (
              <li key={s.path} className="meta">
                {s.path}: {t(`sync.skip.${s.reason}`)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * 공통 설정 파일에서 양쪽이 같은 키를 다르게 바꾼 것: 서버 값을 따랐다고 알리고,
 * 화면 설정(ui.*)이면 이 기기 값을 "이 기기에서만 다르게"로 남길지 묻는다.
 */
function SettingsConflicts({ list }: { list: { key: string[]; local: unknown; server: unknown }[] }) {
  const [kept, setKept] = useState<Set<string>>(new Set());
  if (list.length === 0) return null;
  const show = (v: unknown) => (v === undefined ? t("common.none") : typeof v === "string" ? v : JSON.stringify(v));
  return (
    <div className="banner info">
      {t("sync.report.settings")}
      <ul>
        {list.map((c) => {
          const id = c.key.join(".");
          const ui = c.key.length === 2 && c.key[0] === "ui" && isSynced(c.key[1] as SyncedKey) ? (c.key[1] as SyncedKey) : null;
          return (
            <li key={id}>
              <code>{id}</code>: {t("sync.report.settingValues", { server: show(c.server), local: show(c.local) })}{" "}
              {ui &&
                c.local !== undefined &&
                (kept.has(id) ? (
                  <span className="meta">{t("sync.report.kept")}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalOverride(ui, true, c.local);
                      setKept((s) => new Set(s).add(id));
                    }}
                  >
                    {t("sync.report.keepDevice")}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 이 기기의 볼트와 (선택) 서버 동기화 설정(설정 모달의 "이 기기·동기화" 묶음). */
export function SyncSettings({ ctx, onOpen }: { ctx: LocalContext; onOpen: (p: string) => void }) {
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
    <div className="sync-settings">
      <SyncGuard busy={busy} />
      <section>
        <h3>{t("sync.vaultTitle")}</h3>
        <p className="meta">{ctx.kind === "app" ? t("sync.vaultHintApp") : t("sync.vaultHintWeb")}</p>
        {ctx.vaultDir && (
          <p>
            <code className="vault-dir">{ctx.vaultDir}</code>{" "}
            {ctx.chooseFolder && <button onClick={() => ctx.chooseFolder!().catch((e) => setError(msg(e)))}>{t("sync.otherFolder")}</button>}
          </p>
        )}
      </section>

      <section>
        <h3>{t("sync.serverTitle")}</h3>
        {error && (
          <p className="form-error" onClick={() => setError(null)}>
            {error}
          </p>
        )}
        {!s ? (
          <form className="sync-form" onSubmit={connect}>
            <p className="meta">{t("sync.serverHint")}</p>
            <label>
              {t("sync.serverUrl")}
              <input name="server" placeholder="https://notes.example.com" required autoComplete="url" inputMode="url" />
            </label>
            <label>
              {t("sync.deviceName")}
              <input name="device" defaultValue={defaultDeviceName()} maxLength={40} />
            </label>
            <label>
              {t("sync.serverPassword")}
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t("sync.connecting") : t("sync.connect")}
            </button>
          </form>
        ) : (
          <>
            <p>
              <strong>{s.server}</strong> · {s.device}
              <br />
              <span className="meta">
                {status.running ? t("sync.running") : status.lastSync ? t("sync.last", { date: fmtDateTime(status.lastSync) }) : t("sync.never")}
              </span>
            </p>
            {status.lastError && <p className="form-error">{status.lastError}</p>}
            {SOLO ? (
              <p className="meta">{t("sync.soloWindow")}</p>
            ) : (
              <p className="sync-actions">
                <button disabled={status.running} onClick={() => void ctx.sync.run()}>
                  {t("sync.now")}
                </button>
                <label>
                  <input type="checkbox" checked={s.auto} onChange={(e) => ctx.sync.setAuto(e.target.checked)} /> {t("sync.auto")}
                </label>
                <button onClick={async () => (await confirmDialog(t("sync.disconnectAsk"), t("sync.disconnect"))) && ctx.sync.disconnect()}>
                  {t("sync.disconnect")}
                </button>
              </p>
            )}
            {status.lastReport && <Report r={status.lastReport} onOpen={onOpen} />}
          </>
        )}
      </section>
    </div>
  );
}

/** 서버에 처음 연결하는 동안은 닫지 않는다 */
function SyncGuard({ busy }: { busy: boolean }) {
  useCloseGuard(busy ? { kind: "block", reason: t("sync.connectingGuard") } : null);
  return null;
}
