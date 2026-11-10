/**
 * 앱 테마 토큰 --bg 의 밝기로 Excalidraw 테마를 고른다. iframe 묶음에 들어가므로 core 를 import 하지 않는다(묶음 크기).
 * 값은 부모가 widgetThemeValue 로 16진(반투명이면 8자리)으로 바꿔 건넨다 — 알파는 무시하고 색만 본다.
 */
export function isDark(bg: string | undefined): boolean {
  const s = (bg ?? "").trim();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /rgba?\(([^)]+)\)/i.exec(s);
    if (m)
      rgb = m[1]!
        .split(/[ ,/]+/)
        .slice(0, 3)
        .map(Number);
  }
  if (!rgb || rgb.some((n) => !Number.isFinite(n))) return false;
  return (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255 < 0.5;
}
