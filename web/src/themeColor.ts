import { THEME_DEFAULTS } from "@keyring-notes/core";

/**
 * 설치한 웹 앱(PWA)의 상단 상태 표시줄·하단 영역 색 = 기본 테마의 `--bg`(밝은·어두운).
 * index.html 의 theme-color 메타 두 벌(prefers-color-scheme light·dark)의 처음 값도 이것이다(손으로 맞춘다).
 * THEME_DEFAULTS 와 styles.css 가 같은지는 theme/tokens.test.ts 가 본다. 테마마다의 두 색은 theme/resolve.ts 가 정한다.
 */
export const THEME_BG = { light: THEME_DEFAULTS.light["--bg"]!, dark: THEME_DEFAULTS.dark["--bg"]! } as const;

/** theme-color 메타(media 가 light·dark 인 두 벌)에 각각 쓴다. 메타가 없는 문서(시험·다른 진입점)에서는 아무것도 하지 않는다 */
export function applyThemeColor(metaBg: { light: string; dark: string }, doc: Document = document): void {
  const light = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="light"]');
  const dark = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"][media*="dark"]');
  if (light) light.content = metaBg.light;
  if (dark) dark.content = metaBg.dark;
}
