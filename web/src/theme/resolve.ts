import { composite, contrastRatio, isThemeColor, parseCssColor, THEME_DEFAULTS, THEME_TOKENS, toHex } from "@keyring-notes/core";
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

/** --on-accent 를 고를 때의 두 후보 — 기본 테마의 밝음·어두움 값 */
const ON_ACCENT = [THEME_DEFAULTS.light["--on-accent"]!, THEME_DEFAULTS.dark["--on-accent"]!] as const;

/**
 * --accent 에서 나오는 두 토큰을 테마가 안 주면 그 테마의 --accent 로 채운다. 두 토큰보다 먼저 나온 테마는 이것을 모르므로,
 * 채우지 않으면 기본 테마의 값이 그 테마의 강조색 위에 얹힌다(어두운 강조색 위에 어두운 글자 등).
 * - --accent-text: 그 --accent 그대로(두 토큰이 생기기 전과 같은 화면).
 * - --on-accent: ON_ACCENT 중 --accent 와 대비가 큰 쪽. 반투명 --accent 는 그 모드 바탕(테마 --bg, 반투명이면 기본 바탕 위에 합성) 위에 합성해 잰다.
 *   --accent 를 읽지 못하면 채우지 않는다(그 모드 기본값).
 */
function fillAccentTokens(tokens: Record<string, string>, mode: ThemeMode): void {
  const accent = tokens["--accent"];
  if (accent === undefined) return;
  tokens["--accent-text"] ??= accent;
  if (tokens["--on-accent"] !== undefined) return;
  const c = parseCssColor(accent);
  if (!c) return;
  const base = parseCssColor(DEFAULT_BG[mode])!;
  const own = tokens["--bg"] ? parseCssColor(tokens["--bg"]) : null;
  const bg = own ? (own.a < 1 ? composite(own, base) : own) : base;
  const under = c.a < 1 ? composite(c, bg) : c;
  const [a, b] = ON_ACCENT.map((x) => contrastRatio(parseCssColor(x)!, under)) as [number, number];
  tokens["--on-accent"] = a >= b ? ON_ACCENT[0] : ON_ACCENT[1];
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
  fillAccentTokens(tokens, mode);
  const bg = metaColor(tokens["--bg"], mode);
  return { dataTheme: mode, mode, tokens, metaBg: { light: bg, dark: bg }, packageId: p.id, missing: null };
}
