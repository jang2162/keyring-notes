import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { DAILY_PRESETS, DEFAULT_VAULT_SETTINGS, dailyFormatProblem, dailyNotePath, shiftDays, VAULT_SETTINGS_PATH, ymd, type VaultSettings } from "@keyring-notes/core";
import { DEFAULT_PREFS, resetPrefs, setPrefs, usePrefs, type Prefs } from "./prefs";
import { commandKey, eventCombo, formatCombo, inApp, keyCapture, normalizeCombo, type Command } from "./shortcuts";
import { Modal, useModalControl } from "./Modal";
import { SERVER_SECTIONS, ServerSettings, type ServerSection } from "./Admin";
import { SyncSettings } from "./Sync";
import { localContext } from "./local/boot";
import { updateVaultSetting, useVaultSettings } from "./vaultSettings";
import { IconPicker } from "./IconPicker";
import { toastError } from "./toast";

export type SettingsSection = "general" | "editor" | "files" | "daily" | "keys" | "device" | ServerSection;

const SECTIONS: { id: SettingsSection; label: string; local?: boolean; server?: boolean; keywords?: string; group?: string }[] = [
  { id: "general", label: "일반" },
  { id: "editor", label: "편집기" },
  { id: "files", label: "파일·링크" },
  { id: "daily", label: "데일리·템플릿" },
  { id: "keys", label: "단축키", keywords: "단축키 키 바꾸기 keymap shortcut 접기 fold" },
  { id: "device", label: "이 기기·동기화", local: true, keywords: "동기화 서버 연결 볼트 폴더 기기 sync" },
  ...SERVER_SECTIONS.map((s) => ({ ...s, server: true, group: "서버" })),
];

export function sectionLabel(id: SettingsSection): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/** 설정 한 줄: 검색에 걸리도록 이름·설명을 같이 둔다. shared: 모든 기기 공통 설정 파일에 저장되는 값 */
function Row({ label, hint, children, query, shared }: { label: string; hint?: ReactNode; children: ReactNode; query: string; shared?: boolean }) {
  const q = query.trim().toLowerCase();
  if (q && !`${label} ${typeof hint === "string" ? hint : ""} ${shared ? "모든 기기 공통" : ""}`.toLowerCase().includes(q)) return null;
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">
          {label}
          {shared && (
            <span className="badge-shared" title="볼트의 keyring-settings.md에 저장되어 모든 기기(웹·앱·서버)가 같이 씁니다">
              모든 기기
            </span>
          )}
        </div>
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

/** 공통 설정 파일에 쓰는 글자 칸: Enter·포커스 이탈 때 저장(입력마다 쓰지 않는다). check가 이유를 돌려주면 저장하지 않는다 */
function SharedText({ value, label, placeholder, check, onSave }: { value: string; label: string; placeholder?: string; check?: (v: string) => string | null; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const err = v.trim() === value ? null : (check?.(v.trim()) ?? null);
  const commit = () => {
    const t = v.trim();
    if (t === value || err) return;
    void onSave(t).catch((e) => {
      toastError(e);
      setV(value);
    });
  };
  return (
    <span className="shared-text">
      <input
        value={v}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={!!err}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          }
        }}
      />
      {err && <span className="setting-error" role="alert">{err}</span>}
    </span>
  );
}

const saveShared = <K extends keyof VaultSettings>(k: K) => (v: VaultSettings[K]) => updateVaultSetting(k, v);

