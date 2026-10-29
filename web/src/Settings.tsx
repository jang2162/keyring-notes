import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Folder,
  Info,
  Keyboard,
  Languages,
  LayoutGrid,
  PenLine,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DAILY_PRESETS,
  dailyFormatProblem,
  dailyNotePath,
  officialLangOf,
  OFFICIAL_LANGS,
  OFFICIAL_MESSAGES,
  OFFICIAL_NAMES,
  packTemplate,
  parsePack,
  mergePacks,
  baseKey,
  shiftDays,
  translate,
  VAULT_SETTINGS_PATH,
  workspaceSettings,
  ymd,
  APP_VERSION,
  type FormatProblem,
  type LanguagePack,
  type OfficialLang,
  type PackReport,
  type SettingPath,
  type VaultSettings,
} from "@keyring-notes/core";
import {
  DEFAULT_PREFS,
  isLocalOverride,
  resetDevicePrefs,
  resetSharedPrefs,
  setLocalOverride,
  setPrefs,
  sharedPref,
  usePrefs,
  type Prefs,
  type SyncedKey,
} from "./prefs";
import { commandKey, eventCombo, formatCombo, inApp, keyCapture, normalizeCombo, type Command } from "./shortcuts";
import { Modal, useModalControl } from "./Modal";
import { SERVER_SECTIONS, ServerSettings, type ServerSection } from "./Admin";
import { SyncSettings } from "./Sync";
import { localContext } from "./local/boot";
import { updateVaultSetting, useVaultSettings, vaultLang } from "./vaultSettings";
import { IconPicker } from "./IconPicker";
import { LicensesDialog } from "./Licenses";
import { errorText, toast, toastError } from "./toast";
import { getPack, languages, PSEUDO, putPack, removePack, systemLanguage, t, useLang } from "./i18n";
import { confirmDialog, promptDialog } from "./dialog";
import { tipProps } from "./Tooltip";
import { admin } from "./api";
import { available, checkForUpdate, showUpdate, updatesSupported, useAvailableUpdate } from "./update";

export type SettingsSection = "general" | "language" | "editor" | "files" | "workspaces" | "keys" | "device" | "about" | ServerSection;

/** 모바일(좁은 터치 화면)에서는 단축키 화면을 숨긴다(단축키는 데스크톱·웹만 따라간다) */
const isMobile = () => typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false) && window.innerWidth < 900;

/** 묶음(이름·검색 낱말은 메시지 키) */
const SECTIONS: {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  local?: boolean;
  server?: boolean;
  keywords?: string;
  group?: string;
  mobileHidden?: boolean;
}[] = [
  { id: "general", label: "settings.general", icon: SlidersHorizontal },
  { id: "language", label: "settings.language", icon: Languages, keywords: "settings.languageKeywords" },
  { id: "editor", label: "settings.editor", icon: PenLine },
  { id: "files", label: "settings.files", icon: Folder },
  { id: "workspaces", label: "settings.workspaces", icon: LayoutGrid, keywords: "settings.workspacesKeywords" },
  { id: "keys", label: "settings.keys", icon: Keyboard, keywords: "settings.keysKeywords", mobileHidden: true },
  { id: "device", label: "settings.device", icon: RefreshCw, local: true, keywords: "settings.deviceKeywords" },
  { id: "about", label: "settings.about", icon: Info, keywords: "settings.aboutKeywords" },
  ...SERVER_SECTIONS.map((s) => ({ ...s, server: true, group: "settings.server" })),
];

export function sectionLabel(id: SettingsSection): string {
  const key = SECTIONS.find((s) => s.id === id)?.label;
  return key ? t(key) : id;
}

/** 검색: 지금 언어와 영어 둘 다로 찾는다 */
const both = (key: string) => `${t(key)} ${translate("en", key)}`.toLowerCase();

/**
 * 설정 한 줄: 검색에 걸리도록 이름·설명(메시지 키)을 같이 둔다.
 * scope: "vault"(모든 기기 공통 설정 파일), "device"(이 기기), 따라가는 화면 설정이면 synced(키)를 준다.
 */
