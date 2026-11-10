/**
 * 테마 색 값의 꼴 검사·읽기와 WCAG 2 대비. 설계 「테마 토큰」.
 * import 는 한 방향이다: marketFormat.ts → color.ts → themeTokens.ts(서로 import 하지 않는다).
 */
import { THEME_DEFAULTS, type ThemeMode } from "./themeTokens.js";

/**
 * 색 값의 엄격한 꼴만 받는다 — 값은 CSS 에 그대로 들어가므로 이 검사가 CSS 주입을 막는 유일한 자리다.
 * 금지 글자는 꼴 검사 전에 거부한다(꼴 정규식이 넓어져도 이 줄이 남게). parseCssColor 도 이것을 먼저 지난다.
 */
const COLOR_FORBIDDEN_RE = /[;{}\\!<>"'\n\r]|url\(|var\(/i;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// 괄호 안은 숫자·부호·%·deg·.·빈칸·,·/ 만(oklab 의 a·b 는 음수일 수 있다)
const FUNC_COLOR_RE = /^(?:rgb|rgba|hsl|hsla|oklch|oklab)\((?=[^)]*[0-9])(?:[0-9.%\s,/+-]|deg)+\)$/;

export function isThemeColor(value: string): boolean {
  if (typeof value !== "string" || value.length > 100 || COLOR_FORBIDDEN_RE.test(value)) return false;
  return HEX_COLOR_RE.test(value) || FUNC_COLOR_RE.test(value);
}

/** r·g·b 0–255 실수, a 0–1 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const CONTRAST_MIN = 4.5;

type Num = { v: number; unit: "" | "%" | "deg" };

function num(token: string): Num | null {
  const m = /^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))(%|deg)?$/.exec(token);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? { v, unit: (m[2] ?? "") as Num["unit"] } : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function alpha(n: Num | undefined): number | null {
  if (!n) return 1;
  if (n.unit === "deg") return null;
  return clamp(n.unit === "%" ? n.v / 100 : n.v, 0, 1);
}

function hue(n: Num): number | null {
  return n.unit === "%" ? null : ((n.v % 360) + 360) % 360;
}

/** 선형 sRGB 0–1 → 감마 sRGB 0–255(범위 밖은 자른다) */
function encode(lin: number): number {
  const c = clamp(lin, 0, 1);
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

/** CSS Color 4 의 OKLab → 선형 sRGB 행렬 */
function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** 함수 꼴의 인자: 쉼표 꼴(3–4개) 또는 빈칸 꼴(3개 + 선택 `/ 알파`) */
function args(inner: string): { main: Num[]; alpha?: Num } | null {
  const text = inner.trim();
  let main: string[];
  let a: string | undefined;
  if (text.includes(",")) {
    if (text.includes("/")) return null;
    const parts = text.split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    main = parts.slice(0, 3);
    a = parts[3];
  } else {
    const slash = text.split("/");
    if (slash.length > 2) return null;
    main = slash[0]!.trim().split(/\s+/);
    if (slash.length === 2) a = slash[1]!.trim();
    if (main.length !== 3) return null;
  }
  const nums = main.map(num);
  if (nums.some((n) => !n)) return null;
  if (a !== undefined) {
    const n = num(a);
    if (!n) return null;
    return { main: nums as Num[], alpha: n };
  }
  return { main: nums as Num[] };
}

/** isThemeColor 가 거짓이면 null. 꼴은 지났는데 읽을 수 없어도 null */
export function parseCssColor(value: string): Rgba | null {
  if (!isThemeColor(value)) return null;
  if (value.startsWith("#")) {
    let h = value.slice(1).toLowerCase();
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const m = /^([a-z]+)\((.*)\)$/.exec(value);
  if (!m) return null;
  const parsed = args(m[2]!);
  if (!parsed) return null;
  const a = alpha(parsed.alpha);
  if (a === null) return null;
  const [x, y, z] = parsed.main as [Num, Num, Num];
  let rgb: [number, number, number];
  switch (m[1]) {
    case "rgb":
    case "rgba": {
      if ([x, y, z].some((n) => n.unit === "deg")) return null;
      const ch = (n: Num) => clamp(n.unit === "%" ? n.v * 2.55 : n.v, 0, 255);
      rgb = [ch(x), ch(y), ch(z)];
      break;
    }
    case "hsl":
    case "hsla": {
      const h = hue(x);
      if (h === null || y.unit === "deg" || z.unit === "deg") return null;
      // CSS Color 4: 채도·밝기의 단위 없는 수는 % 와 같은 값
      rgb = hslToRgb(h, clamp(y.v / 100, 0, 1), clamp(z.v / 100, 0, 1));
      break;
    }
    case "oklab":
    case "oklch": {
      if (x.unit === "deg") return null;
      const L = clamp(x.unit === "%" ? x.v / 100 : x.v, 0, 1);
      // a·b·C 의 100% = 0.4(CSS Color 4)
      const scale = (n: Num) => (n.unit === "%" ? (n.v / 100) * 0.4 : n.v);
      if (m[1] === "oklab") {
        if (y.unit === "deg" || z.unit === "deg") return null;
        rgb = oklabToRgb(L, scale(y), scale(z));
      } else {
        const h = hue(z);
        if (h === null || y.unit === "deg") return null;
        const C = Math.max(0, scale(y));
        rgb = oklabToRgb(L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180));
      }
      break;
    }
    default:
      return null;
  }
  return { r: rgb[0], g: rgb[1], b: rgb[2], a };
}

/** 불투명이면 `#rrggbb`, 아니면 `#rrggbbaa`(소문자) */
export function toHex(c: Rgba): string {
  const h = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0");
  const a = Math.round(clamp(c.a, 0, 1) * 255);
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${a === 255 ? "" : h(a)}`;
}

/** top 을 under 위에 겹친 색. under 가 불투명이면 결과도 불투명 */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2 대비. fg 는 bg 위에 합성하고, bg 가 반투명이면 흰 바탕에 먼저 합성한다 */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const under = bg.a < 1 ? composite(bg, WHITE) : bg;
  const top = fg.a < 1 ? composite(fg, under) : fg;
  const l1 = luminance(top);
  const l2 = luminance(under);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * 본문 글 `--fg` 와 배경 `--bg` 의 대비(그 모드). 테마에 없는 토큰은 그 모드 기본값,
 * 반투명 `--bg` 는 기본 `--bg` 위에 합성한다. 색을 읽지 못하면 null.
 */
export function themeContrast(colors: { light?: Record<string, string>; dark?: Record<string, string> } | undefined, mode: ThemeMode): number | null {
  const own = colors?.[mode] ?? {};
  const base = parseCssColor(THEME_DEFAULTS[mode]["--bg"]!)!;
  const bg = parseCssColor(own["--bg"] ?? THEME_DEFAULTS[mode]["--bg"]!);
  const fg = parseCssColor(own["--fg"] ?? THEME_DEFAULTS[mode]["--fg"]!);
  if (!bg || !fg) return null;
  return contrastRatio(fg, bg.a < 1 ? composite(bg, base) : bg);
}

/** 소수 첫째 자리 내림 — 「4.5」 로 보이는데 경고가 뜨는 일이 없게(4.48 → "4.4") */
export function contrastLabel(ratio: number): string {
  return (Math.floor(ratio * 10 + 1e-9) / 10).toFixed(1);
}