export function SettingsModal({
  section,
  onSection,
  onClose,
  commands,
  local,
  folders,
  onOpen,
  onMigrateDaily,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  commands: Command[];
  local: boolean;
  folders: string[];
  onOpen: (p: string) => void;
  onMigrateDaily: () => void;
}) {
  const [query, setQuery] = useState("");
  const sections = SECTIONS.filter((s) => (s.local ? local : s.server ? !local : true));
  const current = sections.some((s) => s.id === section) ? section : "general";
  const q = query.trim().toLowerCase();
  // 검색 중에는 맞는 묶음을 한 화면에: 줄(Row)로 된 묶음은 맞는 줄만, 서버·기기 묶음은 이름·낱말이 맞을 때
  const shown = q ? sections.filter((s) => !s.keywords || `${s.label} ${s.keywords}`.toLowerCase().includes(q)).map((s) => s.id) : [current];
  let lastGroup: string | undefined;

  return (
    <Modal
      title="설정"
      onClose={onClose}
      bodyClassName="settings-body"
      nav={
        <SettingsNav
          sections={sections}
          current={q ? null : current}
          query={query}
          onQuery={setQuery}
          onSection={(s) => {
            setQuery("");
            onSection(s);
          }}
          renderGroup={(g) => {
            if (!g || g === lastGroup) return null;
            lastGroup = g;
            return <div className="nav-group">{g}</div>;
          }}
        />
      }
    >
      {shown.map((id) => (
        <section key={id} className={`settings-section${sections.find((s) => s.id === id)?.keywords ? " keep" : ""}`}>
          <h2>{sectionLabel(id)}</h2>
          <SectionBody id={id} query={query} commands={commands} folders={folders} onOpen={onOpen} onMigrateDaily={onMigrateDaily} />
        </section>
      ))}
      {q && <p className="meta settings-noresult">맞는 설정이 없습니다.</p>}
    </Modal>
  );
}

function SettingsNav({
  sections,
  current,
  query,
  onQuery,
  onSection,
  renderGroup,
}: {
  sections: typeof SECTIONS;
  current: SettingsSection | null;
  query: string;
  onQuery: (q: string) => void;
  onSection: (s: SettingsSection) => void;
  renderGroup: (g: string | undefined) => ReactNode;
}) {
  const ctl = useModalControl();
  return (
    <>
      <label className="settings-search">
        <Search size={14} aria-hidden />
        <input type="search" placeholder="설정 검색" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="설정 검색" />
        {query && (
          <button type="button" className="icon-btn" aria-label="검색 지우기" onClick={() => onQuery("")}>
            <X size={14} aria-hidden />
          </button>
        )}
      </label>
      {sections.map((s) => (
        <span key={s.id} className="settings-nav-item">
          {renderGroup(s.group)}
          <button
            type="button"
            className={`settings-tab${current === s.id ? " on" : ""}`}
            aria-current={current === s.id ? "page" : undefined}
            onClick={async () => {
              if (s.id === current) return;
              // 토큰을 보여 주는 중이거나 저장 안 한 입력이 있으면 묻는다
              if (ctl && !(await ctl.confirmLeave())) return;
              onSection(s.id);
            }}
          >
            {s.label}
          </button>
        </span>
      ))}
    </>
  );
}

