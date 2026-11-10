import { checkThemeColors, PACKAGE_ID_RE, THEME_TOKENS } from "@keyring-notes/core";
import { useSyncExternalStore } from "react";
// prefs.ts 를 값으로 import 하지 않는다 — prefs 가 모듈 최상위에서 publish() → applyThemeChoice 를 부르므로 순환한다
import type { ThemeChoice } from "../prefs";
import { applyThemeColor } from "../themeColor";
import { type ResolvedTheme, resolveTheme, type ThemePackage } from "./resolve";

/**
 * 테마를 DOM 에 쓰는 유일한 자리. 쓰는 것은 html[data-theme](그리는 모드)과 documentElement.style 의 THEME_TOKENS 뿐이다 —
 * CSS 글(<style>)을 만들지 않으므로 값이 규칙 밖으로 새는 길이 없고, 값은 resolveTheme 이 isThemeColor 로 거른 것만 온다.
 * 설계 docs/superpowers/specs/2026-11-10-marketplace-design.md 「테마 토큰」.
 */

const CACHE_KEY = "keyring:theme-cache";

/** 주소 `?theme=default`: 이번 열기에만 받은 테마를 그리지 않는다(화면을 읽을 수 없어 설정에 갈 수 없을 때). 값이 "default" 인지만 본다 */
export const themeEscape: boolean = typeof location !== "undefined" && new URLSearchParams(location.search).get("theme") === "default";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 시작 캐시 읽기(순수). 꼴과 값을 다시 검사해 나쁜 토큰은 그것만 버리고, id·판이 나쁘면 null */
export function readThemeCache(raw: string | null): ThemePackage | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || typeof v.id !== "string" || !PACKAGE_ID_RE.test(v.id) || typeof v.version !== "string" || v.version.length > 64) return null;
  const name: Record<string, string> = {};
  if (isRecord(v.name)) for (const [k, t] of Object.entries(v.name)) if (typeof t === "string") name[k] = t;
  const colors: ThemePackage["colors"] = {};
  if (isRecord(v.colors))
    for (const mode of ["light", "dark"] as const) {
      const c = v.colors[mode];
      if (!isRecord(c)) continue;
      const ok: Record<string, string> = {};
      for (const [k, x] of Object.entries(c))
        if (typeof x === "string" && !checkThemeColors({ [mode]: { [k]: x } }, THEME_TOKENS).errors.length && THEME_TOKENS.includes(k)) ok[k] = x;
      colors[mode] = ok;
    }
  return { id: v.id, version: v.version, name, colors };
}

/** 시작 캐시에 할 일: 받은 테마를 그리면 그것을 쓰고, 기본이면 지운다. escape 로 연 동안은 건드리지 않는다(지우면 다음 오프라인 열기에서 빠진다) */
export function cacheAction(r: ResolvedTheme, escape: boolean): "write" | "clear" | "keep" {
  if (escape) return "keep";
  return r.packageId ? "write" : "clear";
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const systemQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

let choice: ThemeChoice = "system";
let packages: ThemePackage[] = (() => {
  try {
    const c = readThemeCache(storage()?.getItem(CACHE_KEY) ?? null);
    return c ? [c] : [];
  } catch {
    return [];
  }
})();
let applied: ResolvedTheme = resolveTheme(choice, packages, { systemDark: !!systemQuery?.matches, escape: themeEscape });
const listeners = new Set<(r: ResolvedTheme) => void>();

function writeDom(r: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (r.dataTheme === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", r.dataTheme);
  for (const t of THEME_TOKENS) root.style.removeProperty(t);
  for (const [t, v] of Object.entries(r.tokens)) root.style.setProperty(t, v);
  applyThemeColor(r.metaBg);
}

function writeCache(r: ResolvedTheme) {
  const s = storage();
  if (!s) return;
  const action = cacheAction(r, themeEscape);
  try {
    if (action === "clear") s.removeItem(CACHE_KEY);
    else if (action === "write") {
      const p = packages.find((x) => x.id === r.packageId);
      if (p) s.setItem(CACHE_KEY, JSON.stringify(p));
    }
  } catch {
    /* 저장소를 못 쓰면 시작 때 한 번 깜빡일 뿐이다 */
  }
}

function render() {
  applied = resolveTheme(choice, packages, { systemDark: !!systemQuery?.matches, escape: themeEscape });
  writeDom(applied);
  writeCache(applied);
  for (const l of listeners) l(applied);
}

/** 고르기 값(prefs 의 theme)이 바뀔 때·처음에 prefs 가 부른다 */
export function applyThemeChoice(c: ThemeChoice): void {
  choice = c;
  render();
}

/** 이 기기에서 쓸 수 있는 받은 테마(마켓 적용자가 부른다). 목록을 통째로 바꾼다 — 캐시의 옛 판을 남기지 않는다 */
export function setThemePackages(pkgs: ThemePackage[]): void {
  packages = pkgs;
  render();
}

export function themePackages(): ThemePackage[] {
  return packages;
}

export function appliedTheme(): ResolvedTheme {
  return applied;
}

export function onThemeApplied(fn: (r: ResolvedTheme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 시스템 설정이 바뀌면 다시 푼다(둘 다 가진 받은 테마는 모드가 바뀐다, 기본은 CSS 가 따르지만 mode·알림을 맞춘다)
systemQuery?.addEventListener?.("change", render);

const subscribe = (fn: () => void) => onThemeApplied(fn);

export function useAppliedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, appliedTheme);
}

export function useThemePackages(): ThemePackage[] {
  return useSyncExternalStore(subscribe, themePackages);
}
