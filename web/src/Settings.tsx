import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { dailyNotePath } from "@keyring-notes/core";
import { DEFAULT_NOTE_SETTINGS, type NoteSettings } from "./noteSettings";
import { DEFAULT_PREFS, resetPrefs, setPrefs, usePrefs, type Prefs } from "./prefs";
import { commandKey, eventCombo, formatCombo, inApp, keyCapture, normalizeCombo, type Command } from "./shortcuts";

export type SettingsSection = "general" | "editor" | "files" | "daily" | "keys" | "device" | "server";

const SECTIONS: { id: SettingsSection; label: string; local?: boolean; server?: boolean }[] = [
  { id: "general", label: "일반" },
  { id: "editor", label: "편집기" },
  { id: "files", label: "파일·트리" },
  { id: "daily", label: "데일리·템플릿" },
  { id: "keys", label: "단축키" },
  { id: "device", label: "이 기기·동기화", local: true },
  { id: "server", label: "서버 관리", server: true },
];

/** 설정 한 줄: 검색에 걸리도록 이름·설명을 같이 둔다 */
function Row({ label, hint, children, query }: { label: string; hint?: string; children: ReactNode; query: string }) {
  const q = query.trim().toLowerCase();
  if (q && !`${label} ${hint ?? ""}`.toLowerCase().includes(q)) return null;
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} className={`switch${value ? " on" : ""}`} onClick={() => onChange(!value)}>
      <span className="switch-knob" />
    </button>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SettingsPage({
  section,
  onSection,
  onClose,
  noteSettings,
  onNoteSettings,
  commands,
  local,
  onOpenAdmin,
  onOpenSync,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  noteSettings: NoteSettings;
  onNoteSettings: (s: NoteSettings) => void;
  commands: Command[];
  local: boolean;
  onOpenAdmin: () => void;
  onOpenSync: () => void;
}) {
  const prefs = usePrefs();
  const [query, setQuery] = useState("");
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs({ [k]: v } as Partial<Prefs>);
  const sections = SECTIONS.filter((s) => (s.local ? local : s.server ? !local : true));
  // 검색 중에는 모든 묶음을 한 화면에
  const shown = query.trim() ? sections.map((s) => s.id) : [section];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !keyCapture.active && !(e.target as HTMLElement).closest?.("input,select")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body: Record<SettingsSection, ReactNode> = {
    general: (
      <>
        <Row label="테마" hint="시스템 설정을 따르거나 직접 고릅니다" query={query}>
          <Choice label="테마" value={prefs.theme} onChange={set("theme")} options={[{ value: "system", label: "시스템" }, { value: "light", label: "밝게" }, { value: "dark", label: "어둡게" }]} />
        </Row>
        <Row label="화면 설정 초기화" hint="이 기기의 패널 폭·편집기·트리·단축키 설정을 처음 값으로" query={query}>
          <button type="button" onClick={() => resetPrefs()}>
            초기화
          </button>
        </Row>
      </>
    ),
    editor: (
      <>
        <Row label="자동 저장" hint="입력이 멈추면, 탭을 바꾸거나 창을 떠날 때 저장합니다. 서버는 같은 문서의 잇단 저장을 10분 단위로 한 이력에 묶습니다" query={query}>
          <Toggle label="자동 저장" value={prefs.autosave} onChange={set("autosave")} />
        </Row>
        <Row label="자동 저장 간격" hint="입력이 멈추고 저장할 때까지" query={query}>
          <Choice
            label="자동 저장 간격"
            value={String(prefs.autosaveDelay)}
            onChange={(v) => setPrefs({ autosaveDelay: Number(v) })}
            options={[
              { value: "800", label: "0.8초" },
              { value: "1500", label: "1.5초" },
              { value: "3000", label: "3초" },
              { value: "10000", label: "10초" },
            ]}
          />
        </Row>
        <Row label="Live Preview" hint="편집 중 렌더링: 커서가 없는 줄은 # · ** · [[ ]] 같은 기호를 숨깁니다" query={query}>
          <Toggle label="Live Preview" value={prefs.live} onChange={set("live")} />
        </Row>
        <Row label="본문 글꼴" query={query}>
          <Choice label="본문 글꼴" value={prefs.editorFont} onChange={set("editorFont")} options={[{ value: "sans", label: "고딕(기본)" }, { value: "serif", label: "명조" }, { value: "mono", label: "고정폭" }]} />
        </Row>
        <Row label="글자 크기" query={query}>
          <Choice
            label="글자 크기"
            value={String(prefs.editorSize)}
            onChange={(v) => setPrefs({ editorSize: Number(v) })}
            options={[14, 15, 16, 17, 18, 20].map((n) => ({ value: String(n), label: `${n}px` }))}
          />
        </Row>
        <Row label="읽기 폭" hint="본문을 약 760px 폭으로 가운데 정렬합니다. 끄면 화면 폭을 다 씁니다" query={query}>
          <Toggle label="읽기 폭" value={prefs.readableWidth} onChange={set("readableWidth")} />
        </Row>
        <Row label="줄 번호" query={query}>
          <Toggle label="줄 번호" value={prefs.lineNumbers} onChange={set("lineNumbers")} />
        </Row>
        <Row label="속성 칸" hint="프런트매터를 입력칸으로 봅니다" query={query}>
          <Toggle label="속성 칸" value={prefs.props} onChange={set("props")} />
        </Row>
      </>
    ),
    files: (
      <>
        <Row label="첨부 파일 표시" hint="트리에서 마크다운이 아닌 파일(이미지·PDF…)" query={query}>
          <Choice
            label="첨부 파일 표시"
            value={prefs.treeAttachments}
            onChange={set("treeAttachments")}
            options={[
              { value: "bottom", label: "폴더 아래쪽에 모으기" },
              { value: "show", label: "문서와 섞어 보이기" },
              { value: "hide", label: "숨기기" },
            ]}
          />
        </Row>
        <Row label="attachments 폴더 숨기기" hint="붙여넣은 이미지가 들어가는 폴더" query={query}>
          <Toggle label="attachments 폴더 숨기기" value={prefs.treeHideAttachmentFolders} onChange={set("treeHideAttachmentFolders")} />
        </Row>
        <Row label="문서 끝 백링크" hint="오른쪽 패널 말고 미리보기 끝에도 백링크·출처를 보입니다" query={query}>
          <Toggle label="문서 끝 백링크" value={prefs.backlinksInDoc} onChange={set("backlinksInDoc")} />
        </Row>
      </>
    ),
    daily: <DailySettings value={noteSettings} onChange={onNoteSettings} query={query} />,
    keys: <KeySettings commands={commands} query={query} />,
    device: (
      <Row label="이 기기 볼트·서버 동기화" hint="볼트 폴더, 동기화할 서버, 지금 동기화" query={query}>
        <button type="button" onClick={onOpenSync}>
          열기
        </button>
      </Row>
    ),
    server: (
      <Row label="관리 콘솔" hint="서버 상태·에이전트·백업·자동화·업데이트·보안·기기" query={query}>
        <button type="button" onClick={onOpenAdmin}>
          열기
        </button>
      </Row>
    ),
  };

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="설정 묶음">
        <button type="button" className="settings-back" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden /> 문서로 돌아가기
        </button>
        <label className="settings-search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="설정 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="설정 검색" />
        </label>
        {sections.map((s) => (
          <button key={s.id} type="button" className={`settings-tab${!query && section === s.id ? " on" : ""}`} onClick={() => (setQuery(""), onSection(s.id))}>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {shown.map((id) => (
          <section key={id} className="settings-section">
            <h2>{SECTIONS.find((s) => s.id === id)!.label}</h2>
            {body[id]}
          </section>
        ))}
      </div>
    </div>
  );
}

function DailySettings({ value, onChange, query }: { value: NoteSettings; onChange: (s: NoteSettings) => void; query: string }) {
  const field = (k: keyof NoteSettings, label: string, hint?: string, placeholder?: string) => (
    <Row label={label} hint={hint} query={query}>
      <input value={value[k]} placeholder={placeholder} aria-label={label} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
    </Row>
  );
  return (
    <>
      {field("dailyFolder", "데일리 노트 폴더", undefined, "일기")}
      {field("dailyFormat", "데일리 노트 파일 이름", `YYYY MM DD ddd(요일) · /로 하위 폴더 · 오늘: ${dailyNotePath(value.dailyFolder, value.dailyFormat, new Date())}`, "YYYY-MM-DD")}
      {field("dailyTemplate", "데일리 노트 템플릿", "템플릿 문서 경로", "템플릿/데일리.md")}
      {field("templateFolder", "템플릿 폴더", "이 아래 문서가 \"템플릿 넣기\" 목록에 나옵니다. 변수: {{title}} {{date}} {{time}} {{date:YYYY년 M월 D일 dddd}}", "템플릿")}
      <Row label="기본값으로" query={query}>
        <button type="button" onClick={() => onChange(DEFAULT_NOTE_SETTINGS)}>
          되돌리기
        </button>
      </Row>
    </>
  );
}

/** 단축키 목록·바꾸기. 웹에서는 브라우저가 가로채는 키 대신 대체 키를 씁니다 */
export function KeySettings({ commands, query, readOnly = false }: { commands: Command[]; query: string; readOnly?: boolean }) {
  const prefs = usePrefs();
  const [capturing, setCapturing] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    return commands.filter((c) => {
      if (seen.has(c.id) || (c.hidden && !c.keys)) return false;
      // 읽기 전용 목록(단축키 창)에는 키가 있는 것만
      if (readOnly && !commandKey(c, prefs.keys)) return false;
      seen.add(c.id);
      return !q || `${c.label} ${c.group} ${formatCombo(commandKey(c, prefs.keys))}`.toLowerCase().includes(q);
    });
  }, [commands, query, prefs.keys, readOnly]);

  useEffect(() => {
    if (!capturing) return;
    keyCapture.active = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturing(null);
      const combo = eventCombo(e);
      if (!combo) return;
      const n = normalizeCombo(combo);
      const clash = commands.find((c) => c.id !== capturing && commandKey(c, prefs.keys) && normalizeCombo(commandKey(c, prefs.keys)!) === n);
      setWarn(clash ? `${formatCombo(n)}는 "${clash.label}"에도 걸려 있었습니다. 그쪽 키는 껐습니다.` : null);
      setPrefs((p) => ({ keys: { ...p.keys, [capturing]: n, ...(clash ? { [clash.id]: "" } : {}) } }));
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      keyCapture.active = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [capturing, commands, prefs.keys]);

  const groups = [...new Set(list.map((c) => c.group))];
  return (
    <div className="key-settings">
      {!inApp && !readOnly && <p className="meta">브라우저에서는 Ctrl/Cmd+N·W·T·Tab·숫자를 페이지가 받을 수 없어, 그 명령은 Alt 조합을 씁니다. 데스크톱 앱에서는 원래 키를 씁니다.</p>}
      {warn && <p className="note-ok">{warn}</p>}
      {groups.map((g) => (
        <div key={g} className="key-group">
          <h3>{g}</h3>
          <table className="key-table">
            <tbody>
              {list
                .filter((c) => c.group === g)
                .map((c) => {
                  const k = commandKey(c, prefs.keys);
                  const changed = c.id in prefs.keys;
                  return (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td className="key-cell">{capturing === c.id ? <span className="meta">새 키를 누르세요(Esc 취소)</span> : k ? <kbd>{formatCombo(k)}</kbd> : <span className="meta">없음</span>}</td>
                      {!readOnly && (
                        <td className="key-actions">
                          <button type="button" onClick={() => setCapturing(c.id)}>
                            바꾸기
                          </button>
                          {changed && (
                            <button
                              type="button"
                              onClick={() =>
                                setPrefs((p) => {
                                  const keys = { ...p.keys };
                                  delete keys[c.id];
                                  return { keys };
                                })
                              }
                            >
                              기본값
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
      {!readOnly && Object.keys(prefs.keys).length > 0 && (
        <button type="button" onClick={() => setPrefs({ keys: DEFAULT_PREFS.keys })}>
          단축키 모두 기본값으로
        </button>
      )}
    </div>
  );
}