function SectionBody({ id, query, commands, folders, onOpen, onMigrateDaily }: { id: SettingsSection; query: string; commands: Command[]; folders: string[]; onOpen: (p: string) => void; onMigrateDaily: () => void }) {
  const prefs = usePrefs();
  const shared = useVaultSettings();
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs({ [k]: v } as Partial<Prefs>);
  switch (id) {
    case "general":
      return (
        <>
          <Row label="테마" hint="시스템 설정을 따르거나 직접 고릅니다" query={query}>
            <Choice label="테마" value={prefs.theme} onChange={set("theme")} options={[{ value: "system", label: "시스템" }, { value: "light", label: "밝게" }, { value: "dark", label: "어둡게" }]} />
          </Row>
          <Row label="아이콘 보이기" hint="트리·탭·빠른 열기·검색 결과의 문서·폴더 아이콘(프런트매터 icon)" query={query}>
            <Toggle label="아이콘 보이기" value={prefs.showIcons} onChange={set("showIcons")} />
          </Row>
          <Row label="모든 기기 공통 설정 파일" hint={`데일리·템플릿·첨부 폴더·링크 모양·폴더 아이콘은 볼트의 ${VAULT_SETTINGS_PATH}(프런트매터)에 저장되어 앱 동기화로 모든 기기가 같이 씁니다. 트리·검색에는 나오지 않습니다`} query={query}>
            <button type="button" onClick={() => onOpen(VAULT_SETTINGS_PATH)}>
              원문 열기
            </button>
          </Row>
          <Row label="화면 설정 초기화" hint="이 기기의 패널 폭·편집기·트리·단축키 설정을 처음 값으로(모든 기기 공통 설정은 그대로)" query={query}>
            <button type="button" onClick={() => resetPrefs()}>
              초기화
            </button>
          </Row>
        </>
      );
    case "editor":
      return (
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
          <Row label="Live Preview" hint="편집 중 렌더링: 커서가 없는 줄은 기호를 숨기고, 이미지·콜아웃·수식·다이어그램·임베드를 그립니다" query={query}>
            <Toggle label="Live Preview" value={prefs.live} onChange={set("live")} />
          </Row>
          <Row label="본문 글꼴" query={query}>
            <Choice label="본문 글꼴" value={prefs.editorFont} onChange={set("editorFont")} options={[{ value: "sans", label: "고딕(기본)" }, { value: "serif", label: "명조" }, { value: "mono", label: "고정폭" }]} />
          </Row>
          <Row label="글자 크기" query={query}>
            <Choice label="글자 크기" value={String(prefs.editorSize)} onChange={(v) => setPrefs({ editorSize: Number(v) })} options={[14, 15, 16, 17, 18, 20].map((n) => ({ value: String(n), label: `${n}px` }))} />
          </Row>
          <Row label="읽기 폭" hint="본문을 약 760px 폭으로 가운데 정렬합니다. 끄면 화면 폭을 다 씁니다" query={query}>
            <Toggle label="읽기 폭" value={prefs.readableWidth} onChange={set("readableWidth")} />
          </Row>
          <Row label="줄 번호" query={query}>
            <Toggle label="줄 번호" value={prefs.lineNumbers} onChange={set("lineNumbers")} />
          </Row>
          <Row label="문서 위에 속성 보기" hint="속성(프런트매터)은 오른쪽 패널 '속성' 탭에서 봅니다. 켜면 미리보기 본문 위에도 원문을 보입니다" query={query}>
            <Toggle label="문서 위에 속성 보기" value={prefs.propsInDoc} onChange={set("propsInDoc")} />
          </Row>
        </>
      );
    case "files":
      return <FilesSettings query={query} shared={shared} />;
    case "daily":
      return <DailySettings query={query} shared={shared} onMigrate={onMigrateDaily} />;
    case "keys":
      return <KeySettings commands={commands} query={query} />;
    case "device":
      return localContext ? <SyncSettings ctx={localContext} onOpen={onOpen} /> : null;
    default:
      return <ServerSettings section={id} folders={folders} />;
  }
}