function Row({
  label,
  hint,
  hintNode,
  children,
  query,
  scope,
  synced,
  sharedText,
}: {
  label: string;
  hint?: string;
  hintNode?: ReactNode;
  children: ReactNode;
  query: string;
  scope?: "vault" | "device";
  synced?: SyncedKey;
  /** 이 기기에서만 다르게 쓰는 중일 때 흐리게 보일 공통 값 */
  sharedText?: string;
}) {
  useLang();
  const q = query.trim().toLowerCase();
  if (q && !`${both(label)} ${hint ? both(hint) : ""}`.includes(q)) return null;
  const local = synced ? isLocalOverride(synced) : false;
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">
          {t(label)}
          {synced ? (
            <span
              className={local ? "badge-device" : "badge-shared"}
              {...tipProps({ label: local ? t("settings.scope.deviceOnlyTip") : t("settings.scope.allTip") })}
            >
              {local ? t("settings.scope.device") : t("settings.scope.all")}
            </span>
          ) : scope === "vault" ? (
            <span className="badge-shared" {...tipProps({ label: t("settings.scope.vaultTip", { file: VAULT_SETTINGS_PATH }) })}>
              {t("settings.scope.all")}
            </span>
          ) : scope === "device" ? (
            <span className="badge-device" {...tipProps({ label: t("settings.scope.deviceTip") })}>
              {t("settings.scope.device")}
            </span>
          ) : null}
        </div>
        {(hint || hintNode) && <div className="setting-hint">{hintNode ?? t(hint!)}</div>}
        {synced && local && sharedText !== undefined && <div className="setting-shared-value">{t("settings.scope.sharedValue", { value: sharedText })}</div>}
      </div>
      <div className="setting-control">
        {children}
        {synced && (
          <label className="device-only" {...tipProps({ label: t("settings.scope.overrideTip") })}>
            <input type="checkbox" checked={local} onChange={(e) => setLocalOverride(synced, e.target.checked)} />
            {t("settings.scope.override")}
          </label>
        )}
      </div>
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

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
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
function SharedText({
  value,
  label,
  placeholder,
  check,
  onSave,
}: {
  value: string;
  label: string;
  placeholder?: string;
  check?: (v: string) => string | null;
  onSave: (v: string) => Promise<void>;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const err = v.trim() === value ? null : (check?.(v.trim()) ?? null);
  const commit = () => {
    const x = v.trim();
    if (x === value || err) return;
    void onSave(x).catch((e) => {
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
      {err && (
        <span className="setting-error" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}

const saveShared = (path: SettingPath) => (v: unknown) => updateVaultSetting(path, v).catch(toastError);

/** 형식 문제 → 글 */
export function formatProblemText(p: FormatProblem): string {
  return t(`daily.problem.${p.code}`, { segment: p.segment ?? "" });
}

/** 워크스페이스 관리(Workspace.tsx가 준다) */
export interface WorkspaceOps {
  names: string[];
  current: string;
  iconOf: (name: string) => string | null;
  create: (name: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  reorder: (names: string[]) => Promise<void>;
  /** 확인을 받고 지운다(취소하면 아무것도 하지 않는다) */
  remove: (name: string) => Promise<void>;
  pickIcon: (name: string, at: { x: number; y: number }) => void;
  open: (name: string) => void;
}

export function SettingsModal({
  section,
  onSection,
  onClose,
  commands,
  local,
  folders,
  workspaces,
  dailyWorkspace,
  onOpen,
  onMigrateDaily,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  commands: Command[];
  local: boolean;
  folders: string[];
  workspaces: WorkspaceOps;
  dailyWorkspace: string;
  onOpen: (p: string) => void;
  onMigrateDaily: (workspace: string) => void;
}) {
  useLang();
  const [query, setQuery] = useState("");
  const mobile = isMobile();
  const sections = SECTIONS.filter((s) => (s.local ? local : s.server ? !local : true) && !(s.mobileHidden && mobile));
  const current = sections.some((s) => s.id === section) ? section : "general";
  const q = query.trim().toLowerCase();
  // 검색 중에는 맞는 묶음을 한 화면에: 줄(Row)로 된 묶음은 맞는 줄만, 낱말이 있는 묶음은 이름·낱말이 맞을 때
  const shown = q ? sections.filter((s) => !s.keywords || `${both(s.label)} ${both(s.keywords)}`.includes(q)).map((s) => s.id) : [current];
  let lastGroup: string | undefined;

  return (
    <Modal
      title={t("settings.title")}
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
          renderGroup={(gr) => {
            if (!gr || gr === lastGroup) return null;
            lastGroup = gr;
            return <div className="nav-group">{t(gr)}</div>;
          }}
        />
      }
    >
      {shown.map((id) => (
        <section key={id} className={`settings-section${sections.find((s) => s.id === id)?.keywords ? " keep" : ""}`}>
          <h2>{sectionLabel(id)}</h2>
          <SectionBody
            id={id}
            query={query}
            commands={commands}
            folders={folders}
            workspaces={workspaces}
            dailyWorkspace={dailyWorkspace}
            onOpen={onOpen}
            onMigrateDaily={onMigrateDaily}
            local={local}
          />
        </section>
      ))}
      {q && <p className="meta settings-noresult">{t("settings.noResult")}</p>}
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
  const update = useAvailableUpdate();
  return (
    <>
      <label className="settings-search">
        <Search size={14} aria-hidden />
        <input type="search" placeholder={t("settings.search")} value={query} onChange={(e) => onQuery(e.target.value)} aria-label={t("settings.search")} />
        {query && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t("settings.searchClear")}
            {...tipProps({ label: t("settings.searchClear") })}
            onClick={() => onQuery("")}
          >
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
            <s.icon size={15} strokeWidth={1.75} aria-hidden />
            <span className="settings-tab-label">{t(s.label)}</span>
            {s.id === "about" && update && <span className="update-dot" role="img" aria-label={t("update.availableShort", { version: update.version })} />}
          </button>
        </span>
      ))}
    </>
  );
}

function SectionBody({
  id,
  query,
  commands,
  folders,
  workspaces,
  dailyWorkspace,
  onOpen,
  onMigrateDaily,
  local,
}: {
  id: SettingsSection;
  query: string;
  commands: Command[];
  folders: string[];
  workspaces: WorkspaceOps;
  dailyWorkspace: string;
  onOpen: (p: string) => void;
  onMigrateDaily: (workspace: string) => void;
  local: boolean;
}) {
  const prefs = usePrefs();
  const shared = useVaultSettings();
  const set =
    <K extends keyof Prefs>(k: K) =>
    (v: Prefs[K]) =>
      setPrefs({ [k]: v } as Partial<Prefs>);
  const themeLabel = (v: Prefs["theme"]) => t(`theme.${v}`);
  const onOff = (v: boolean) => (v ? t("common.on") : t("common.off"));
  switch (id) {
    case "general":
      return (
        <>
          <Row label="settings.theme" hint="settings.themeHint" query={query} synced="theme" sharedText={themeLabel(sharedPref("theme"))}>
            <Choice
              label={t("settings.theme")}
              value={prefs.theme}
              onChange={set("theme")}
              options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: themeLabel(v) }))}
            />
          </Row>
          <Row label="settings.showIcons" hint="settings.showIconsHint" query={query} synced="showIcons" sharedText={onOff(sharedPref("showIcons"))}>
            <Toggle label={t("settings.showIcons")} value={prefs.showIcons} onChange={set("showIcons")} />
          </Row>
          <Row label="settings.railLabels" hint="settings.railLabelsHint" query={query} synced="railLabels" sharedText={onOff(sharedPref("railLabels"))}>
            <Toggle label={t("settings.railLabels")} value={prefs.railLabels} onChange={set("railLabels")} />
          </Row>
          <Row
            label="settings.sharedFile"
            hintNode={t("settings.sharedFileHint", { file: VAULT_SETTINGS_PATH })}
            hint="settings.sharedFileHint"
            query={query}
            scope="vault"
          >
            <button type="button" onClick={() => onOpen(VAULT_SETTINGS_PATH)}>
              {t("settings.openRaw")}
            </button>
          </Row>
          <Row label="settings.resetDevice" hint="settings.resetDeviceHint" query={query} scope="device">
            <button type="button" onClick={() => resetDevicePrefs()}>
              {t("common.reset")}
            </button>
          </Row>
          <Row label="settings.resetShared" hint="settings.resetSharedHint" query={query} scope="vault">
            <button type="button" onClick={() => void confirmDialog(t("settings.resetSharedAsk"), t("common.reset")).then((ok) => ok && resetSharedPrefs())}>
              {t("common.reset")}
            </button>
          </Row>
        </>
      );
    case "language":
      return <LanguageSettings query={query} shared={shared} local={local} />;
    case "editor":
      return (
        <>
          <Row label="settings.autosave" hint="settings.autosaveHint" query={query} synced="autosave" sharedText={onOff(sharedPref("autosave"))}>
            <Toggle label={t("settings.autosave")} value={prefs.autosave} onChange={set("autosave")} />
          </Row>
          <Row
            label="settings.autosaveDelay"
            hint="settings.autosaveDelayHint"
            query={query}
            synced="autosaveDelay"
            sharedText={t("settings.seconds", { n: sharedPref("autosaveDelay") / 1000 })}
          >
            <Choice
              label={t("settings.autosaveDelay")}
              value={String(prefs.autosaveDelay)}
              onChange={(v) => setPrefs({ autosaveDelay: Number(v) })}
              options={[800, 1500, 3000, 10000].map((ms) => ({ value: String(ms), label: t("settings.seconds", { n: ms / 1000 }) }))}
            />
          </Row>
          <Row label="settings.live" hint="settings.liveHint" query={query} synced="live" sharedText={onOff(sharedPref("live"))}>
            <Toggle label="Live Preview" value={prefs.live} onChange={set("live")} />
          </Row>
          <Row label="settings.font" query={query} synced="editorFont" sharedText={t(`font.${sharedPref("editorFont")}`)}>
            <Choice
              label={t("settings.font")}
              value={prefs.editorFont}
              onChange={set("editorFont")}
              options={(["sans", "serif", "mono"] as const).map((v) => ({ value: v, label: t(`font.${v}`) }))}
            />
          </Row>
          <Row label="settings.fontSize" query={query} synced="editorSize" sharedText={`${sharedPref("editorSize")}px`}>
            <FontSize value={prefs.editorSize} onChange={(v) => setPrefs({ editorSize: v })} />
          </Row>
          <Row label="settings.readable" hint="settings.readableHint" query={query} synced="readableWidth" sharedText={onOff(sharedPref("readableWidth"))}>
            <Toggle label={t("settings.readable")} value={prefs.readableWidth} onChange={set("readableWidth")} />
          </Row>
          <Row label="settings.lineNumbers" query={query} synced="lineNumbers" sharedText={onOff(sharedPref("lineNumbers"))}>
            <Toggle label={t("settings.lineNumbers")} value={prefs.lineNumbers} onChange={set("lineNumbers")} />
          </Row>
          <Row label="settings.propsInDoc" hint="settings.propsInDocHint" query={query} synced="propsInDoc" sharedText={onOff(sharedPref("propsInDoc"))}>
            <Toggle label={t("settings.propsInDoc")} value={prefs.propsInDoc} onChange={set("propsInDoc")} />
          </Row>
        </>
      );
    case "files":
      return (
        <>
          <Row label="settings.linkFormat" hint="settings.linkFormatHint" query={query} scope="vault">
            <Choice
              label={t("settings.linkFormat")}
              value={shared.linkFormat}
              onChange={(v) => void saveShared(["vault", "linkFormat"])(v)}
              options={[
                { value: "shortest", label: t("settings.linkShortest") },
                { value: "full", label: t("settings.linkFull") },
              ]}
            />
          </Row>
          <Row
            label="settings.treeAttachments"
            hint="settings.treeAttachmentsHint"
            query={query}
            synced="treeAttachments"
            sharedText={t(`settings.attach.${sharedPref("treeAttachments")}`)}
          >
            <Choice
              label={t("settings.treeAttachments")}
              value={prefs.treeAttachments}
              onChange={set("treeAttachments")}
              options={(["show", "hide"] as const).map((v) => ({ value: v, label: t(`settings.attach.${v}`) }))}
            />
          </Row>
          <Row
            label="settings.backlinksInDoc"
            hint="settings.backlinksInDocHint"
            query={query}
            synced="backlinksInDoc"
            sharedText={onOff(sharedPref("backlinksInDoc"))}
          >
            <Toggle label={t("settings.backlinksInDoc")} value={prefs.backlinksInDoc} onChange={set("backlinksInDoc")} />
          </Row>
          <Row
            label="settings.dailyFriendly"
            hint="settings.dailyFriendlyHint"
            query={query}
            synced="dailyFriendly"
            sharedText={onOff(sharedPref("dailyFriendly"))}
          >
            <Toggle label={t("settings.dailyFriendly")} value={prefs.dailyFriendly} onChange={set("dailyFriendly")} />
          </Row>
          <Row
            label="settings.dailySortDesc"
            hint="settings.dailySortDescHint"
            query={query}
            synced="dailySortDesc"
            sharedText={onOff(sharedPref("dailySortDesc"))}
          >
            <Toggle label={t("settings.dailySortDesc")} value={prefs.dailySortDesc} onChange={set("dailySortDesc")} />
          </Row>
        </>
      );
    case "workspaces":
      return <WorkspaceSettings query={query} shared={shared} ops={workspaces} initial={dailyWorkspace} onMigrate={onMigrateDaily} />;
    case "keys":
      return <KeySettings commands={commands} query={query} />;
    case "device":
      return localContext ? <SyncSettings ctx={localContext} onOpen={onOpen} /> : null;
    case "about":
      return <AboutSettings />;
    default:
      return <ServerSettings section={id} folders={folders} />;
  }
}

/** 오픈 소스 라이선스: 이 판에 든 제3자 소프트웨어의 고지를 연다 */
function LicensesRow({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Row label="settings.licenses" hint="settings.licensesHint" query={query}>
      <button type="button" onClick={() => setOpen(true)}>
        {t("common.open")}
      </button>
      {open && <LicensesDialog onClose={() => setOpen(false)} />}
    </Row>
  );
}

/**
 * 정보: 지금 버전, 데스크톱 앱 업데이트(새 버전 알림·지금 확인·실행 때 자동 확인), 오픈 소스 라이선스.
 * 검색 낱말(settings.aboutKeywords)이 맞으면 묶음이 통째로 보이므로 줄은 거르지 않는다
 */
function AboutSettings() {
  const prefs = usePrefs();
  const update = useAvailableUpdate();
  const [busy, setBusy] = useState(false);
  // 사람이 누른 확인은 찾으면 바로 대화상자를 띄우고, 새 버전이 있다는 상태(레드닷)도 함께 바꾼다
  const checkNow = async () => {
    setBusy(true);
    try {
      const u = await checkForUpdate();
      available.set(u);
      if (u) showUpdate(u);
      else toast(t("update.latest", { version: APP_VERSION }), { kind: "success" });
    } catch (e) {
      toast(t("update.checkFailed", { message: errorText(e) }), { kind: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Row label="settings.version" query="">
        <span className="meta">{APP_VERSION}</span>
      </Row>
      {updatesSupported() && (
        <>
          {update && (
            <div className="update-available">
              <Row label="update.title" hintNode={t("settings.updateAvailableHint", { version: update.version, current: update.currentVersion })} query="">
                <button type="button" className="on" onClick={() => showUpdate(update)}>
                  {t("settings.updateOpen")}
                </button>
              </Row>
            </div>
          )}
          <Row label="settings.updateNow" hint="settings.updateNowHint" query="">
            <button type="button" onClick={() => void checkNow()} disabled={busy}>
              {busy ? t("update.checking") : t("settings.updateNow")}
            </button>
          </Row>
          <Row label="settings.updateCheck" hint="settings.updateCheckHint" query="" scope="device">
            <Toggle label={t("settings.updateCheck")} value={prefs.updateCheck} onChange={(v) => setPrefs({ updateCheck: v })} />
          </Row>
        </>
      )}
      <LicensesRow query="" />
    </>
  );
}

/** 글자 크기: 끌어 바꾸는 슬라이더(멈춘 뒤 한 번만 공통 설정에 쓴다 — prefs.ts) */
function FontSize({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="font-size">
      <input type="range" min={12} max={24} step={1} value={value} aria-label={t("settings.fontSize")} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="meta">{value}px</span>
    </span>
  );
}

const WEEK = ["monday", "sunday"] as const;

/** 워크스페이스: 만들기·이름·아이콘·순서, 워크스페이스별 데일리·템플릿·첨부 폴더(공통 설정 파일) */
function WorkspaceSettings({
  query,
  shared,
  ops,
  initial,
  onMigrate,
}: {
  query: string;
  shared: VaultSettings;
  ops: WorkspaceOps;
  initial: string;
  onMigrate: (ws: string) => void;
}) {
  const [sel, setSel] = useState(ops.names.includes(initial) ? initial : (ops.names[0] ?? ""));
  useEffect(() => {
    if (!ops.names.includes(sel)) setSel(ops.names.includes(initial) ? initial : (ops.names[0] ?? ""));
  }, [ops.names, sel, initial]);
  const lang = officialLangOf(useLang());
  const busy = useRef(false);
  const run = (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    void fn()
      .catch(toastError)
      .finally(() => (busy.current = false));
  };
  const move = (i: number, d: -1 | 1) => {
    const list = [...ops.names];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    run(() => ops.reorder(list));
  };
  const q = query.trim().toLowerCase();
  const ws = sel;
  const w = ws ? workspaceSettings(shared, ws, lang) : null;
  const path = (...k: string[]): SettingPath => ["workspaces", ws, ...k];
  const preset = w ? (DAILY_PRESETS.find((p) => p.format === w.daily.format)?.id ?? "custom") : "flat";
  const [custom, setCustom] = useState(false);
  const isCustom = custom || preset === "custom";
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const check = (format: string) => {
    const p = w ? dailyFormatProblem(w.daily.folder, format, vaultLang()) : null;
    return p ? formatProblemText(p) : null;
  };
  const nameCheck = (v: string) => (!v ? t("name.empty") : /(^|\/)\.|\.\.|[\\:*?"<>|]/.test(v) ? t("settings.badFolder") : null);
  return (
    <>
      {(!q || both("settings.workspaces").includes(q) || both("settings.workspacesKeywords").includes(q)) && (
        <div className="ws-list">
          {ops.names.map((name, i) => (
            <div key={name} className={`ws-item${name === sel ? " on" : ""}`}>
              <button
                type="button"
                className="ws-icon-btn"
                aria-label={t("icon.of", { name })}
                {...tipProps({ label: t("icon.of", { name }) })}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  ops.pickIcon(name, { x: r.left, y: r.bottom + 4 });
                }}
              >
                {ops.iconOf(name) ?? <span className="ws-letter">{[...name][0]}</span>}
              </button>
              <button type="button" className="ws-name" aria-pressed={name === sel} onClick={() => setSel(name)}>
                {name}
                {name === ops.current && <span className="meta"> · {t("ws.currentShort")}</span>}
              </button>
              <span className="ws-tools">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("ws.up", { name })}
                  {...tipProps({ label: t("ws.upShort") })}
                  aria-disabled={i === 0 || undefined}
                  onClick={() => i > 0 && move(i, -1)}
                >
                  <ArrowUp size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("ws.down", { name })}
                  {...tipProps({ label: t("ws.downShort") })}
                  aria-disabled={i === ops.names.length - 1 || undefined}
                  onClick={() => i < ops.names.length - 1 && move(i, 1)}
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
                <button type="button" onClick={() => ops.open(name)}>
                  {t("ws.openNote")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void promptDialog(t("ws.renamePrompt", { name }), name, t("common.rename")).then((to) => {
                      if (to && to.trim() !== name) run(() => ops.rename(name, to.trim()));
                    })
                  }
                >
                  {t("common.rename")}
                </button>
                <button type="button" className="danger" aria-label={t("ws.delete", { name })} onClick={() => run(() => ops.remove(name))}>
                  {t("common.delete")}
                </button>
              </span>
            </div>
          ))}
          <button
            type="button"
            className="ws-create"
            onClick={() =>
              void promptDialog(t("ws.createPrompt"), "", t("common.create")).then((name) => {
                if (name?.trim()) run(() => ops.create(name.trim()));
              })
            }
          >
            + {t("ws.create")}
          </button>
          <p className="meta">{t("ws.hint")}</p>
        </div>
      )}
      {ws && w && (
        <>
          <h3 className="ws-settings-head">{t("ws.settingsOf", { name: ws })}</h3>
          <Row label="settings.dailyEnabled" hint="settings.dailyEnabledHint" query={query} scope="vault">
            <Toggle label={t("settings.dailyEnabled")} value={w.daily.enabled} onChange={(v) => void saveShared(path("daily", "enabled"))(v)} />
          </Row>
          {w.daily.enabled && (
            <>
              <Row label="settings.dailyFolder" hint="settings.dailyFolderHint" query={query} scope="vault">
                <SharedText
                  label={t("settings.dailyFolder")}
                  value={w.daily.folder}
                  check={(v) =>
                    nameCheck(v) ??
                    (dailyFormatProblem(v, w.daily.format, vaultLang()) ? formatProblemText(dailyFormatProblem(v, w.daily.format, vaultLang())!) : null)
                  }
                  onSave={(v) => updateVaultSetting(path("daily", "folder"), v.replace(/^\/+|\/+$/g, ""))}
                />
              </Row>
              <Row
                label="settings.dailyGrouping"
                hintNode={isCustom ? t("settings.dailyTokens") : t("settings.dailyGroupingHint")}
                hint="settings.dailyGroupingHint"
                query={query}
                scope="vault"
              >
                <select
                  aria-label={t("settings.dailyGrouping")}
                  value={isCustom ? "custom" : preset}
                  onChange={(e) => {
                    if (e.target.value === "custom") return setCustom(true);
                    setCustom(false);
                    void saveShared(path("daily", "format"))(DAILY_PRESETS.find((p) => p.id === e.target.value)!.format);
                  }}
                >
                  {DAILY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(`daily.preset.${p.id}`)} ({p.format})
                    </option>
                  ))}
                  <option value="custom">{t("daily.preset.custom")}</option>
                </select>
                {isCustom && (
                  <SharedText
                    label={t("settings.dailyFormat")}
                    value={w.daily.format}
                    placeholder="YYYY-MM-DD"
                    check={check}
                    onSave={(v) => updateVaultSetting(path("daily", "format"), v)}
                  />
                )}
              </Row>
              <Row
                label="settings.weekStart"
                hint={w.daily.weekStart === "sunday" ? "settings.weekStartSundayHint" : "settings.weekStartMondayHint"}
                query={query}
                scope="vault"
              >
                <Choice
                  label={t("settings.weekStart")}
                  value={w.daily.weekStart}
                  onChange={(v) => void saveShared(path("daily", "weekStart"))(v)}
                  options={WEEK.map((v) => ({ value: v, label: t(`settings.week.${v}`) }))}
                />
              </Row>
              {!query && <DailyPreview folder={`${ws}/${w.daily.folder}`} format={w.daily.format} weekStart={w.daily.weekStart} />}
              <Row label="settings.dailyTemplate" hint="settings.dailyTemplateHint" query={query} scope="vault">
                <SharedText
                  label={t("settings.dailyTemplate")}
                  value={w.daily.template}
                  onSave={(v) => updateVaultSetting(path("daily", "template"), v.replace(/^\/+/, ""))}
                />
              </Row>
              <Row label="settings.dailyIcon" hint="settings.dailyIconHint" query={query} scope="vault">
                <button
                  type="button"
                  className="icon-choice"
                  aria-label={t("settings.dailyIconPick")}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPicker({ x: r.left, y: r.bottom + 4 });
                  }}
                >
                  {w.daily.icon || t("common.none")}
                </button>
              </Row>
              <Row label="settings.dailyMigrate" hint="settings.dailyMigrateHint" query={query}>
                <button type="button" onClick={() => onMigrate(ws)}>
                  {t("settings.dailyMigrateRun")}
                </button>
              </Row>
            </>
          )}
          <Row label="settings.templateFolder" hint="settings.templateFolderHint" query={query} scope="vault">
            <SharedText
              label={t("settings.templateFolder")}
              value={w.templateFolder}
              onSave={(v) => updateVaultSetting(path("templateFolder"), v.replace(/^\/+|\/+$/g, ""))}
            />
          </Row>
          <Row label="settings.attachmentFolder" hint="settings.attachmentFolderHint" query={query} scope="vault">
            <SharedText
              label={t("settings.attachmentFolder")}
              value={w.attachmentFolder}
              check={nameCheck}
              onSave={(v) => updateVaultSetting(path("attachmentFolder"), v.replace(/^\/+|\/+$/g, ""))}
            />
          </Row>
          <Row label="settings.wsDefaults" hint="settings.wsDefaultsHint" query={query} scope="vault">
            <button type="button" onClick={() => void saveShared(["workspaces", ws])(null)}>
              {t("settings.wsDefaultsRun")}
            </button>
          </Row>
          {picker && (
            <IconPicker
              at={picker}
              value={w.daily.icon}
              title={t("settings.dailyIcon")}
              onClose={() => setPicker(null)}
              onPick={(icon) => void saveShared(path("daily", "icon"))(icon ?? "")}
            />
          )}
        </>
      )}
    </>
  );
}

