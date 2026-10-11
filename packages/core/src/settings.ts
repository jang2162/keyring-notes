import { parseDocument, isMap } from "yaml";
import { parseFrontmatter } from "./markdown.js";
import { dailyFormatProblem, type DailyConfig, type DailyLookup, type WeekStart } from "./daily.js";
import { PathError } from "./errors.js";
import { vaultLangOf, vaultText, type VaultLang } from "./vaultText.js";

/**
 * 모든 기기 공통 설정 파일. 볼트 맨 위의 마크다운 문서 하나에 YAML 프런트매터로 둔다.
 * - 마크다운이라 앱 동기화(양방향)를 그대로 탄다. 점으로 시작하는 이름은 동기화·API에서 빠지므로 쓰지 않는다.
 *   동기화는 이 파일만 줄이 아니라 키 단위로 합친다(sync.ts, 충돌 사본을 만들지 않는다).
 * - 트리·빠른 열기·그래프·검색·위젯·속성 통계에서는 숨긴다(파일은 그대로 있어 다른 편집기에서도 보인다).
 * - 서버 동작(링크 해석·데일리 판정·볼트 언어)을 바꾸므로 에이전트는 규칙과 상관없이 읽기까지만(ScopedVault.level).
 * - 볼트 루트에 있어도 워크스페이스가 아니다(nodes.ts workspaceOf).
 *
 * 묶음:
 *   vault       볼트 전체: 볼트 언어(볼트에 남는 글), 새 링크 모양, 워크스페이스 순서
 *   workspaces  워크스페이스별: 데일리(켜기·폴더·형식·템플릿·주 시작·기본 아이콘), 템플릿 폴더, 첨부 폴더
 *               (경로는 모두 워크스페이스 기준)
 *   ui          화면 설정 중 기기를 따라가는 것(테마·화면 언어·편집기·자동 저장·트리 표시·단축키…). 값의 모양은 웹이 정한다
 * 아이콘은 노드 노트의 icon 속성이라 여기에 두지 않는다.
 */
export const VAULT_SETTINGS_PATH = "keyring-settings.md";

export function isVaultSettingsPath(rel: string): boolean {
  return rel === VAULT_SETTINGS_PATH;
}

export interface DailySettings {
  enabled: boolean;
  /** 워크스페이스 기준 폴더 */
  folder: string;
  /** 형식(/가 있으면 하위 폴더) */
  format: string;
  /** 워크스페이스 기준 템플릿 문서 경로 */
  template: string;
  /** 주 시작 요일(주차 토큰·week 속성). 월요일이면 ISO 8601 */
  weekStart: WeekStart;
  /** 만들 때 넣는 아이콘(icon 속성). 빈 값이면 넣지 않는다 */
  icon: string;
}

export interface WorkspaceSettings {
  daily: DailySettings;
  /** 이 아래 문서가 "템플릿 넣기" 목록에 나온다(워크스페이스 기준) */
  templateFolder: string;
  /** 붙여넣은 첨부를 두는 폴더(워크스페이스 기준). 트리에서 숨긴다 */
  attachmentFolder: string;
}

export interface VaultSettings {
  /** 볼트 언어(볼트에 남는 글). 아직 정하지 않았으면 null(처음 만들 때 화면 언어로 정한다) */
  language: VaultLang | null;
  /** 새로 넣는 링크 모양: shortest(겹치지 않는 가장 짧은 이름) · full(볼트 전체 경로) */
  linkFormat: "shortest" | "full";
  /** 워크스페이스 순서(없는 것은 이름순으로 뒤에) */
  workspaceOrder: string[];
  /** 파일에 적힌 워크스페이스별 설정(빠진 값은 workspaceSettings가 채운다) */
  workspaces: Record<string, Partial<Omit<WorkspaceSettings, "daily">> & { daily?: Partial<DailySettings> }>;
  /** 화면 설정 중 따라가는 것(웹이 검사해서 쓴다) */
  ui: Record<string, unknown>;
}

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  language: null,
  linkFormat: "shortest",
  workspaceOrder: [],
  workspaces: {},
  ui: {},
};

/** 볼트 언어(정하지 않았으면 fallback, 그것도 없으면 영어) */
export function vaultLanguage(s: VaultSettings, fallback?: string): VaultLang {
  return s.language ?? vaultLangOf(fallback);
}