function FilesSettings({ query, shared }: { query: string; shared: VaultSettings }) {
  const prefs = usePrefs();
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs({ [k]: v } as Partial<Prefs>);
  const attachMode = shared.attachmentFolder === "." ? "same" : shared.attachmentFolder.startsWith("./") ? "beside" : "vault";
  const [picker, setPicker] = useState<{ x: number; y: number; folder: string } | null>(null);
  const icons = Object.entries(shared.folderIcons).sort((a, b) => a[0].localeCompare(b[0], "ko"));
  return (
    <>
      <Row label="첨부 파일 위치" shared hint="붙여넣거나 끌어 놓은 이미지·파일을 둘 곳" query={query}>
        <Choice
          label="첨부 파일 위치"
          value={attachMode}
          onChange={(m) => void updateVaultSetting("attachmentFolder", m === "same" ? "." : m === "beside" ? "./attachments" : "첨부").catch(toastError)}
          options={[
            { value: "beside", label: "문서 옆 하위 폴더" },
            { value: "same", label: "문서와 같은 폴더" },
            { value: "vault", label: "볼트의 한 폴더" },
          ]}
        />
        {attachMode !== "same" && (
          <SharedText
            label={attachMode === "beside" ? "하위 폴더 이름" : "첨부 폴더"}
            value={attachMode === "beside" ? shared.attachmentFolder.slice(2) : shared.attachmentFolder}
            placeholder={attachMode === "beside" ? "attachments" : "첨부"}
            check={(v) => (!v ? "이름을 입력하세요" : /(^|\/)\.|\.\.|[\\:*?"<>|]/.test(v) ? "쓸 수 없는 이름입니다" : null)}
            onSave={(v) => updateVaultSetting("attachmentFolder", attachMode === "beside" ? `./${v.replace(/^\.\/+/, "")}` : v.replace(/^\/+|\/+$/g, ""))}
          />
        )}
      </Row>
      <Row label="새 링크 모양" shared hint="첨부를 넣거나 링크를 복사할 때: 겹치지 않는 가장 짧은 이름, 또는 볼트 전체 경로" query={query}>
        <Choice label="새 링크 모양" value={shared.linkFormat} onChange={(v) => void saveShared("linkFormat")(v).catch(toastError)} options={[{ value: "shortest", label: "가장 짧은 이름" }, { value: "full", label: "전체 경로" }]} />
      </Row>
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
      <Row label="폴더 아이콘" shared hint={icons.length ? "트리에서 폴더를 오른쪽 클릭 → 아이콘 바꾸기로 더합니다" : "아직 없습니다. 트리에서 폴더를 오른쪽 클릭 → 아이콘 바꾸기"} query={query}>
        <span className="folder-icons">
          {icons.map(([f, icon]) => (
            <button
              key={f}
              type="button"
              className="folder-icon-chip"
              title={`${f} 아이콘 바꾸기`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPicker({ x: r.left, y: r.bottom + 4, folder: f });
              }}
            >
              {icon} {f}
            </button>
          ))}
        </span>
      </Row>
      {picker && (
        <IconPicker
          at={picker}
          value={shared.folderIcons[picker.folder]}
          title={`${picker.folder} 폴더 아이콘`}
          onClose={() => setPicker(null)}
          onPick={(icon) => {
            const next = { ...shared.folderIcons };
            if (icon) next[picker.folder] = icon;
            else delete next[picker.folder];
            void updateVaultSetting("folderIcons", next).catch(toastError);
          }}
        />
      )}
    </>
  );
}

const WEEK_LABEL = { monday: "월요일(ISO 8601)", sunday: "일요일(ISO 아님)" };

function DailySettings({ query, shared, onMigrate }: { query: string; shared: VaultSettings; onMigrate: () => void }) {
  const prefs = usePrefs();
  const preset = DAILY_PRESETS.find((p) => p.format === shared.dailyFormat)?.id ?? "custom";
  const [custom, setCustom] = useState(preset === "custom");
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const isCustom = custom || preset === "custom";
  const check = (format: string) => dailyFormatProblem(shared.dailyFolder, format);
  return (
    <>
      <Row label="데일리 노트 폴더" shared query={query}>
        <SharedText label="데일리 노트 폴더" value={shared.dailyFolder} placeholder="일기" check={(v) => dailyFormatProblem(v, shared.dailyFormat)} onSave={saveShared("dailyFolder")} />
      </Row>
      <Row
        label="묶음 방식"
        shared
        hint={isCustom ? "토큰: YYYY MM DD M D · 주차 WW W · 주 기준 연도 GGGG · 월 이름 MMMM · 요일 ddd dddd · [글자] · /는 하위 폴더" : "같은 형식을 모든 기기가 써야 같은 날 노트가 한 곳에 생깁니다"}
        query={query}
      >
        <select
          aria-label="묶음 방식"
          value={isCustom ? "custom" : preset}
          onChange={(e) => {
            if (e.target.value === "custom") return setCustom(true);
            setCustom(false);
            void updateVaultSetting("dailyFormat", DAILY_PRESETS.find((p) => p.id === e.target.value)!.format).catch(toastError);
          }}
        >
          {DAILY_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.format})
            </option>
          ))}
          <option value="custom">직접 입력</option>
        </select>
        {isCustom && <SharedText label="데일리 노트 형식" value={shared.dailyFormat} placeholder="YYYY-MM-DD" check={check} onSave={saveShared("dailyFormat")} />}
      </Row>
      <Row label="주 시작 요일" shared hint={shared.dailyWeekStart === "sunday" ? "일요일 시작은 ISO 8601이 아닙니다: 주차(WW)와 week 속성이 다른 앱의 ISO 주차와 다를 수 있습니다" : "ISO 8601: 월요일 시작, 그해 첫 목요일이 든 주가 1주차"} query={query}>
        <Choice label="주 시작 요일" value={shared.dailyWeekStart} onChange={(v) => void saveShared("dailyWeekStart")(v).catch(toastError)} options={(["monday", "sunday"] as const).map((v) => ({ value: v, label: WEEK_LABEL[v] }))} />
      </Row>
      {!query && <DailyPreview settings={shared} />}
      <Row label="데일리 노트 템플릿" shared hint="템플릿 문서 경로. 날짜 속성(date·year·month·monthday·week·weekday)은 만들 때 자동으로 들어갑니다" query={query}>
        <SharedText label="데일리 노트 템플릿" value={shared.dailyTemplate} placeholder="템플릿/데일리.md" onSave={saveShared("dailyTemplate")} />
      </Row>
      <Row label="데일리 기본 아이콘" shared hint="데일리 노트를 만들 때 icon 속성으로 넣습니다(템플릿에 icon이 있으면 그것)" query={query}>
        <button
          type="button"
          className="icon-choice"
          aria-label="데일리 기본 아이콘 고르기"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPicker({ x: r.left, y: r.bottom + 4 });
          }}
        >
          {shared.dailyIcon || "없음"}
        </button>
      </Row>
      <Row label="템플릿 폴더" shared hint={'이 아래 문서가 "템플릿 넣기" 목록에 나옵니다. 변수: {{title}} {{date}} {{time}} {{date:YYYY년 M월 D일 dddd}}'} query={query}>
        <SharedText label="템플릿 폴더" value={shared.templateFolder} placeholder="템플릿" onSave={saveShared("templateFolder")} />
      </Row>
      <Row label="제목 없는 데일리 노트를 읽기 좋은 날짜로" hint="트리·탭·빠른 열기에서 2026-10-07 대신 10월 7일 (수)" query={query}>
        <Toggle label="읽기 좋은 날짜" value={prefs.dailyFriendly} onChange={(v) => setPrefs({ dailyFriendly: v })} />
      </Row>
      <Row label="데일리 폴더는 최신이 위로" hint="트리에서 데일리 폴더 안(연·월·주차 묶음 포함)을 날짜 내림차순으로" query={query}>
        <Toggle label="데일리 폴더 최신이 위로" value={prefs.dailySortDesc} onChange={(v) => setPrefs({ dailySortDesc: v })} />
      </Row>
      <Row label="기존 데일리 노트를 새 형식으로 옮기기" hint="데일리 폴더 안에서 이름 앞의 날짜를 읽어 지금 형식의 자리로 옮깁니다(날짜 뒤 제목 유지, 링크 자동 갱신, 한 커밋)" query={query}>
        <button type="button" onClick={onMigrate}>
          미리 보고 옮기기…
        </button>
      </Row>
      <Row label="데일리·템플릿 기본값으로" shared query={query}>
        <button
          type="button"
          onClick={() =>
            void (async () => {
              for (const k of ["dailyFolder", "dailyFormat", "dailyTemplate", "dailyWeekStart", "dailyIcon", "templateFolder"] as const) await updateVaultSetting(k, DEFAULT_VAULT_SETTINGS[k]);
            })().catch(toastError)
          }
        >
          되돌리기
        </button>
      </Row>
      {picker && <IconPicker at={picker} value={shared.dailyIcon} title="데일리 기본 아이콘" onClose={() => setPicker(null)} onPick={(icon) => void updateVaultSetting("dailyIcon", icon ?? "").catch(toastError)} />}
    </>
  );
}

/** 오늘·어제·내일·연말 경계 경로 미리 보기: 주차 묶음에서 연말 날짜가 어느 폴더로 가는지 */
function DailyPreview({ settings }: { settings: VaultSettings }) {
  const rows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const y = today.getFullYear();
    const list: [string, Date][] = [
      ["오늘", today],
      ["어제", shiftDays(today, -1)],
      ["내일", shiftDays(today, 1)],
      ["연말", new Date(y, 11, 31)],
      ["새해 첫날", new Date(y + 1, 0, 1)],
      ["새해 첫 월요일 무렵", new Date(y + 1, 0, 4)],
    ];
    return list.map(([label, d]) => ({ label, day: ymd(d), path: dailyNotePath(settings.dailyFolder, settings.dailyFormat, d, { weekStart: settings.dailyWeekStart }) }));
  }, [settings.dailyFolder, settings.dailyFormat, settings.dailyWeekStart]);
  return (
    <div className="daily-preview" aria-label="경로 미리 보기">
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              <td className="meta">{r.day}</td>
              <td>
                <code>{r.path}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