/** 오늘·어제·내일·연말 경계 경로 미리 보기: 주차 묶음에서 연말 날짜가 어느 폴더로 가는지 */
function DailyPreview({ folder, format, weekStart }: { folder: string; format: string; weekStart: "monday" | "sunday" }) {
  useLang();
  const rows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const y = today.getFullYear();
    const list: [string, Date][] = [
      ["daily.preview.today", today],
      ["daily.preview.yesterday", shiftDays(today, -1)],
      ["daily.preview.tomorrow", shiftDays(today, 1)],
      ["daily.preview.yearEnd", new Date(y, 11, 31)],
      ["daily.preview.newYear", new Date(y + 1, 0, 1)],
      ["daily.preview.firstMonday", new Date(y + 1, 0, 4)],
    ];
    return list.map(([label, d]) => ({ label, day: ymd(d), path: dailyNotePath(folder, format, d, { weekStart, lang: vaultLang() }) }));
  }, [folder, format, weekStart]);
  return (
    <div className="daily-preview" aria-label={t("daily.preview.label")}>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{t(r.label)}</th>
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

// ── 언어 ──

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 언어팩에 없는 키(복수형 범주를 뗀 키) */
function missingKeys(pack: LanguagePack): string[] {
  const have = new Set(Object.keys(pack.messages).map(baseKey));
  return [...new Set(Object.keys(OFFICIAL_MESSAGES[pack.meta.base]).map(baseKey))].filter((k) => !have.has(k)).sort();
}

function LanguageSettings({ query, shared, local }: { query: string; shared: VaultSettings; local: boolean }) {
  const prefs = usePrefs();
  const lang = useLang();
  const [report, setReport] = useState<{ pack: LanguagePack; report: PackReport; merge: boolean } | { error: string } | null>(null);
  const [base, setBase] = useState<OfficialLang>(officialLangOf(lang));
  const fileInput = useRef<HTMLInputElement>(null);
  const [mergeInto, setMergeInto] = useState<string | null>(null);
  const list = languages();
  const nameOf = (id: string) =>
    id === ""
      ? t("lang.system", { name: list.find((l) => l.id === systemLanguage())?.name ?? systemLanguage() })
      : id === PSEUDO
        ? t("lang.pseudo")
        : (list.find((l) => l.id === id)?.name ?? id);
  const sharedLang = sharedPref("language");

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text().catch(() => "");
    const r = parsePack(text);
    if ("error" in r) setReport({ error: t(`lang.pack.error.${r.error}`) });
    else setReport({ ...r, merge: !!mergeInto && mergeInto === r.pack.meta.id });
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <>
      <Row label="settings.uiLanguage" hint="settings.uiLanguageHint" query={query} synced="language" sharedText={nameOf(sharedLang)}>
        <select aria-label={t("settings.uiLanguage")} value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value })}>
          <option value="">{nameOf("")}</option>
          {list.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.official ? "" : ` (${t("lang.unofficial")})`}
            </option>
          ))}
          <option value={PSEUDO}>{nameOf(PSEUDO)}</option>
        </select>
      </Row>
      <Row label="settings.vaultLanguage" hint="settings.vaultLanguageHint" query={query} scope="vault">
        <Choice
          label={t("settings.vaultLanguage")}
          value={shared.language ?? vaultLang()}
          onChange={(v) => void saveShared(["vault", "language"])(v)}
          options={OFFICIAL_LANGS.map((l) => ({ value: l, label: OFFICIAL_NAMES[l] }))}
        />
      </Row>
      {!local && <ServerLanguages query={query} />}
      <Row label="lang.pack.download" hint="lang.pack.downloadHint" query={query} scope="device">
        <span className="row-inline">
          <Choice label={t("lang.pack.base")} value={base} onChange={setBase} options={OFFICIAL_LANGS.map((l) => ({ value: l, label: OFFICIAL_NAMES[l] }))} />
          <button
            type="button"
            onClick={() => download(`keyring-${base}.json`, JSON.stringify(packTemplate(base, { id: "xx", name: "New language" }), null, 1))}
          >
            <Download size={14} aria-hidden /> {t("lang.pack.downloadRun")}
          </button>
        </span>
      </Row>
      <Row label="lang.pack.import" hint="lang.pack.importHint" query={query} scope="device">
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => {
            setMergeInto(null);
            fileInput.current?.click();
          }}
        >
          <Upload size={14} aria-hidden /> {t("lang.pack.importRun")}
        </button>
      </Row>
      {report && <PackReportView state={report} onClose={() => setReport(null)} />}
      {list
        .filter((l) => !l.official)
        .map((l) => {
          const pack = getPack(l.id)!;
          const missing = missingKeys(pack);
          return (
            <div key={l.id} className="setting-row pack-row">
              <div className="setting-text">
                <div className="setting-label">
                  {pack.meta.name} <code>{pack.meta.id}</code>
                  <span className="badge-device">{t("settings.scope.device")}</span>
                </div>
                <div className="setting-hint">
                  {t("lang.pack.info", { base: OFFICIAL_NAMES[pack.meta.base], version: pack.meta.appVersion || "?", author: pack.meta.author || "-" })}
                  {missing.length > 0 && <> · {t("lang.pack.missing", { count: missing.length })}</>}
                </div>
              </div>
              <div className="setting-control">
                {missing.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      download(`keyring-${pack.meta.id}-missing.json`, JSON.stringify(packTemplate(pack.meta.base, { ...pack.meta }, missing), null, 1))
                    }
                  >
                    {t("lang.pack.downloadMissing")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMergeInto(pack.meta.id);
                    fileInput.current?.click();
                  }}
                >
                  {t("lang.pack.update")}
                </button>
                <button type="button" onClick={() => download(`keyring-${pack.meta.id}.json`, JSON.stringify(pack, null, 1))}>
                  {t("lang.pack.export")}
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={t("lang.pack.remove", { name: pack.meta.name })}
                  {...tipProps({ label: t("lang.pack.remove", { name: pack.meta.name }) })}
                  onClick={() =>
                    void confirmDialog(t("lang.pack.removeAsk", { name: pack.meta.name }), t("common.delete")).then((ok) => ok && removePack(pack.meta.id))
                  }
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
    </>
  );
}

/** 불러온 언어팩 검사 결과. 확인하면 이 기기에 더한다(같은 id면 합치거나 바꾼다) */
function PackReportView({ state, onClose }: { state: { pack: LanguagePack; report: PackReport; merge: boolean } | { error: string }; onClose: () => void }) {
  if ("error" in state)
    return (
      <div className="pack-report error" role="alert">
        <p>{state.error}</p>
        <button type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    );
  const { pack, report, merge } = state;
  const existing = getPack(pack.meta.id);
  const add = () => {
    try {
      putPack(existing && merge ? mergePacks(existing, pack) : pack);
      toast(t("lang.pack.added", { name: pack.meta.name }), { kind: "success" });
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  const sample = (list: string[]) => (list.length ? `${list.slice(0, 5).join(", ")}${list.length > 5 ? " …" : ""}` : "");
  return (
    <div className="pack-report" role="status">
      <p>
        <strong>{pack.meta.name}</strong> <code>{pack.meta.id}</code> · {t("lang.pack.baseIs", { base: OFFICIAL_NAMES[pack.meta.base] })}
      </p>
      <ul>
        <li>{t("lang.pack.r.translated", { count: Object.keys(pack.messages).length })}</li>
        {report.missing.length > 0 && <li>{t("lang.pack.r.missing", { count: report.missing.length })}</li>}
        {report.unknown.length > 0 && <li>{t("lang.pack.r.unknown", { count: report.unknown.length, keys: sample(report.unknown) })}</li>}
        {report.placeholderMismatch.length > 0 && (
          <li className="warn">{t("lang.pack.r.placeholders", { count: report.placeholderMismatch.length, keys: sample(report.placeholderMismatch) })}</li>
        )}
        {report.notString.length > 0 && (
          <li className="warn">{t("lang.pack.r.notString", { count: report.notString.length, keys: sample(report.notString) })}</li>
        )}
        {report.htmlLike.length > 0 && <li className="warn">{t("lang.pack.r.html", { count: report.htmlLike.length, keys: sample(report.htmlLike) })}</li>}
      </ul>
      {existing && <p className="meta">{merge ? t("lang.pack.willMerge") : t("lang.pack.willReplace")}</p>}
      <div className="ask-actions">
        <button type="button" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="on" onClick={add}>
          {existing ? (merge ? t("lang.pack.merge") : t("lang.pack.replace")) : t("lang.pack.add")}
        </button>
      </div>
    </div>
  );
}

/** 서버 설정의 언어(소유자): 에이전트 언어(MCP 설명·오류, 기본 영어)와 서버·CLI 언어 */
function ServerLanguages({ query }: { query: string }) {
  const [v, setV] = useState<{ language: string | null; agentLanguage: string } | null>(null);
  useEffect(() => {
    admin
      .language()
      .then(setV)
      .catch(() => setV(null));
  }, []);
  if (!v) return null;
  const save = (patch: Partial<{ language: string | null; agentLanguage: string }>) => admin.setLanguage(patch).then(setV).catch(toastError);
  return (
    <>
      <Row label="settings.agentLanguage" hint="settings.agentLanguageHint" query={query}>
        <Choice
          label={t("settings.agentLanguage")}
          value={v.agentLanguage}
          onChange={(x) => void save({ agentLanguage: x })}
          options={OFFICIAL_LANGS.map((l) => ({ value: l, label: OFFICIAL_NAMES[l] }))}
        />
      </Row>
      <Row label="settings.serverLanguage" hint="settings.serverLanguageHint" query={query}>
        <Choice
          label={t("settings.serverLanguage")}
          value={v.language ?? ""}
          onChange={(x) => void save({ language: x || null })}
          options={[{ value: "", label: t("settings.serverLanguageEnv") }, ...OFFICIAL_LANGS.map((l) => ({ value: l, label: OFFICIAL_NAMES[l] }))]}
        />
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
      setWarn(clash ? t("keys.clash", { key: formatCombo(n), name: clash.label }) : null);
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
      {!readOnly && (
        <Row
          label="settings.keysSynced"
          hint="settings.keysSyncedHint"
          query=""
          synced="keys"
          sharedText={t("keys.changedCount", { count: Object.keys(sharedPref("keys")).length })}
        >
          <span />
        </Row>
      )}
      {!inApp && !readOnly && <p className="meta">{t("keys.webNote")}</p>}
      {warn && <p className="note-ok">{warn}</p>}
      {groups.map((gr) => (
        <div key={gr} className="key-group">
          <h3>{gr}</h3>
          <table className="key-table">
            <tbody>
              {list
                .filter((c) => c.group === gr)
                .map((c) => {
                  const k = commandKey(c, prefs.keys);
                  const changed = c.id in prefs.keys;
                  return (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td className="key-cell">
                        {capturing === c.id ? (
                          <span className="meta">{t("keys.pressNew")}</span>
                        ) : k ? (
                          <kbd>{formatCombo(k)}</kbd>
                        ) : (
                          <span className="meta">{t("common.none")}</span>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="key-actions">
                          <button type="button" onClick={() => setCapturing(c.id)}>
                            {t("common.change")}
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
                              {t("common.default")}
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
          {t("keys.resetAll")}
        </button>
      )}
    </div>
  );
}