const str = (v: unknown, d: string) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : d);
const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, "");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** 기본 워크스페이스 설정(볼트 언어의 폴더 이름) */
export function defaultWorkspaceSettings(lang: VaultLang): WorkspaceSettings {
  const t = vaultText(lang);
  return {
    daily: { enabled: true, folder: t.dailyFolder, format: "YYYY-MM-DD", template: t.dailyTemplate, weekStart: "monday", icon: "📅" },
    templateFolder: t.templateFolder,
    attachmentFolder: t.attachmentFolder,
  };
}

/** 설정 파일 내용 → 설정(없거나 잘못된 값은 빼거나 기본값) */
export function parseVaultSettings(content: string | null | undefined): VaultSettings {
  const fm = content ? parseFrontmatter(content).data : null;
  if (!fm) return { ...DEFAULT_VAULT_SETTINGS, workspaces: {}, ui: {}, workspaceOrder: [] };
  const vault = obj(fm.vault) ?? {};
  const workspaces: VaultSettings["workspaces"] = {};
  for (const [name, raw] of Object.entries(obj(fm.workspaces) ?? {})) {
    const w = obj(raw);
    if (!w || !name.trim()) continue;
    const out: VaultSettings["workspaces"][string] = {};
    const d = obj(w.daily);
    if (d) {
      const daily: Partial<DailySettings> = {};
      if (typeof d.enabled === "boolean") daily.enabled = d.enabled;
      if (d.folder !== undefined) daily.folder = trimSlashes(str(d.folder, ""));
      if (d.format !== undefined && str(d.format, "")) daily.format = str(d.format, "");
      if (d.template !== undefined) daily.template = trimSlashes(str(d.template, ""));
      if (d.weekStart !== undefined) daily.weekStart = d.weekStart === "sunday" ? "sunday" : "monday";
      if (d.icon !== undefined) daily.icon = d.icon === null ? "" : str(d.icon, "");
      out.daily = daily;
    }
    if (w.templateFolder !== undefined) out.templateFolder = trimSlashes(str(w.templateFolder, ""));
    if (w.attachmentFolder !== undefined && trimSlashes(str(w.attachmentFolder, ""))) out.attachmentFolder = trimSlashes(str(w.attachmentFolder, ""));
    workspaces[name] = out;
  }
  return {
    language: vault.language === undefined || vault.language === null || vault.language === "" ? null : vaultLangOf(vault.language),
    linkFormat: vault.linkFormat === "full" ? "full" : "shortest",
    workspaceOrder: Array.isArray(vault.workspaceOrder) ? vault.workspaceOrder.filter((x): x is string => typeof x === "string" && !!x.trim()) : [],
    workspaces,
    ui: obj(fm.ui) ?? {},
  };
}

/** 워크스페이스 하나의 설정(파일 값 + 기본값). 쓸 수 없는 데일리 형식은 기본값으로 본다(같은 날 노트가 엉뚱한 곳에 생기지 않게) */
export function workspaceSettings(s: VaultSettings, workspace: string, fallbackLang?: string): WorkspaceSettings {
  const lang = vaultLanguage(s, fallbackLang);
  const d = defaultWorkspaceSettings(lang);
  const w = s.workspaces[workspace] ?? {};
  const daily: DailySettings = { ...d.daily, ...w.daily };
  if (dailyFormatProblem(daily.folder, daily.format, lang)) daily.format = d.daily.format;
  return {
    daily,
    templateFolder: w.templateFolder ?? d.templateFolder,
    attachmentFolder: w.attachmentFolder ?? d.attachmentFolder,
  };
}

const join = (ws: string, rel: string) => (rel ? `${ws}/${rel}` : ws);

/** 워크스페이스의 데일리 설정(볼트 기준 폴더). 꺼져 있으면 null */
export function dailyConfigFor(s: VaultSettings, workspace: string, fallbackLang?: string): DailyConfig | null {
  const w = workspaceSettings(s, workspace, fallbackLang);
  if (!w.daily.enabled) return null;
  return { folder: join(workspace, w.daily.folder), format: w.daily.format, weekStart: w.daily.weekStart, lang: vaultLanguage(s, fallbackLang) };
}

