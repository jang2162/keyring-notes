import { parseCssColor, toHex } from "@keyring-notes/core";

/**
 * 위젯에 건넬 테마 토큰 값. 받은 테마가 documentElement.style 에 쓴 사용자 정의 속성은 계산값이 적은 글 그대로라(`oklch(…)`)
 * 16진·rgb() 만 읽는 위젯(Excalidraw 의 isDark)이 밝음으로 잘못 고른다 — 읽을 수 있는 색은 16진으로 바꿔 건넨다.
 */
export function widgetThemeValue(v: string): string {
  const s = v.trim();
  const c = parseCssColor(s);
  return c ? toHex(c) : s;
}
