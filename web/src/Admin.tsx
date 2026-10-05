import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  admin,
  automation,
  type AdminStatus,
  type AgentInfo,
  type BackupInfo,
  type BackupSettings,
  type DeliveryInfo,
  type JobInfo,
  type Level,
  type UpdateInfo,
  type WebhookInfo,
} from "./api";

const LEVELS: { value: Level; label: string }[] = [
  { value: "hidden", label: "숨김" },
  { value: "read", label: "읽기" },
  { value: "append", label: "추가만" },
  { value: "write", label: "쓰기" },
  { value: "delete", label: "쓰기·삭제" },
];

const KIND_LABEL: Record<BackupInfo["kind"], string> = { auto: "자동", manual: "수동", "pre-restore": "복원 전" };

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function duration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
}

type Section = "status" | "agents" | "backups" | "automation" | "update" | "security";

export function AdminPanel({ folders, onClose }: { folders: string[]; onClose: () => void }) {
  const [section, setSection] = useState<Section>("status");
  return (
    <div className="admin" role="dialog" aria-label="관리 콘솔">
      <div className="admin-head">
        <strong>관리 콘솔</strong>
        <nav>
          {(
            [
              ["status", "서버 상태"],
              ["agents", "에이전트·권한"],
              ["backups", "백업·복원"],
              ["automation", "자동화"],
              ["update", "업데이트"],
              ["security", "보안"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={section === k ? "on" : ""} onClick={() => setSection(k)}>
              {label}
            </button>
          ))}
        </nav>
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="admin-body">
        {section === "status" && <StatusView />}
        {section === "agents" && <AgentsView folders={folders} />}
        {section === "backups" && <BackupsView />}
        {section === "automation" && <AutomationView />}
        {section === "update" && <UpdateView />}
        {section === "security" && <SecurityView />}
      </div>
    </div>
  );
}

function StatusView() {
  const [s, setS] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => admin.status().then(setS).catch((e) => setError(msg(e))), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <p className="form-error">{error}</p>;
  if (!s) return <p className="meta">불러오는 중…</p>;
  const diskUsed = s.disk ? 1 - s.disk.freeBytes / s.disk.totalBytes : null;
  const warnings: string[] = [];
  if (!s.security.https && !["localhost", "127.0.0.1"].includes(location.hostname)) warnings.push("HTTPS가 아닌 주소로 접속 중입니다. 리버스 프록시(HTTPS) 또는 VPN 뒤에서 쓰세요.");
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1" && !s.security.allowedHosts?.length) warnings.push("허용 호스트(KEYRING_ALLOWED_HOSTS 또는 KEYRING_PUBLIC_URL)가 설정되지 않았습니다.");
  if (s.backups.lastError) warnings.push(`마지막 자동 백업 실패: ${s.backups.lastError}`);
  if (!s.backups.last) warnings.push("백업이 아직 없습니다.");
  if (diskUsed !== null && diskUsed > 0.9) warnings.push(`디스크가 ${Math.round(diskUsed * 100)}% 찼습니다.`);
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
        <Stat label="버전" value={s.app.version} sub={`Node ${s.app.node} · 실행 ${duration(s.app.uptimeSec)} · 메모리 ${s.app.memoryMb}MB`} />
        <Stat label="문서" value={s.vault.documents.toLocaleString()} sub={`파일 ${s.vault.files.toLocaleString()}개 · ${bytes(s.vault.bytes)} · 토픽 ${s.vault.topics}개(위키 ${s.vault.wikiTopics.length})`} />
        <Stat
          label="변경 이력"
          value={`${s.history.commits.toLocaleString()} 커밋`}
          sub={s.history.last ? `마지막: ${s.history.last.author} · ${when(s.history.last.date)}` : "—"}
        />
        <Stat
          label="디스크"
          value={s.disk ? `${bytes(s.disk.freeBytes)} 남음` : "—"}
          sub={s.disk ? `전체 ${bytes(s.disk.totalBytes)} · 이력 ${bytes(s.history.bytes)} · 인덱스 ${bytes(s.index.bytes)}` : undefined}
        />
        <Stat
          label="백업"
          value={s.backups.last ? when(s.backups.last.createdAt) : "없음"}
          sub={`${s.backups.count}개 · 자동 ${s.backups.settings.enabled ? `${s.backups.settings.intervalHours}시간마다, 다음 ${when(s.backups.next)}` : "꺼짐"}`}
        />
        <Stat label="에이전트" value={`${s.agents.length}개`} sub={s.agents.map((a) => `${a.name}${a.lastUsed ? ` (${when(a.lastUsed)})` : ""}`).join(", ") || "—"} />
      </div>
      <dl className="admin-dl">
        <dt>볼트</dt>
        <dd>
          <code>{s.vault.path}</code>
        </dd>
        <dt>백업 폴더</dt>
        <dd>
          <code>{s.backups.dir}</code>
        </dd>
        <dt>공개 주소</dt>
        <dd>{s.security.publicUrl ?? "—"}</dd>
        <dt>접속</dt>
        <dd>{s.security.https ? "HTTPS" : "HTTP"}</dd>
      </dl>
      <button onClick={() => void load()}>새로고침</button>
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
  const copy = (t: string) => void navigator.clipboard?.writeText(t);
  return (
    <div className="token-notice">
      <p>
        <strong>{name}</strong> 토큰입니다. <strong>지금만 볼 수 있으니</strong> 에이전트 설정에 바로 넣으세요.
      </p>
      <div className="token-row">
        <code>{token}</code>
        <button onClick={() => copy(token)}>복사</button>
      </div>
      <p className="meta">MCP 클라이언트 설정 예(Streamable HTTP):</p>
      <pre>{snippet}</pre>
      <button onClick={() => copy(snippet)}>설정 복사</button> <button onClick={onClose}>닫기</button>
    </div>
  );
}

function AgentsView({ folders }: { folders: string[] }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<{ name: string; token: string } | null>(null);
  const load = useCallback(() => admin.agents().then(setAgents).catch((e) => setError(msg(e))), []);
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
      setError(msg(err));
    }
  };

  return (
    <div>
      <p className="meta">
        에이전트는 토큰으로만 접근하고, 아래 표에 적은 폴더만 볼 수 있습니다. 같은 문서에 여러 규칙이 걸리면 가장 구체적인 경로가 이깁니다. 규칙이 없는 곳은 숨김이고,
        위키 토픽의 SCHEMA.md는 규칙과 상관없이 읽기만 됩니다.
      </p>
      {error && (
        <p className="form-error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {token && <TokenNotice {...token} onClose={() => setToken(null)} />}
      <form className="inline-form" onSubmit={create}>
        <input name="name" placeholder="새 에이전트 이름 (영문 소문자·숫자·-·_)" pattern="[a-z0-9][a-z0-9_\-]{0,63}" required />
        <button type="submit">만들기</button>
      </form>
      <datalist id="folder-list">
        <option value="/" />
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {agents.length === 0 && <p className="meta">에이전트가 없습니다.</p>}
      {agents.map((a) => (
        <AgentCard
          key={a.name}
          agent={a}
          onToken={setToken}
          onChanged={load}
          onError={setError}
        />
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
      onError(msg(e));
    }
  };

  return (
    <section className="agent-card">
      <div className="agent-head">
        <strong>{agent.name}</strong>
        <span className="meta">
          만든 날 {agent.createdAt ? new Date(agent.createdAt).toLocaleDateString() : "—"} · 마지막 접속 {agent.lastUsed ? when(agent.lastUsed) : "(서버 시작 뒤 없음)"}
        </span>
        <span className="spacer" />
        <button
          onClick={async () => {
            if (!confirm(`${agent.name} 토큰을 다시 만들까요? 지금 쓰는 토큰은 바로 막힙니다.`)) return;
            try {
              onToken(await admin.rotate(agent.name));
            } catch (e) {
              onError(msg(e));
            }
          }}
        >
          토큰 재발급
        </button>
        <button
          onClick={async () => {
            if (!confirm(`${agent.name} 에이전트를 지울까요? 토큰이 바로 막힙니다.`)) return;
            try {
              await admin.removeAgent(agent.name);
              onChanged();
            } catch (e) {
              onError(msg(e));
            }
          }}
        >
          삭제
        </button>
      </div>
      <table className="rules">
        <thead>
          <tr>
            <th>폴더·문서 경로</th>
            <th>권한</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input list="folder-list" value={r.path} placeholder="예: 업무/wiki" onChange={(e) => update(i, { path: e.target.value })} />
              </td>
              <td>
                <select value={r.level} onChange={(e) => update(i, { level: e.target.value as Level })}>
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  aria-label="규칙 지우기"
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
                규칙 없음 — 모든 경로가 숨김
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
          규칙 추가
        </button>
        <button className={saved ? "" : "on"} disabled={saved} onClick={save}>
          {saved ? "저장됨" : "저장"}
        </button>
      </div>
    </section>
  );
}

function BackupsView() {
  const [list, setList] = useState<BackupInfo[]>([]);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(
    () =>
      admin
        .backups()
        .then((r) => {
          setList(r.backups);
          setSettings(r.settings);
        })
        .catch((e) => setNote({ ok: false, text: msg(e) })),
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
      setNote({ ok: false, text: msg(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = (patch: Partial<BackupSettings>) =>
    run("settings", async () => {
      const r = await admin.backupSettings(patch);
      setSettings(r.settings);
      return "백업 설정을 저장했습니다.";
    });

  const restore = (b: BackupInfo) => {
    const withConfig = b.includesConfig && confirm("설정(비밀번호·에이전트 토큰·권한 표)도 이 백업으로 되돌릴까요?\n\n[확인] 설정도 복원 · [취소] 문서와 이력만 복원");
    if (!confirm(`${when(b.createdAt)} 백업으로 되돌립니다. 그 뒤의 변경은 사라지지만, 지금 상태를 "복원 전" 백업으로 먼저 남깁니다. 계속할까요?`)) return;
    void run("restore", async () => {
      const r = await admin.restore(b.name, withConfig);
      return `복원했습니다(${r.restoredHead.slice(0, 7)}).${r.preRestoreBackup ? ` 되돌리려면 "복원 전" 백업 ${r.preRestoreBackup}으로 다시 복원하세요.` : ""}${r.configRestored ? " 설정도 바뀌어 다시 로그인해야 할 수 있습니다." : ""}`;
    });
  };

  return (
    <div>
      <p className="meta">
        백업 파일 하나(.tar.gz)에 모든 문서·첨부·전체 변경 이력이 들어갑니다(Git 번들). 설정을 넣으면 비밀번호·토큰 해시도 들어가니 파일을 안전한 곳에 두세요.
      </p>
      {settings && (
        <fieldset className="backup-settings" disabled={busy !== null}>
          <legend>자동 백업</legend>
          <label>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} /> 켜기
          </label>
          <label>
            간격(시간){" "}
            <input type="number" min={1} max={720} defaultValue={settings.intervalHours} onBlur={(e) => Number(e.target.value) !== settings.intervalHours && saveSettings({ intervalHours: Number(e.target.value) })} />
          </label>
          <label>
            남길 개수{" "}
            <input type="number" min={1} max={365} defaultValue={settings.keep} onBlur={(e) => Number(e.target.value) !== settings.keep && saveSettings({ keep: Number(e.target.value) })} />
          </label>
          <label>
            <input type="checkbox" checked={settings.includeConfig} onChange={(e) => saveSettings({ includeConfig: e.target.checked })} /> 설정 포함
          </label>
          <p className="meta">마지막 자동 백업 뒤 바뀐 것이 없으면 건너뜁니다. 수동·복원 전 백업은 자동으로 지우지 않습니다.</p>
        </fieldset>
      )}
      <div className="agent-actions">
        <button className="on" disabled={busy !== null} onClick={() => run("create", async () => `백업을 만들었습니다: ${(await admin.createBackup()).name}`)}>
          {busy === "create" ? "백업 중…" : "지금 백업"}
        </button>
        <button disabled={busy !== null} onClick={() => fileInput.current?.click()}>
          백업 파일 올리기
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.tgz,application/gzip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run("upload", async () => `올렸습니다: ${(await admin.upload(f)).name} — 목록에서 "복원"을 누르세요.`);
          }}
        />
      </div>
      {busy === "restore" && <p className="meta">복원하는 중… (끝날 때까지 쓰기가 잠깐 멈춥니다)</p>}
      {note && <p className={note.ok ? "note-ok" : "form-error"}>{note.text}</p>}
      <table className="widget-table backups">
        <thead>
          <tr>
            <th>만든 시각</th>
            <th>종류</th>
            <th>크기</th>
            <th>커밋</th>
            <th>설정</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.name}>
              <td title={b.name}>{when(b.createdAt)}</td>
              <td>{KIND_LABEL[b.kind]}</td>
              <td className="num">{bytes(b.size)}</td>
              <td className="num">
                {b.commits} <span className="meta">{b.head?.slice(0, 7)}</span>
              </td>
              <td>{b.includesConfig ? "포함" : "—"}</td>
              <td className="row-actions">
                <a href={admin.downloadUrl(b.name)} download={b.name}>
                  내려받기
                </a>
                <button disabled={busy !== null} onClick={() => restore(b)}>
                  복원
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => confirm(`${b.name}을 지울까요?`) && void run("remove", async () => (await admin.removeBackup(b.name), "지웠습니다."))}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={6} className="widget-empty">
                백업이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
  if (!info) return <p className="meta">확인하는 중…</p>;
  return (
    <div>
      <dl className="admin-dl">
        <dt>지금 버전</dt>
        <dd>{info.current}</dd>
        <dt>최신 버전</dt>
        <dd>
          {info.latest ?? "—"}
          {info.updateAvailable && <strong className="badge">업데이트 있음</strong>}
          {info.checked && !info.updateAvailable && <span className="meta"> (최신)</span>}
          {info.url && (
            <>
              {" "}
              <a href={info.url} target="_blank" rel="noreferrer">
                변경 내용
              </a>
            </>
          )}
        </dd>
      </dl>
      {info.error && <p className="meta">{info.error}</p>}
      <button disabled={busy} onClick={() => check(true)}>
        {busy ? "확인 중…" : "다시 확인"}
      </button>
      <h4>업데이트 방법</h4>
      <p className="meta">업데이트 전에 백업·복원 탭에서 "지금 백업"을 누르세요. 데이터는 볼륨(/data)에 있어 이미지를 바꿔도 남습니다.</p>
      <p>Docker Compose</p>
      <pre>{info.instructions.docker}</pre>
      <p>소스에서 직접 실행</p>
      <pre>{info.instructions.source}</pre>
    </div>
  );
}

function SecurityView() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget;
    const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
    if (get("next") !== get("again")) return setNote({ ok: false, text: "새 비밀번호가 서로 다릅니다." });
    try {
      await admin.password(get("current"), get("next"));
      f.reset();
      setNote({ ok: true, text: "비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끊겼습니다." });
    } catch (err) {
      setNote({ ok: false, text: msg(err) });
    }
  };
  return (
    <div>
      <form className="password-form" onSubmit={submit}>
        <h4>비밀번호 변경</h4>
        <input name="current" type="password" autoComplete="current-password" placeholder="현재 비밀번호" required />
        <input name="next" type="password" autoComplete="new-password" placeholder="새 비밀번호(8자 이상)" minLength={8} required />
        <input name="again" type="password" autoComplete="new-password" placeholder="새 비밀번호 확인" minLength={8} required />
        <button type="submit">바꾸기</button>
        {note && <p className={note.ok ? "note-ok" : "form-error"}>{note.text}</p>}
      </form>
      <h4>원격 접속</h4>
      <ul className="meta">
        <li>인터넷에 직접 열지 말고 HTTPS 리버스 프록시(docker compose의 https 프로필, Caddy) 또는 VPN(Tailscale 등) 뒤에서 쓰세요.</li>
        <li>
          <code>KEYRING_PUBLIC_URL</code>을 https 주소로 정하면 그 호스트 이름만 받고(DNS 리바인딩 방지) 로그인 쿠키에 Secure가 붙습니다.
        </li>
        <li>에이전트 토큰이 새었다고 의심되면 에이전트·권한 탭에서 바로 재발급하세요.</li>
      </ul>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "raw.added": "새 원본 수집",
  "doc.changed": "모든 변경(커밋)",
  "proposal.created": "검토 대기열에 새 제안",
  schedule: "정기 작업",
  ping: "시험",
};

/** 웹훅·정기 작업(W8). */
function AutomationView() {
  const [events, setEvents] = useState<string[]>([]);
  const [hooks, setHooks] = useState<WebhookInfo[]>([]);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryInfo[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const r = await automation.get();
      setEvents(r.events);
      setHooks(r.webhooks);
      setJobs(r.jobs);
      setDeliveries(r.deliveries);
    } catch (e) {
      setNote({ ok: false, text: msg(e) });
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
      setNote({ ok: false, text: msg(e) });
    }
    await load();
  };

  return (
    <div>
      <p className="meta">
        웹훅은 이벤트가 생기면 JSON을 POST합니다(헤더 <code>X-Keyring-Signature: sha256=…</code>, 웹훅 secret으로 HMAC-SHA256). 에이전트·n8n·OpenClaw 같은 곳에서 받아 "새 원본이 들어왔으니 수집 절차를 돌려라" 같은 일을 시킵니다. 실패하면 세 번까지 다시 보냅니다.
      </p>
      {note && (
        <p className={note.ok ? "note-ok" : "form-error"} onClick={() => setNote(null)}>
          {note.text}
        </p>
      )}
      <h4>웹훅</h4>
      {hooks.map((h, i) => (
        <section key={i} className="agent-card">
          <div className="hook-grid">
            <label>
              id <input value={h.id} disabled={!!h.secret} onChange={(e) => patchHook(i, { id: e.target.value })} placeholder="wiki-agent" />
            </label>
            <label>
              이름 <input value={h.name} onChange={(e) => patchHook(i, { name: e.target.value })} />
            </label>
            <label className="wide">
              주소 <input value={h.url} onChange={(e) => patchHook(i, { url: e.target.value })} placeholder="https://agent.example.com/hooks/keyring" />
            </label>
            <label className="wide">
              토픽(쉼표, 비우면 전체) <input value={h.topics.join(", ")} onChange={(e) => patchHook(i, { topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
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
                  {EVENT_LABEL[ev] ?? ev}
                </label>
              ))}
            <label>
              <input type="checkbox" checked={h.enabled} onChange={(e) => patchHook(i, { enabled: e.target.checked })} /> 켜기
            </label>
          </div>
          {secrets[h.id] && (
            <div className="token-row">
              <span className="meta">secret(지금만 보임)</span>
              <code>{secrets[h.id]}</code>
            </div>
          )}
          <div className="agent-actions">
            <span className="meta">{h.secret ? `secret ${h.secret}` : "저장하면 secret을 만듭니다"}</span>
            <span className="spacer" />
            {h.secret && (
              <button onClick={() => act(async () => {
                const d = await automation.test(h.id);
                return d.status === "ok" ? `시험 전송 성공(HTTP ${d.httpStatus})` : `시험 전송 실패: ${d.error}`;
              })}>
                시험 전송
              </button>
            )}
            <button onClick={() => setHooks((hs) => hs.filter((_, j) => j !== i))}>삭제</button>
          </div>
        </section>
      ))}
      <div className="agent-actions">
        <button onClick={() => setHooks((hs) => [...hs, { id: "", name: "", url: "", secret: "", events: ["raw.added"], topics: [], enabled: true }])}>웹훅 추가</button>
        <button
          className="on"
          onClick={() =>
            act(async () => {
              const r = await automation.saveWebhooks(hooks);
              setSecrets((s) => ({ ...s, ...r.newSecrets }));
              return `웹훅 ${r.webhooks.length}개를 저장했습니다.${Object.keys(r.newSecrets).length ? " 새 secret을 받는 쪽에 넣으세요." : ""}`;
            })
          }
        >
          웹훅 저장
        </button>
      </div>

      <h4>정기 작업</h4>
      <p className="meta">
        cron 형식 "분 시 일 월 요일"(서버 시간대). 예: <code>0 9 * * 1</code> 매주 월요일 9시, <code>*/30 * * * *</code> 30분마다. 실행하면 웹훅으로 <code>schedule</code> 이벤트를 보내고, "정리 점검 포함"이면 점검 결과도 함께 보냅니다.
      </p>
      {jobs.map((j, i) => (
        <section key={i} className="agent-card">
          <div className="hook-grid">
            <label>
              id <input value={j.id} onChange={(e) => patchJob(i, { id: e.target.value })} placeholder="weekly-lint" />
            </label>
            <label>
              이름 <input value={j.name} onChange={(e) => patchJob(i, { name: e.target.value })} />
            </label>
            <label>
              cron <input value={j.cron} onChange={(e) => patchJob(i, { cron: e.target.value })} placeholder="0 9 * * 1" />
            </label>
            <label>
              웹훅{" "}
              <select value={j.webhook} onChange={(e) => patchJob(i, { webhook: e.target.value })}>
                <option value="">(고르기)</option>
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
              토픽 <input value={j.topic ?? ""} onChange={(e) => patchJob(i, { topic: e.target.value || null })} placeholder="(전체)" />
            </label>
            <label className="wide">
              지시문 <input value={j.instructions ?? ""} onChange={(e) => patchJob(i, { instructions: e.target.value || null })} placeholder="SCHEMA.md의 정리 절차대로 문제를 고쳐라" />
            </label>
          </div>
          <div className="event-checks">
            <label>
              <input type="checkbox" checked={j.lint} onChange={(e) => patchJob(i, { lint: e.target.checked })} /> 정리 점검 포함
            </label>
            <label>
              <input type="checkbox" checked={j.enabled} onChange={(e) => patchJob(i, { enabled: e.target.checked })} /> 켜기
            </label>
          </div>
          <div className="agent-actions">
            <span className="meta">
              {j.error ? `⚠ ${j.error}` : `다음 ${when(j.next)} · 마지막 ${when(j.lastRun)}${j.lastResult ? ` (${j.lastResult})` : ""}`}
            </span>
            <span className="spacer" />
            {j.next !== undefined && (
              <button onClick={() => act(async () => {
                const r = await automation.run(j.id);
                return r.job.lastResult ?? "실행했습니다";
              })}>
                지금 실행
              </button>
            )}
            <button onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}>삭제</button>
          </div>
        </section>
      ))}
      <div className="agent-actions">
        <button
          onClick={() =>
            setJobs((js) => [...js, { id: "", name: "", cron: "0 9 * * 1", webhook: hooks.find((h) => h.secret)?.id ?? "", topic: null, lint: true, instructions: null, enabled: true }])
          }
        >
          작업 추가
        </button>
        <button className="on" onClick={() => act(async () => `작업 ${(await automation.saveJobs(jobs)).jobs.length}개를 저장했습니다.`)}>
          작업 저장
        </button>
      </div>

      <h4>최근 전송</h4>
      <table className="widget-table">
        <thead>
          <tr>
            <th>시각</th>
            <th>웹훅</th>
            <th>이벤트</th>
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td>{when(d.time)}</td>
              <td>{d.webhook}</td>
              <td>{EVENT_LABEL[d.event] ?? d.event}</td>
              <td className={d.status === "failed" ? "form-error" : undefined}>
                {d.status === "ok" ? `성공 ${d.httpStatus}` : d.status === "pending" ? "보내는 중" : `실패: ${d.error}`} {d.attempts > 1 && <span className="meta">({d.attempts}번 시도)</span>}
              </td>
            </tr>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={4} className="widget-empty">
                아직 보낸 것이 없습니다(서버가 켜진 뒤 기준).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
