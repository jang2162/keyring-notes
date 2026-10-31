import type { Prefs } from "./prefs";

/**
 * 설치한 웹 앱(PWA)의 상단 상태 표시줄·하단 영역 색. styles.css 의 `--bg`(밝은·어두운 테마)와 같은 값이다 — 시험이 둘을 맞춰 본다.
 * index.html 의 theme-color 메타 두 벌(prefers-color-scheme light·dark)의 처음 값도 이것이다.
 */
export const THEME_BG = { light: "#ffffff", dark: "#17191c" } as const;

/** 테마 설정에 따른 두 메타(light·dark 미디어 쿼리)의 content. 직접 고른 테마면 시스템 설정과 상관없이 둘 다 그 색 */
export function themeColorContents(theme: Prefs["theme"]): { light: string; dark: string } {
  if (theme === "light") return { light: THEME_BG.light, dark: THEME_BG.light };
  if (theme === "dark") return { light: THEME_BG.dark, dark: THEME_BG.dark };
  return { light: THEME_BG.light, dark: THEME_BG.dark };
}

/** 테마가 바뀔 때 theme-color 메타를 맞춘다. 메타가 없는 문서(시험·다른 진입점)에서는 아무것도 하지 않는다 */
export function applyThemeColor(theme: Prefs["theme"], doc: Document = document): void {
  const c = themeColorContents(theme);
  const light = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="light"]');
  const dark = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="dark"]');
  if (light) light.content = c.light;
  if (dark) dark.content = c.dark;
}
