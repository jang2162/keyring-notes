import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  admin,
  automation,
  passkeySupported,
  type AdminStatus,
  type AgentInfo,
  type BackupInfo,
  type BackupSettings,
  type DeliveryInfo,
  type DeviceInfo,
  type JobInfo,
  type Level,
  type PasskeyInfo,
  type RemoteBackupInfo,
  type UpdateInfo,
  type WebhookInfo,
} from "./api";
import { fmtBytes, fmtDate, fmtDateTime, fmtNumber, t } from "./i18n";
import { useCloseGuard } from "./Modal";
import { errorText } from "./toast";
import { tipProps } from "./Tooltip";

const LEVELS: Level[] = ["hidden", "read", "append", "write", "delete"];

function levelLabel(l: Level): string {
  switch (l) {
    case "hidden":
      return t("admin.agents.level.hidden");
    case "read":
      return t("admin.agents.level.read");
    case "append":
      return t("admin.agents.level.append");
    case "write":
      return t("admin.agents.level.write");
    case "delete":
      return t("admin.agents.level.delete");
  }
}

function kindLabel(k: BackupInfo["kind"]): string {
  switch (k) {
    case "auto":
      return t("admin.backup.kind.auto");
    case "manual":
      return t("admin.backup.kind.manual");
    case "pre-restore":
      return t("admin.backup.kind.preRestore");
  }
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fmtDateTime(iso);
}

function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? t("admin.status.uptimeDays", { d, h }) : h ? t("admin.status.uptimeHours", { h, m }) : t("admin.status.uptimeMinutes", { m });
}

/** 메시지의 {이름} 자리에 코드 조각(<code>)을 끼운다. 메시지에는 HTML을 넣지 않는다 */
function withCode(text: string, codes: Record<string, string>): ReactNode {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <code key={i}>{codes[part] ?? part}</code> : part));
}

/** 설정 모달의 "서버" 묶음(소유자만, 로컬 모드에서는 숨김). keywords: 설정 검색이 이 묶음을 찾는 말 */
/** 설정 모달의 "서버" 묶음(이름·검색 낱말은 메시지 키) */
export const SERVER_SECTIONS = [
  { id: "server-status", label: "server.section.status", keywords: "server.section.statusKeywords" },
  { id: "server-agents", label: "server.section.agents", keywords: "server.section.agentsKeywords" },
  { id: "server-devices", label: "server.section.devices", keywords: "server.section.devicesKeywords" },
  { id: "server-backups", label: "server.section.backups", keywords: "server.section.backupsKeywords" },
  { id: "server-automation", label: "server.section.automation", keywords: "server.section.automationKeywords" },
  { id: "server-update", label: "server.section.update", keywords: "server.section.updateKeywords" },
  { id: "server-security", label: "server.section.security", keywords: "server.section.securityKeywords" },
] as const;
export type ServerSection = (typeof SERVER_SECTIONS)[number]["id"];

export function ServerSettings({ section, folders }: { section: ServerSection; folders: string[] }) {
  switch (section) {
    case "server-status":
      return <StatusView />;
    case "server-agents":
      return <AgentsView folders={folders} />;
    case "server-devices":
      return <DevicesView />;
    case "server-backups":
      return <BackupsView />;
    case "server-automation":
      return <AutomationView />;
    case "server-update":
      return <UpdateView />;
    case "server-security":
      return <SecurityView />;
  }
}

