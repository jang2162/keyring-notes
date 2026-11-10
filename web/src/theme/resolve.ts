import { composite, isThemeColor, parseCssColor, THEME_DEFAULTS, THEME_TOKENS, toHex } from "@keyring-notes/core";
import type { ThemeChoice } from "../prefs";

/** 받은 테마(sha256 을 확인한 매니페스트에서, 또는 시작 캐시에서) */
export interface ThemePackage {
  id: string;
  version: string;
  name: Record<string, string>;
  colors: { light?: Record<string, string>; dark?: Record<string, string> };
}

export type ThemeMode = "light" | "dark";

/** 화면에 그릴 것. DOM 에 닿는 쪽(theme/apply.ts)은 이것만 쓴다 */
export interface ResolvedTheme {
  /** html[data-theme]. null = 시스템을 CSS 가 따른다 */
  dataTheme: ThemeMode | null;
  /** 지금 그리는 모드 */
  mode: ThemeMode;
  /** THEME_TOKENS 안, isThemeColor 를 지난 것만 — documentElement.style 에 쓴다 */
  tokens: Record<string, string>;
  /** theme-color 메타 두 벌(prefers-color-scheme light·dark)의 #rrggbb */
  metaBg: { light: string; dark: string };
  /** 그리는 받은 테마 */
  packageId: string | null;
  /** 골랐는데 이 기기에 없는 테마 id(고르기 값은 그대로 두고 기본으로 그린다) */
  missing: string | null;
}

const DEFAULT_BG = { light: THEME_DEFAULTS.light["--bg"]!, dark: THEME_DEFAULTS.dark["--bg"]! };

/** 테마가 가진 모드(colors 에 그 키가 있으면) */
export function themeModes(p: ThemePackage): ThemeMode[] {
  return (["light", "dark"] as const).filter((m) => p.colors[m] !== undefined);
}

/** 모르는 토큰·나쁜 값은 버린다 — 캐시나 손으로 고친 값이 와도 DOM 에는 검사를 지난 색만 닿는다 */
function cleanTokens(colors: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors ?? {})) if (THEME_TOKENS.includes(k) && isThemeColor(v)) out[k] = v;
  return out;
}

/** 일부 브라우저는 메타의 oklch() 를 못 읽는다 — 늘 #rrggbb, 반투명은 그 모드 기본 바탕 위에 합성 */
function metaColor(bg: string | undefined, mode: ThemeMode): string {
  const c = bg ? parseCssColor(bg) : null;
  if (!c) return DEFAULT_BG[mode];
  return toHex(c.a < 1 ? composite(c, parseCssColor(DEFAULT_BG[mode])!) : c);
}

export function resolveTheme(choice: ThemeChoice, pkgs: ThemePackage[], env: { systemDark: boolean; escape: boolean }): ResolvedTheme {
  const system: ResolvedTheme = {
    dataTheme: null,
    mode: env.systemDark ? "dark" : "light",
    tokens: {},
    metaBg: { ...DEFAULT_BG },
    packageId: null,
    missing: null,
  };
  if (choice === "system") return system;
  if (choice === "light" || choice === "dark")
    return { ...system, dataTheme: choice, mode: choice, metaBg: { light: DEFAULT_BG[choice], dark: DEFAULT_BG[choice] } };
  if (env.escape) return system;
  const p = pkgs.find((x) => x.id === choice);
  if (!p) return { ...system, missing: choice };
  const modes = themeModes(p);
  // 둘 다(또는 어느 쪽도 없으면) 시스템을 따르고, 한쪽만이면 늘 그쪽
  const mode: ThemeMode = modes.length === 1 ? modes[0]! : env.systemDark ? "dark" : "light";
  const tokens = cleanTokens(p.colors[mode]);
  const bg = metaColor(tokens["--bg"], mode);
  return { dataTheme: mode, mode, tokens, metaBg: { light: bg, dark: bg }, packageId: p.id, missing: null };
}
