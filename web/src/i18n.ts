import { useEffect, useState } from "react";
import {
  BASE_LANG,
  isOfficialLang,
  lookup,
  OFFICIAL_LANGS,
  OFFICIAL_MESSAGES,
  OFFICIAL_NAMES,
  officialLangOf,
  pseudoMessages,
  type LanguagePack,
  type Messages,
  type OfficialLang,
  type Params,
} from "@keyring-notes/core";

/**
 * 화면 언어. 메시지 묶음은 core(messages/en.json·ko.json)에 있고, 비공식 언어팩은 이 기기(localStorage)에 둔다.
 * 고르는 값은 "따라가는 화면 설정"(prefs.ts의 language)이다. 기본값은 브라우저·OS 언어.
 * 언어팩이 없는 언어를 고른 기기에서는 그 언어팩의 기준 언어로 보이고 알린다(missingPack).
 * 바꾸면 새로고침 없이 반영된다(useLang으로 다시 그린다).
 */
const PACKS_KEY = "keyring:langpacks";
/** 개발용 의사 언어: 모든 문장을 [!! … !!]로 감싸 빠뜨린 하드코딩 글을 찾는다(?lang=pseudo 또는 설정) */
export const PSEUDO = "pseudo";

function loadPacks(): Record<string, LanguagePack> {
  try {
    const raw = JSON.parse(localStorage.getItem(PACKS_KEY) ?? "{}") as Record<string, LanguagePack>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

let packs = loadPacks();
let current = "en";
/** 고른 언어(언어팩이 없으면 current와 다르다) */
let wanted = "en";
let chain: { messages: Messages; locale: string }[] = [{ messages: OFFICIAL_MESSAGES.en, locale: "en" }];
const listeners = new Set<(lang: string) => void>();

/** 브라우저·OS 언어 → 지원하는 언어(공식·이 기기 언어팩), 없으면 영어 */
export function systemLanguage(): string {
  const tags = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language].filter(Boolean) : [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    const pack = Object.keys(packs).find((id) => id.toLowerCase() === lower || lower.startsWith(id.toLowerCase() + "-"));
    if (pack) return pack;
    if (lower.startsWith("ko")) return "ko";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}

function build(lang: string) {
  if (lang === PSEUDO) return [{ messages: pseudoMessages(), locale: "en" }];
  const pack = packs[lang];
  if (pack) {
    const base = pack.meta.base;
    return [{ messages: pack.messages, locale: lang }, ...(base === BASE_LANG ? [] : [{ messages: OFFICIAL_MESSAGES[base], locale: base }]), { messages: OFFICIAL_MESSAGES.en, locale: "en" }];
  }
  const l = officialLangOf(lang);
  return l === BASE_LANG ? [{ messages: OFFICIAL_MESSAGES.en, locale: "en" }] : [{ messages: OFFICIAL_MESSAGES[l], locale: l }, { messages: OFFICIAL_MESSAGES.en, locale: "en" }];
}

/** 화면 언어를 바꾼다(prefs가 부른다). 언어팩이 없는 언어면 기준 언어(모르면 영어)로 보인다 */
export function setLanguage(lang: string) {
  wanted = lang;
  const next = lang === PSEUDO || isOfficialLang(lang) || packs[lang] ? lang : officialLangOf(lang);
  if (typeof document !== "undefined") document.documentElement.lang = next === PSEUDO ? "en" : next;
  if (next === current && chain.length) {
    for (const l of listeners) l(current);
    return;
  }
  current = next;
  chain = build(current);
  for (const l of listeners) l(current);
}

/** 지금 화면 언어 */
export function language(): string {
  return current;
}

/** Intl에 넘길 언어 태그 */
export function locale(): string {
  return current === PSEUDO ? "en" : current;
}

/** 고른 언어의 언어팩이 이 기기에 없어 기준 언어로 보이는 중이면 그 언어 id */
export function missingPack(): string | null {
  return wanted !== current && wanted !== PSEUDO && !isOfficialLang(wanted) ? wanted : null;
}

/** 메시지. params.count가 숫자면 복수형 */
export function t(key: string, params?: Params): string {
  return lookup(chain, key, params);
}

/** 언어가 바뀌면 다시 그린다. 지금 언어를 돌려준다 */
export function useLang(): string {
  const [l, setL] = useState(current);
  useEffect(() => {
    listeners.add(setL);
    setL(current);
    return () => {
      listeners.delete(setL);
    };
  }, []);
  return l;
}

export function onLanguageChange(fn: (lang: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 고를 수 있는 언어: 공식 + 이 기기 언어팩 */
export function languages(): { id: string; name: string; official: boolean; base?: OfficialLang }[] {
  return [
    ...OFFICIAL_LANGS.map((id) => ({ id, name: OFFICIAL_NAMES[id], official: true })),
    ...Object.values(packs)
      .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
      .map((p) => ({ id: p.meta.id, name: p.meta.name, official: false, base: p.meta.base })),
  ];
}

export function getPack(id: string): LanguagePack | null {
  return packs[id] ?? null;
}

function savePacks() {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
  } catch (e) {
    throw new Error(t("lang.pack.storageFull"), { cause: e });
  }
}

/** 언어팩 더하기·바꾸기(이 기기) */
export function putPack(pack: LanguagePack) {
  const prev = packs;
  packs = { ...packs, [pack.meta.id]: pack };
  try {
    savePacks();
  } catch (e) {
    packs = prev;
    throw e;
  }
  setLanguage(wanted);
}

export function removePack(id: string) {
  const next = { ...packs };
  delete next[id];
  packs = next;
  savePacks();
  setLanguage(wanted);
}

// ── 날짜·숫자(Intl, 화면 언어) ──

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat(locale()).format(n);
}

export function fmtDateTime(d: Date | string | number): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}

export function fmtDate(d: Date | string | number, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(locale(), opts).format(new Date(d));
}

export function fmtTime(d: Date | string | number): string {
  return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

/** 방금·N초 전·N분 전, 한 시간이 넘으면 시각 */
export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.round((now - at) / 1000);
  if (s < 5) return t("time.justNow");
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "always", style: "short" });
  if (s < 60) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  return fmtTime(at);
}

/** 바이트 크기 */
export function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}

/** 주소의 ?lang=…(개발·시험용): 있으면 설정보다 먼저 */
export const urlLanguage: string | null = (() => {
  try {
    return new URLSearchParams(location.search).get("lang");
  } catch {
    return null;
  }
})();

// 시작 언어: ?lang=… 이 있으면 그것, 아니면 브라우저 언어(공통 설정이 읽히면 prefs가 바꾼다)
setLanguage(urlLanguage ?? systemLanguage());