/** 데일리 조회: workspaces는 지금 볼트의 워크스페이스 목록(all()이 쓴다) */
export function dailyLookup(s: VaultSettings, workspaces: () => Iterable<string>, fallbackLang?: string): DailyLookup {
  const cache = new Map<string, DailyConfig | null>();
  const of = (ws: string | null) => {
    if (!ws) return null;
    if (!cache.has(ws)) cache.set(ws, dailyConfigFor(s, ws, fallbackLang));
    return cache.get(ws)!;
  };
  return {
    of,
    all: () =>
      [...workspaces()].flatMap((ws) => {
        const c = of(ws);
        return c ? [{ workspace: ws, config: c }] : [];
      }),
  };
}

/** 워크스페이스 첨부 폴더(볼트 기준) */
export function attachmentDirFor(s: VaultSettings, workspace: string, fallbackLang?: string): string {
  return join(workspace, workspaceSettings(s, workspace, fallbackLang).attachmentFolder);
}

/** 워크스페이스 템플릿 폴더(볼트 기준, 비어 있으면 "") */
export function templateDirFor(s: VaultSettings, workspace: string, fallbackLang?: string): string {
  const f = workspaceSettings(s, workspace, fallbackLang).templateFolder;
  return f ? join(workspace, f) : "";
}

/** 워크스페이스 순서대로(순서에 없는 것은 이름순으로 뒤에) */
export function orderWorkspaces(s: VaultSettings, names: Iterable<string>): string[] {
  const list = [...new Set(names)];
  const rank = (n: string) => {
    const i = s.workspaceOrder.indexOf(n);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "ko"));
}

/** 설정 키 경로(예: ["workspaces", "개인", "daily", "folder"]) */
export type SettingPath = string[];

/**
 * 설정 값 하나를 바꾼 내용(파일이 없으면 새로 만든다, null이면 그 키를 지운다).
 * 기본값과 같아도 적어 둔다(다른 기기가 기본값을 바꿔도 그대로). 다른 키·주석·순서는 그대로 둔다.
 */
export function setVaultSetting(content: string | null, keyPath: SettingPath, value: unknown, lang: VaultLang = "en"): string {
  if (keyPath.length === 0 || keyPath.some((k) => typeof k !== "string" || !k)) throw new PathError("settings_key");
  const base = content ?? `---\nkeyring: settings\n---\n${vaultText(lang).settingsBody}`;
  return editSettings(base, (doc) => {
    if (value === null || value === undefined) {
      doc.deleteIn(keyPath);
      // 비게 된 상위 묶음도 지운다
      for (let i = keyPath.length - 1; i > 0; i--) {
        const parent = doc.getIn(keyPath.slice(0, i), true);
        if (isMap(parent) && parent.items.length === 0) doc.deleteIn(keyPath.slice(0, i));
        else break;
      }
    } else doc.setIn(keyPath, doc.createNode(value));
  });
}

/** 설정 파일의 프런트매터 객체 전체(키 단위 합치기용). 깨져 있으면 null */
export function settingsObject(content: string | null | undefined): Record<string, unknown> | null {
  if (!content) return {};
  return parseFrontmatter(content).data;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

function editSettings(content: string, edit: (doc: ReturnType<typeof parseDocument>) => void): string {
  const m = FM_RE.exec(content);
  const yamlText = m ? m[1] : "";
  const body = m ? content.slice(m[0].length) : content;
  const doc = parseDocument(yamlText);
  if (doc.errors.length) throw new PathError("settings_yaml", { message: doc.errors[0].message.split("\n")[0] });
  if (doc.contents === null || doc.contents === undefined) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  if (!isMap(doc.contents)) throw new PathError("settings_not_object");
  edit(doc);
  const out = doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).replace(/\n+$/, "");
  return `---\n${out}\n---\n${body}`;
}

/**
 * 프런트매터 객체 전체를 바꿔 쓴다(키 단위 합치기 결과). 본문은 그대로.
 */
export function replaceSettingsObject(content: string | null, data: Record<string, unknown>, lang: VaultLang = "en"): string {
  const base = content ?? `---\nkeyring: settings\n---\n${vaultText(lang).settingsBody}`;
  return editSettings(base, (doc) => {
    doc.contents = doc.createNode(data) as unknown as typeof doc.contents;
  });
}