function StatusView() {
  const [s, setS] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      admin
        .status()
        .then(setS)
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="form-error">{error}</p>;
  if (!s) return <p className="meta">{t("common.loading")}</p>;
  const diskUsed = s.disk ? 1 - s.disk.freeBytes / s.disk.totalBytes : null;
  const warnings: string[] = [];
  if (!s.security.https && !["localhost", "127.0.0.1"].includes(location.hostname)) warnings.push(t("admin.status.warnHttp"));
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1" && !s.security.allowedHosts?.length) warnings.push(t("admin.status.warnHosts"));
  if (s.backups.lastError) warnings.push(t("admin.status.warnBackupFailed", { error: s.backups.lastError }));
  if (s.storage?.remoteBackups?.lastError) warnings.push(t("admin.status.warnS3Upload", { error: s.storage.remoteBackups.lastError }));
  if (s.storage?.blobs?.pending)
    warnings.push(t("admin.status.warnBlobsPending", { count: s.storage.blobs.pending, error: s.storage.blobs.lastError ?? "" }).trim());
  if (!s.backups.last) warnings.push(t("admin.status.warnNoBackup"));
  if (diskUsed !== null && diskUsed > 0.9) warnings.push(t("admin.status.warnDisk", { percent: Math.round(diskUsed * 100) }));
  return (
    <div>
      {warnings.length > 0 && (
        <ul className="admin-warnings">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <div className="stat-grid">
        <Stat
          label={t("admin.status.version")}
          value={s.app.version}
          sub={t("admin.status.versionSub", { node: s.app.node, uptime: duration(s.app.uptimeSec), memory: s.app.memoryMb })}
        />
        <Stat
          label={t("admin.status.notes")}
          value={fmtNumber(s.vault.documents)}
          sub={[
            t("admin.status.files", { count: s.vault.files }),
            fmtBytes(s.vault.bytes),
            t("admin.status.topics", { count: s.vault.topics, wiki: s.vault.wikiTopics.length }),
          ].join(" · ")}
        />
        <Stat
          label={t("admin.status.history")}
          value={t("admin.status.commits", { count: s.history.commits })}
          sub={s.history.last ? t("admin.status.lastCommit", { author: s.history.last.author, date: when(s.history.last.date) }) : "—"}
        />
        <Stat
          label={t("admin.status.disk")}
          value={s.disk ? t("admin.status.free", { size: fmtBytes(s.disk.freeBytes) }) : "—"}
          sub={
            s.disk
              ? t("admin.status.diskSub", { total: fmtBytes(s.disk.totalBytes), history: fmtBytes(s.history.bytes), index: fmtBytes(s.index.bytes) })
              : undefined
          }
        />
        <Stat
          label={t("admin.status.backups")}
          value={s.backups.last ? when(s.backups.last.createdAt) : t("common.none")}
          sub={[
            t("admin.status.backupCount", { count: s.backups.count }),
            s.backups.settings.enabled
              ? t("admin.status.autoEvery", { hours: s.backups.settings.intervalHours, next: when(s.backups.next) })
              : t("admin.status.autoOff"),
          ].join(" · ")}
        />
        {s.storage?.s3 && (
          <Stat
            label="S3"
            value={s.storage.blobs ? t("admin.status.attachments", { count: s.storage.blobs.count }) : t("admin.status.remoteBackup")}
            sub={[
              s.storage.s3,
              s.storage.remoteBackups?.encrypted ? t("admin.status.encrypted") : t("admin.status.notEncrypted"),
              s.storage.blobs
                ? [
                    fmtBytes(s.storage.blobs.bytes),
                    t("admin.status.minSize", { size: fmtBytes(s.storage.blobs.minBytes) }),
                    s.storage.blobs.pending ? t("admin.status.pendingUpload", { count: s.storage.blobs.pending }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null,
              s.storage.remoteBackups?.lastUpload ? t("admin.status.lastUpload", { date: when(s.storage.remoteBackups.lastUpload) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
        <Stat
          label={t("admin.status.agents")}
          value={t("admin.status.agentCount", { count: s.agents.length })}
          sub={s.agents.map((a) => `${a.name}${a.lastUsed ? ` (${when(a.lastUsed)})` : ""}`).join(", ") || "—"}
        />
      </div>
      <dl className="admin-dl">
        <dt>{t("admin.status.vault")}</dt>
        <dd>
          <code>{s.vault.path}</code>
        </dd>
        <dt>{t("admin.status.backupFolder")}</dt>
        <dd>
          <code>{s.backups.dir}</code>
        </dd>
        <dt>{t("admin.status.publicUrl")}</dt>
        <dd>{s.security.publicUrl ?? "—"}</dd>
        <dt>{t("admin.status.connection")}</dt>
        <dd>{s.security.https ? "HTTPS" : "HTTP"}</dd>
      </dl>
      <button onClick={() => void load()}>{t("admin.status.refresh")}</button>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function TokenNotice({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  const url = `${location.origin}/mcp`;
  const snippet = JSON.stringify({ mcpServers: { keyring: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  return (
    <div className="token-notice">
      <p>
        {t("admin.token.intro", { name })} <strong>{t("admin.token.onlyNow")}</strong> {t("admin.token.pasteNow")}
      </p>
      <div className="token-row">
        <code>{token}</code>
        <button onClick={() => copy(token)}>{t("admin.token.copy")}</button>
      </div>
      <p className="meta">{t("admin.token.example")}</p>
      <pre>{snippet}</pre>
      <button onClick={() => copy(snippet)}>{t("admin.token.copyConfig")}</button> <button onClick={onClose}>{t("common.close")}</button>
    </div>
  );
}

/** 데스크톱·모바일 앱 기기. 앱에서 서버 주소와 비밀번호로 연결하면 여기에 생긴다. */
function DevicesView() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      admin
        .devices()
        .then(setDevices)
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const remove = async (d: DeviceInfo) => {
    if (!confirm(t("admin.devices.confirmRemove", { name: d.name }))) return;
    try {
      await admin.removeDevice(d.id);
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div>
      <p className="meta">{t("admin.devices.intro")}</p>
      {error && (
        <p className="form-error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {devices.length === 0 && <p className="meta">{t("admin.devices.empty")}</p>}
      {devices.length > 0 && (
        <table className="widget-table">
          <thead>
            <tr>
              <th>{t("admin.devices.device")}</th>
              <th>{t("admin.devices.registered")}</th>
              <th>{t("admin.devices.lastAccess")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.createdAt ? fmtDateTime(d.createdAt) : "-"}</td>
                <td>{d.lastUsed ? fmtDateTime(d.lastUsed) : "-"}</td>
                <td>
                  <button onClick={() => remove(d)}>{t("admin.devices.disconnect")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AgentsView({ folders }: { folders: string[] }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<{ name: string; token: string } | null>(null);
  // 토큰은 지금만 볼 수 있다: 모르고 닫지 않게
  useCloseGuard(token ? { kind: "confirm", reason: t("admin.agents.tokenGuard", { name: token.name }) } : null);
  const load = useCallback(
    () =>
      admin
        .agents()
        .then(setAgents)
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
    try {
      setToken(await admin.createAgent(input.value.trim()));
      input.value = "";
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div>
      <p className="meta">{t("admin.agents.intro")}</p>
      {error && (
        <p className="form-error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {token && <TokenNotice {...token} onClose={() => setToken(null)} />}
      <form className="inline-form" onSubmit={create}>
        <input name="name" placeholder={t("admin.agents.namePlaceholder")} pattern="[a-z0-9][a-z0-9_\-]{0,63}" required />
        <button type="submit">{t("common.create")}</button>
      </form>
      <datalist id="folder-list">
        <option value="/" />
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {agents.length === 0 && <p className="meta">{t("admin.agents.empty")}</p>}
      {agents.map((a) => (
        <AgentCard key={a.name} agent={a} onToken={setToken} onChanged={load} onError={setError} />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  onToken,
  onChanged,
  onError,
}: {
  agent: AgentInfo;
  onToken: (t: { name: string; token: string }) => void;
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const initial = useMemo(() => Object.entries(agent.rules).map(([path, level]) => ({ path, level })), [agent.rules]);
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(true);
  useCloseGuard(saved ? null : { kind: "confirm", reason: t("admin.agents.unsaved", { name: agent.name }) });
  useEffect(() => {
    setRows(initial);
    setSaved(true);
  }, [initial]);

  const update = (i: number, patch: Partial<{ path: string; level: Level }>) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    setSaved(false);
  };

  const save = async () => {
    const rules: Record<string, Level> = {};
    for (const r of rows) if (r.path.trim()) rules[r.path.trim()] = r.level;
    try {
      await admin.setRules(agent.name, rules);
      setSaved(true);
      onChanged();
    } catch (e) {
      onError(errorText(e));
    }
  };

  return (
    <section className="agent-card">
      <div className="agent-head">
        <strong>{agent.name}</strong>
        <span className="meta">
          {t("admin.agents.meta", {
            created: agent.createdAt ? fmtDate(agent.createdAt) : "—",
            last: agent.lastUsed ? when(agent.lastUsed) : t("admin.agents.noAccess"),
          })}
        </span>
        <span className="spacer" />
        <button
          onClick={async () => {
            if (!confirm(t("admin.agents.confirmRotate", { name: agent.name }))) return;
            try {
              onToken(await admin.rotate(agent.name));
            } catch (e) {
              onError(errorText(e));
            }
          }}
        >
          {t("admin.agents.rotate")}
        </button>
        <button
          onClick={async () => {
            if (!confirm(t("admin.agents.confirmDelete", { name: agent.name }))) return;
            try {
              await admin.removeAgent(agent.name);
              onChanged();
            } catch (e) {
              onError(errorText(e));
            }
          }}
        >
          {t("common.delete")}
        </button>
      </div>
      <table className="rules">
        <thead>
          <tr>
            <th>{t("admin.agents.path")}</th>
            <th>{t("admin.agents.permission")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  list="folder-list"
                  value={r.path}
                  placeholder={t("admin.agents.pathPlaceholder")}
                  onChange={(e) => update(i, { path: e.target.value })}
                />
              </td>
              <td>
                <select value={r.level} onChange={(e) => update(i, { level: e.target.value as Level })}>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  aria-label={t("admin.agents.removeRule")}
                  {...tipProps({ label: t("admin.agents.removeRule") })}
                  onClick={() => {
                    setRows((rs) => rs.filter((_, j) => j !== i));
                    setSaved(false);
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="meta">
                {t("admin.agents.noRules")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="agent-actions">
        <button
          onClick={() => {
            setRows((r) => [...r, { path: "", level: "read" }]);
            setSaved(false);
          }}
        >
          {t("admin.agents.addRule")}
        </button>
        <button className={saved ? "" : "on"} disabled={saved} onClick={save}>
          {saved ? t("admin.agents.saved") : t("common.save")}
        </button>
      </div>
    </section>
  );
}

function BackupsView() {
  const [list, setList] = useState<BackupInfo[]>([]);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useCloseGuard(
    busy
      ? {
          kind: "block",
          reason: busy === "restore" ? t("admin.backup.busyRestore") : busy === "upload" ? t("admin.backup.busyUpload") : t("admin.backup.busy"),
        }
      : null,
  );
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [remote, setRemote] = useState<{ configured: boolean; location?: string; backups: RemoteBackupInfo[]; lastError?: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(
    () =>
      Promise.all([
        admin.backups().then((r) => {
          setList(r.backups);
          setSettings(r.settings);
        }),
        admin.remoteBackups().then(setRemote),
      ]).catch((e) => setNote({ ok: false, text: errorText(e) })),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setNote(null);
    try {
      setNote({ ok: true, text: await fn() });
      await load();
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = (patch: Partial<BackupSettings>) =>
    run("settings", async () => {
      const r = await admin.backupSettings(patch);
      setSettings(r.settings);
      return t("admin.backup.settingsSaved");
    });

  const restore = (b: BackupInfo) => {
    const withConfig = b.includesConfig && confirm(t("admin.backup.confirmConfig"));
    if (!confirm(t("admin.backup.confirmRestore", { date: when(b.createdAt) }))) return;
    void run("restore", async () => {
      const r = await admin.restore(b.name, withConfig);
      const a = r.attachments;
      const parts = [t("admin.backup.restored", { head: r.restoredHead.slice(0, 7) })];
      if (a) {
        parts.push(
          a.missing.length
            ? t("admin.backup.restoreAttachmentsMissing", {
                downloaded: a.downloaded.length,
                removed: a.removed.length,
                missing: a.missing.length,
                names: `${a.missing.slice(0, 3).join(", ")}${a.missing.length > 3 ? " …" : ""}`,
              })
            : t("admin.backup.restoreAttachments", { downloaded: a.downloaded.length, removed: a.removed.length }),
        );
      }
      if (r.preRestoreBackup) parts.push(t("admin.backup.restoredUndo", { name: r.preRestoreBackup }));
      if (r.configRestored) parts.push(t("admin.backup.restoredConfig"));
      return parts.join(" ");
    });
  };

  return (
    <div>
      <p className="meta">{t("admin.backup.intro")}</p>
      {settings && (
        <fieldset className="backup-settings" disabled={busy !== null}>
          <legend>{t("admin.backup.auto")}</legend>
          <label>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} /> {t("admin.enable")}
          </label>
          <label>
            {t("admin.backup.interval")}{" "}
            <input
              type="number"
              min={1}
              max={720}
              defaultValue={settings.intervalHours}
              onBlur={(e) => Number(e.target.value) !== settings.intervalHours && saveSettings({ intervalHours: Number(e.target.value) })}
            />
          </label>
          <label>
            {t("admin.backup.keep")}{" "}
            <input
              type="number"
              min={1}
              max={365}
              defaultValue={settings.keep}
              onBlur={(e) => Number(e.target.value) !== settings.keep && saveSettings({ keep: Number(e.target.value) })}
            />
          </label>
          <label>
            <input type="checkbox" checked={settings.includeConfig} onChange={(e) => saveSettings({ includeConfig: e.target.checked })} />{" "}
            {t("admin.backup.includeConfig")}
          </label>
          <p className="meta">{t("admin.backup.autoHint")}</p>
          {remote?.configured && (
            <>
              <label>
                <input type="checkbox" checked={settings.remote} onChange={(e) => saveSettings({ remote: e.target.checked })} /> {t("admin.backup.remote")}
              </label>
              <label>
                {t("admin.backup.remoteKeep")}{" "}
                <input
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={settings.remoteKeep}
                  onBlur={(e) => Number(e.target.value) !== settings.remoteKeep && saveSettings({ remoteKeep: Number(e.target.value) })}
                />
              </label>
            </>
          )}
        </fieldset>
      )}
      <div className="agent-actions">
        <button
          className="on"
          disabled={busy !== null}
          onClick={() => run("create", async () => t("admin.backup.created", { name: (await admin.createBackup()).name }))}
        >
          {busy === "create" ? t("admin.backup.running") : t("admin.backup.now")}
        </button>
        <button disabled={busy !== null} onClick={() => fileInput.current?.click()}>
          {t("admin.backup.upload")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.tgz,application/gzip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run("upload", async () => t("admin.backup.uploaded", { name: (await admin.upload(f)).name }));
          }}
        />
      </div>
      {busy === "restore" && <p className="meta">{t("admin.backup.restoring")}</p>}
      {note && <p className={note.ok ? "note-ok" : "form-error"}>{note.text}</p>}
      <table className="widget-table backups">
        <thead>
          <tr>
            <th>{t("admin.backup.createdAt")}</th>
            <th>{t("admin.backup.type")}</th>
            <th>{t("admin.backup.size")}</th>
            <th>{t("admin.backup.commits")}</th>
            <th>{t("admin.backup.config")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.name}>
              <td title={b.name}>{when(b.createdAt)}</td>
              <td>{kindLabel(b.kind)}</td>
              <td className="num">{fmtBytes(b.size)}</td>
              <td className="num">
                {fmtNumber(b.commits)} <span className="meta">{b.head?.slice(0, 7)}</span>
              </td>
              <td>{b.includesConfig ? t("admin.backup.included") : "—"}</td>
              <td className="row-actions">
                <a href={admin.downloadUrl(b.name)} download={b.name}>
                  {t("admin.backup.download")}
                </a>
                <button disabled={busy !== null} onClick={() => restore(b)}>
                  {t("admin.backup.restore")}
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() =>
                    confirm(t("admin.backup.confirmDelete", { name: b.name })) &&
                    void run("remove", async () => (await admin.removeBackup(b.name), t("admin.backup.deleted")))
                  }
                >
                  {t("common.delete")}
                </button>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={6} className="widget-empty">
                {t("admin.backup.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h4>{t("admin.backup.s3Title")}</h4>
      {!remote?.configured ? (
        <p className="meta">{t("admin.backup.s3Setup")}</p>
      ) : (
        <>
          <p className="meta">{t("admin.backup.s3Hint", { location: remote.location ?? "" })}</p>
          {remote.lastError && <p className="form-error">{remote.lastError}</p>}
          <table className="widget-table backups">
            <thead>
              <tr>
                <th>{t("admin.backup.backup")}</th>
                <th>{t("admin.backup.type")}</th>
                <th>{t("admin.backup.size")}</th>
                <th>{t("admin.backup.uploadedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {remote.backups.map((b) => (
                <tr key={b.name}>
                  <td>{b.name}</td>
                  <td>{kindLabel(b.kind)}</td>
                  <td className="num">{fmtBytes(b.size)}</td>
                  <td>{b.uploadedAt ? when(b.uploadedAt) : "—"}</td>
                  <td className="row-actions">
                    {b.local ? (
                      <span className="meta">{t("admin.backup.alsoLocal")}</span>
                    ) : (
                      <button
                        disabled={busy !== null}
                        onClick={() => void run("fetch", async () => t("admin.backup.fetched", { name: (await admin.fetchRemote(b.name)).name }))}
                      >
                        {t("admin.backup.fetch")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {remote.backups.length === 0 && (
                <tr>
                  <td colSpan={5} className="widget-empty">
                    {t("admin.backup.s3Empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {list.some((b) => !remote.backups.some((r) => r.name === b.name)) && (
            <p className="meta">
              {t("admin.backup.notOnS3")}{" "}
              {list
                .filter((b) => !remote.backups.some((r) => r.name === b.name))
                .map((b) => (
                  <button
                    key={b.name}
                    disabled={busy !== null}
                    onClick={() => void run("push", async () => (await admin.pushRemote(b.name), t("admin.backup.pushed", { name: b.name })))}
                  >
                    {t("admin.backup.pushOne", { date: when(b.createdAt) })}
                  </button>
                ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function UpdateView() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(async (force: boolean) => {
    setBusy(true);
    try {
      setInfo(await admin.update(force));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void check(false);
  }, [check]);
  if (!info) return <p className="meta">{t("admin.update.checking")}</p>;
  return (
    <div>
      <dl className="admin-dl">
        <dt>{t("admin.update.current")}</dt>
        <dd>{info.current}</dd>
        <dt>{t("admin.update.latest")}</dt>
        <dd>
          {info.latest ?? "—"}
          {info.updateAvailable && <strong className="badge">{t("admin.update.available")}</strong>}
          {info.checked && !info.updateAvailable && <span className="meta"> ({t("admin.update.upToDate")})</span>}
          {info.url && (
            <>
              {" "}
              <a href={info.url} target="_blank" rel="noreferrer">
                {t("admin.update.changes")}
              </a>
            </>
          )}
        </dd>
      </dl>
      {info.error && <p className="meta">{info.error}</p>}
      <button disabled={busy} onClick={() => check(true)}>
        {busy ? t("admin.update.checkingShort") : t("admin.update.recheck")}
      </button>
      <h4>{t("admin.update.howTo")}</h4>
      <p className="meta">{t("admin.update.howToHint")}</p>
      <p>Docker Compose</p>
      <pre>{info.instructions.docker}</pre>
      <p>{t("admin.update.fromSource")}</p>
      <pre>{info.instructions.source}</pre>
    </div>
  );
}

/** 소유자 패스키: 등록한 주소(rpID)에서만 쓸 수 있다 */
function PasskeysView() {
  const [list, setList] = useState<{ passkeys: PasskeyInfo[]; here: string | null } | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      admin
        .passkeys()
        .then(setList)
        .catch((e) => setNote({ ok: false, text: errorText(e) })),
    [],
  );
  useEffect(() => void load(), [load]);

  const register = async () => {
    setBusy(true);
    setNote(null);
    try {
      const k = await admin.registerPasskey(name.trim() || navigator.platform || t("admin.passkeys.defaultName"));
      setName("");
      setNote({ ok: true, text: t("admin.passkeys.registered", { name: k.name }) });
      await load();
    } catch (e) {
      if (!(e instanceof Error && e.name === "NotAllowedError")) setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (k: PasskeyInfo) => {
    if (!confirm(t("admin.passkeys.confirmRemove", { name: k.name }))) return;
    try {
      await admin.removePasskey(k.id);
      await load();
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    }
  };

  return (
    <div className="passkeys">
      <h4>{t("admin.passkeys.title")}</h4>
      <p className="meta">{list?.here ? t("admin.passkeys.introHere", { here: list.here }) : t("admin.passkeys.intro")}</p>
      {list && list.passkeys.length > 0 && (
        <table className="passkey-table">
          <tbody>
            {list.passkeys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="meta">{k.rpID}</td>
                <td className="meta">{t("admin.passkeys.registeredAt", { date: when(k.createdAt) })}</td>
                <td className="meta">{k.lastUsedAt ? t("admin.passkeys.lastUsed", { date: when(k.lastUsedAt) }) : t("admin.passkeys.neverUsed")}</td>
                <td>
                  <button onClick={() => void remove(k)}>{t("admin.passkeys.remove")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {passkeySupported() ? (
        <div className="passkey-add">
          <input
            placeholder={t("admin.passkeys.namePlaceholder")}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("admin.passkeys.nameLabel")}
          />
          <button disabled={busy} onClick={() => void register()}>
            {busy ? t("admin.passkeys.waiting") : t("admin.passkeys.register")}
          </button>
        </div>
      ) : (
        <p className="meta">{t("admin.passkeys.unsupported")}</p>
      )}
      {note && <p className={note.ok ? "note-ok" : "form-error"}>{note.text}</p>}
    </div>
  );
}

function SecurityView() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget;
    const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
    if (get("next") !== get("again")) return setNote({ ok: false, text: t("admin.security.mismatch") });
    try {
      await admin.password(get("current"), get("next"));
      f.reset();
      setNote({ ok: true, text: t("admin.security.changed") });
    } catch (err) {
      setNote({ ok: false, text: errorText(err) });
    }
  };
  return (
    <div>
      <form className="password-form" onSubmit={submit}>
        <h4>{t("admin.security.changePassword")}</h4>
        <input name="current" type="password" autoComplete="current-password" placeholder={t("admin.security.currentPassword")} required />
        <input name="next" type="password" autoComplete="new-password" placeholder={t("admin.security.newPassword")} minLength={8} required />
        <input name="again" type="password" autoComplete="new-password" placeholder={t("admin.security.confirmPassword")} minLength={8} required />
        <button type="submit">{t("common.change")}</button>
        {note && <p className={note.ok ? "note-ok" : "form-error"}>{note.text}</p>}
      </form>
      <PasskeysView />
      <h4>{t("admin.security.remote")}</h4>
      <ul className="meta">
        <li>{t("admin.security.tipProxy")}</li>
        <li>{withCode(t("admin.security.tipPublicUrl"), { code: "KEYRING_PUBLIC_URL" })}</li>
        <li>{t("admin.security.tipToken")}</li>
      </ul>
    </div>
  );
}

function eventLabel(ev: string): string {
  switch (ev) {
    case "raw.added":
      return t("admin.auto.event.rawAdded");
    case "doc.changed":
      return t("admin.auto.event.docChanged");
    case "proposal.created":
      return t("admin.auto.event.proposalCreated");
    case "schedule":
      return t("admin.auto.event.schedule");
    case "ping":
      return t("admin.auto.event.ping");
    default:
      return ev;
  }
}

/** 고칠 수 있는 칸만(정기 작업의 다음·마지막 실행 같은 상태 값은 빼고) 비교용 글로 */
const editable = (list: object[]) =>
  JSON.stringify(list.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !["next", "lastRun", "lastResult", "error"].includes(k)))));

/** 웹훅·정기 작업(W8). */
function AutomationView() {
  const [events, setEvents] = useState<string[]>([]);
  const [hooks, setHooks] = useState<WebhookInfo[]>([]);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryInfo[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  // 저장한 상태(고친 것이 있는지 보려고)
  const [savedHooks, setSavedHooks] = useState("[]");
  const [savedJobs, setSavedJobs] = useState("[]");
  const dirty = editable(hooks) !== savedHooks || editable(jobs) !== savedJobs;
  useCloseGuard(
    Object.keys(secrets).length
      ? { kind: "confirm", reason: t("admin.auto.secretGuard") }
      : dirty
        ? { kind: "confirm", reason: t("admin.auto.unsaved") }
        : null,
  );
  const load = useCallback(async () => {
    try {
      const r = await automation.get();
      setEvents(r.events);
      setHooks(r.webhooks);
      setJobs(r.jobs);
      setSavedHooks(editable(r.webhooks));
      setSavedJobs(editable(r.jobs));
      setDeliveries(r.deliveries);
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patchHook = (i: number, p: Partial<WebhookInfo>) => setHooks((hs) => hs.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const patchJob = (i: number, p: Partial<JobInfo>) => setJobs((js) => js.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const act = async (fn: () => Promise<string>) => {
    try {
      setNote({ ok: true, text: await fn() });
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    }
    await load();
  };

  return (
    <div>
      <p className="meta">{withCode(t("admin.auto.intro"), { header: "X-Keyring-Signature: sha256=…" })}</p>
      {note && (
        <p className={note.ok ? "note-ok" : "form-error"} onClick={() => setNote(null)}>
          {note.text}
        </p>
      )}
      <h4>{t("admin.auto.webhooks")}</h4>
      {hooks.map((h, i) => (
        <section key={i} className="agent-card">
          <div className="hook-grid">
            <label>
              id <input value={h.id} disabled={!!h.secret} onChange={(e) => patchHook(i, { id: e.target.value })} placeholder="wiki-agent" />
            </label>
            <label>
              {t("admin.auto.name")} <input value={h.name} onChange={(e) => patchHook(i, { name: e.target.value })} />
            </label>
            <label className="wide">
              {t("admin.auto.url")}{" "}
              <input value={h.url} onChange={(e) => patchHook(i, { url: e.target.value })} placeholder="https://agent.example.com/hooks/keyring" />
            </label>
            <label className="wide">
              {t("admin.auto.topics")}{" "}
              <input
                value={h.topics.join(", ")}
                onChange={(e) =>
                  patchHook(i, {
                    topics: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>
          <div className="event-checks">
            {events
              .filter((ev) => ev !== "ping")
              .map((ev) => (
                <label key={ev}>
                  <input
                    type="checkbox"
                    checked={h.events.includes(ev)}
                    onChange={(e) => patchHook(i, { events: e.target.checked ? [...h.events, ev] : h.events.filter((x) => x !== ev) })}
                  />{" "}
                  {eventLabel(ev)}
                </label>
              ))}
            <label>
              <input type="checkbox" checked={h.enabled} onChange={(e) => patchHook(i, { enabled: e.target.checked })} /> {t("admin.enable")}
            </label>
          </div>
          {secrets[h.id] && (
            <div className="token-row">
              <span className="meta">{t("admin.auto.secretOnce")}</span>
              <code>{secrets[h.id]}</code>
              <button
                onClick={() =>
                  setSecrets((x) => {
                    const next = { ...x };
                    delete next[h.id];
                    return next;
                  })
                }
              >
                {t("admin.auto.hideSecret")}
              </button>
            </div>
          )}
          <div className="agent-actions">
            <span className="meta">{h.secret ? `secret ${h.secret}` : t("admin.auto.noSecret")}</span>
            <span className="spacer" />
            {h.secret && (
              <button
                onClick={() =>
                  act(async () => {
                    const d = await automation.test(h.id);
                    return d.status === "ok"
                      ? t("admin.auto.testOk", { status: String(d.httpStatus) })
                      : t("admin.auto.testFailed", { error: String(d.error) });
                  })
                }
              >
                {t("admin.auto.test")}
              </button>
            )}
            <button onClick={() => setHooks((hs) => hs.filter((_, j) => j !== i))}>{t("common.delete")}</button>
          </div>
        </section>
      ))}
      <div className="agent-actions">
        <button onClick={() => setHooks((hs) => [...hs, { id: "", name: "", url: "", secret: "", events: ["raw.added"], topics: [], enabled: true }])}>
          {t("admin.auto.addWebhook")}
        </button>
        <button
          className="on"
          onClick={() =>
            act(async () => {
              const r = await automation.saveWebhooks(hooks);
              setSecrets((s) => ({ ...s, ...r.newSecrets }));
              const saved = t("admin.auto.webhooksSaved", { count: r.webhooks.length });
              return Object.keys(r.newSecrets).length ? `${saved} ${t("admin.auto.addNewSecrets")}` : saved;
            })
          }
        >
          {t("admin.auto.saveWebhooks")}
        </button>
      </div>

      <h4>{t("admin.auto.jobs")}</h4>
      <p className="meta">{withCode(t("admin.auto.jobsIntro"), { weekly: "0 9 * * 1", every30: "*/30 * * * *", event: "schedule" })}</p>
      {jobs.map((j, i) => (
        <section key={i} className="agent-card">
          <div className="hook-grid">
            <label>
              id <input value={j.id} onChange={(e) => patchJob(i, { id: e.target.value })} placeholder="weekly-lint" />
            </label>
            <label>
              {t("admin.auto.name")} <input value={j.name} onChange={(e) => patchJob(i, { name: e.target.value })} />
            </label>
            <label>
              cron <input value={j.cron} onChange={(e) => patchJob(i, { cron: e.target.value })} placeholder="0 9 * * 1" />
            </label>
            <label>
              {t("admin.auto.webhook")}{" "}
              <select value={j.webhook} onChange={(e) => patchJob(i, { webhook: e.target.value })}>
                <option value="">{t("admin.auto.pick")}</option>
                {hooks
                  .filter((h) => h.secret)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t("admin.auto.topic")}{" "}
              <input value={j.topic ?? ""} onChange={(e) => patchJob(i, { topic: e.target.value || null })} placeholder={t("admin.auto.allTopics")} />
            </label>
            <label className="wide">
              {t("admin.auto.instructions")}{" "}
              <input
                value={j.instructions ?? ""}
                onChange={(e) => patchJob(i, { instructions: e.target.value || null })}
                placeholder={t("admin.auto.instructionsPlaceholder")}
              />
            </label>
          </div>
          <div className="event-checks">
            <label>
              <input type="checkbox" checked={j.lint} onChange={(e) => patchJob(i, { lint: e.target.checked })} /> {t("admin.auto.lint")}
            </label>
            <label>
              <input type="checkbox" checked={j.enabled} onChange={(e) => patchJob(i, { enabled: e.target.checked })} /> {t("admin.enable")}
            </label>
          </div>
          <div className="agent-actions">
            <span className="meta">
              {j.error
                ? `⚠ ${j.error}`
                : `${t("admin.auto.jobStatus", { next: when(j.next), last: when(j.lastRun) })}${j.lastResult ? ` (${j.lastResult})` : ""}`}
            </span>
            <span className="spacer" />
            {j.next !== undefined && (
              <button
                onClick={() =>
                  act(async () => {
                    const r = await automation.run(j.id);
                    return r.job.lastResult ?? t("admin.auto.ran");
                  })
                }
              >
                {t("admin.auto.runNow")}
              </button>
            )}
            <button onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}>{t("common.delete")}</button>
          </div>
        </section>
      ))}
      <div className="agent-actions">
        <button
          onClick={() =>
            setJobs((js) => [
              ...js,
              {
                id: "",
                name: "",
                cron: "0 9 * * 1",
                webhook: hooks.find((h) => h.secret)?.id ?? "",
                topic: null,
                lint: true,
                instructions: null,
                enabled: true,
              },
            ])
          }
        >
          {t("admin.auto.addJob")}
        </button>
        <button className="on" onClick={() => act(async () => t("admin.auto.jobsSaved", { count: (await automation.saveJobs(jobs)).jobs.length }))}>
          {t("admin.auto.saveJobs")}
        </button>
      </div>

      <h4>{t("admin.auto.deliveries")}</h4>
      <table className="widget-table">
        <thead>
          <tr>
            <th>{t("admin.auto.time")}</th>
            <th>{t("admin.auto.webhook")}</th>
            <th>{t("admin.auto.eventCol")}</th>
            <th>{t("admin.auto.result")}</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td>{when(d.time)}</td>
              <td>{d.webhook}</td>
              <td>{eventLabel(d.event)}</td>
              <td className={d.status === "failed" ? "form-error" : undefined}>
                {d.status === "ok"
                  ? t("admin.auto.deliveryOk", { status: String(d.httpStatus) })
                  : d.status === "pending"
                    ? t("admin.auto.deliverySending")
                    : t("admin.auto.deliveryFailed", { error: String(d.error) })}{" "}
                {d.attempts > 1 && <span className="meta">{t("admin.auto.attempts", { count: d.attempts })}</span>}
              </td>
            </tr>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={4} className="widget-empty">
                {t("admin.auto.noDeliveries")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
