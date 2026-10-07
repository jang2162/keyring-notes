import { parseFrontmatter } from "./markdown.js";
import { setFrontmatterField } from "./frontmatter.js";
import { dailyFormatProblem, type DailyConfig, type WeekStart } from "./daily.js";

/**
 * 모든 기기 공통 설정 파일. 볼트 맨 위의 마크다운 문서 하나에 YAML 프런트매터로 둔다.
 * - 마크다운이라 앱 동기화(양방향)를 그대로 탄다. 점으로 시작하는 이름은 동기화·API에서 빠지므로 쓰지 않는다.
 * - 트리·빠른 열기·그래프·검색·위젯·속성 통계에서는 숨긴다(파일은 그대로 있어 다른 편집기에서도 보인다).
 * - 서버 동작(링크 해석·데일리 판정)을 바꾸므로 에이전트는 규칙과 상관없이 읽기까지만(ScopedVault.level).
 * 테마·패널 폭·단축키처럼 이 기기만의 값은 웹의 keyring:prefs(localStorage)에 둔다.
 */
export const VAULT_SETTINGS_PATH = "keyring-settings.md";

export function isVaultSettingsPath(rel: string): boolean {
  return rel === VAULT_SETTINGS_PATH;
}

export interface VaultSettings {
  /** 데일리 노트 폴더 */
  dailyFolder: string;
  /** 데일리 노트 형식(/가 있으면 하위 폴더) */
  dailyFormat: string;
  /** 데일리 노트 템플릿 문서 경로 */
  dailyTemplate: string;
  /** 주 시작 요일(주차 토큰·week 속성). 월요일이면 ISO 8601 */
  dailyWeekStart: WeekStart;
  /** 데일리 노트를 만들 때 넣는 아이콘(icon 속성). 빈 값이면 넣지 않는다 */
  dailyIcon: string;
  /** 템플릿 폴더: 이 아래 문서가 "템플릿 넣기" 목록에 나온다 */
  templateFolder: string;
  /**
   * 붙여넣은 첨부를 둘 곳. "./이름"이면 문서 옆 폴더(기본 ./attachments), "."이면 문서와 같은 폴더,
   * 그 밖은 볼트 기준 폴더(예: 첨부)
   */
  attachmentFolder: string;
  /** 새로 넣는 링크 모양: shortest(겹치지 않는 가장 짧은 이름) · full(볼트 전체 경로) */
  linkFormat: "shortest" | "full";
  /** 폴더 아이콘: 폴더 경로 → 이모지(폴더에는 프런트매터가 없어서 여기에 둔다) */
  folderIcons: Record<string, string>;
}

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  dailyFolder: "일기",
  dailyFormat: "YYYY-MM-DD",
  dailyTemplate: "템플릿/데일리.md",
  dailyWeekStart: "monday",
  dailyIcon: "📅",
  templateFolder: "템플릿",
  attachmentFolder: "./attachments",
  linkFormat: "shortest",
  folderIcons: {},
};

const str = (v: unknown, d: string) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : d);

/** 설정 파일 내용 → 설정(없거나 잘못된 값은 기본값) */
export function parseVaultSettings(content: string | null | undefined): VaultSettings {
  const fm = content ? parseFrontmatter(content).data : null;
  if (!fm) return { ...DEFAULT_VAULT_SETTINGS, folderIcons: {} };
  const d = DEFAULT_VAULT_SETTINGS;
  const icons: Record<string, string> = {};
  if (fm.folderIcons && typeof fm.folderIcons === "object" && !Array.isArray(fm.folderIcons)) {
    for (const [k, v] of Object.entries(fm.folderIcons as Record<string, unknown>)) {
      const key = k.trim().replace(/^\/+|\/+$/g, "");
      if (key && typeof v === "string" && v.trim()) icons[key] = v.trim();
    }
  }
  const s: VaultSettings = {
    dailyFolder: str(fm.dailyFolder, d.dailyFolder).replace(/^\/+|\/+$/g, ""),
    dailyFormat: str(fm.dailyFormat, d.dailyFormat) || d.dailyFormat,
    dailyTemplate: str(fm.dailyTemplate, d.dailyTemplate),
    dailyWeekStart: fm.dailyWeekStart === "sunday" ? "sunday" : "monday",
    dailyIcon: fm.dailyIcon === null ? "" : str(fm.dailyIcon, d.dailyIcon),
    templateFolder: str(fm.templateFolder, d.templateFolder).replace(/^\/+|\/+$/g, ""),
    attachmentFolder: str(fm.attachmentFolder, d.attachmentFolder) || d.attachmentFolder,
    linkFormat: fm.linkFormat === "full" ? "full" : "shortest",
    folderIcons: icons,
  };
  // 쓸 수 없는 형식(사람이 파일을 직접 고친 경우)이면 기본값으로: 같은 날 노트가 엉뚱한 곳에 생기지 않게
  if (dailyFormatProblem(s.dailyFolder, s.dailyFormat)) s.dailyFormat = d.dailyFormat;
  return s;
}

export function dailyConfigOf(s: VaultSettings): DailyConfig {
  return { folder: s.dailyFolder, format: s.dailyFormat, weekStart: s.dailyWeekStart };
}

const BODY = `
# Keyring Notes 설정

모든 기기(웹·앱·서버)가 같이 쓰는 설정입니다. 앱의 **설정** 화면에서 고치세요.
직접 고쳐도 되지만 위 프런트매터의 이름은 바꾸지 마세요. 이 문서는 트리·검색에는 나오지 않습니다.
`;

/** 설정 하나를 바꾼 내용(파일이 없으면 새로 만든다). 기본값과 같아도 적어 둔다(다른 기기가 기본값을 바꿔도 그대로) */
export function setVaultSetting<K extends keyof VaultSettings>(content: string | null, key: K, value: VaultSettings[K]): string {
  const base = content ?? `---\nkeyring: settings\n---\n${BODY}`;
  const v = key === "folderIcons" && Object.keys(value as object).length === 0 ? null : value;
  return setFrontmatterField(base, key, v);
}
