import { useEffect, useState } from "react";
import {
  BASE_LANG,
  checkPack,
  isOfficialLang,
  PACKAGE_ID_RE,
  lookup,
  OFFICIAL_LANGS,
  OFFICIAL_MESSAGES,
  OFFICIAL_NAMES,
  officialLangOf,
  pseudoMessages,
  type LanguagePack,
  type Messages,
  type OfficialLang,
  type PackReport,
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

/**
 * 마켓 언어 층(잠금을 따라 모든 기기에 깔리는 언어 패키지). 풀이 순서: 이 기기 언어팩 → 마켓 층 → 공식.
 * 같은 meta.id 가 이 기기 언어팩에도 있으면 이 기기 것을 쓴다(사람이 일부러 넣은 것 — 번역하는 사람이 마켓 판 위에서 자기 고침을 본다).
 */
export interface MarketPack {
  pkgId: string;
  pack: LanguagePack;
  report: PackReport;
}
const MARKET_CACHE_KEY = "keyring:langpack-market-cache";
/** meta.id 마다 쓰는 것(잠금 순서의 앞 것) */
let marketPacks: MarketPack[] = [];
/** 받은 것 전부(충돌로 쓰지 않는 것 포함) — 마켓 화면의 보고서 */
let marketAll: MarketPack[] = [];

/** 시작 캐시(풀린 화면 언어가 마켓 층일 때 그 하나). 읽을 때 checkPack 을 다시 지난다 — 손으로 고친 캐시를 믿지 않는다 */
function loadMarketCache(): MarketPack | null {
  try {
    const raw = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) ?? "null") as { pkgId?: unknown; pack?: unknown } | null;
    if (!raw || typeof raw.pkgId !== "string" || !PACKAGE_ID_RE.test(raw.pkgId)) return null;
    const r = checkPack(raw.pack, JSON.stringify(raw.pack ?? null).length);
    return "error" in r ? null : { pkgId: raw.pkgId, pack: r.pack, report: r.report };
  } catch {
    return null;
  }
}
{
  const c = loadMarketCache();
  if (c) marketPacks = marketAll = [c];
}

function marketPackFor(lang: string): MarketPack | undefined {
  return packs[lang] ? undefined : marketPacks.find((m) => m.pack.meta.id === lang);
}

/** 이 기기 언어팩 또는 마켓 층에서 그 언어의 팩 */
function packFor(lang: string): LanguagePack | undefined {
  return packs[lang] ?? marketPackFor(lang)?.pack;
}

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
    const ids = [...Object.keys(packs), ...marketPacks.map((m) => m.pack.meta.id)];
    const pack = ids.find((id) => id.toLowerCase() === lower || lower.startsWith(id.toLowerCase() + "-"));
    if (pack) return pack;
    if (lower.startsWith("ko")) return "ko";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}

function build(lang: string) {
  if (lang === PSEUDO) return [{ messages: pseudoMessages(), locale: "en" }];
  const pack = packFor(lang);
  if (pack) {
    const base = pack.meta.base;
    return [
      { messages: pack.messages, locale: lang },
      ...(base === BASE_LANG ? [] : [{ messages: OFFICIAL_MESSAGES[base], locale: base }]),
      { messages: OFFICIAL_MESSAGES.en, locale: "en" },
    ];
  }
  const l = officialLangOf(lang);
  return l === BASE_LANG
    ? [{ messages: OFFICIAL_MESSAGES.en, locale: "en" }]
    : [
        { messages: OFFICIAL_MESSAGES[l], locale: l },
        { messages: OFFICIAL_MESSAGES.en, locale: "en" },
      ];
}

/** 화면 언어를 바꾼다(prefs가 부른다). 언어팩이 없는 언어면 기준 언어(모르면 영어)로 보인다 */
export function setLanguage(lang: string) {
  wanted = lang;
  const next = lang === PSEUDO || isOfficialLang(lang) || packFor(lang) ? lang : officialLangOf(lang);
  if (typeof document !== "undefined") document.documentElement.lang = next === PSEUDO ? "en" : next;
  // 같은 언어라도 팩이 바뀌었을 수 있다(마켓 판 업데이트·이 기기 언어팩 고침) — 사슬은 늘 다시 만든다
  current = next;
  chain = build(current);
  writeMarketCache();
  for (const l of listeners) l(current);
}

function writeMarketCache() {
  // 마켓 상태가 첫 맞추기를 마치기 전에도 이 값은 맞다: 캐시에서 읽은 층으로 풀었으니 같은 것을 다시 쓴다
  const m = marketPackFor(current);
  try {
    if (m) localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ pkgId: m.pkgId, pack: m.pack }));
    else localStorage.removeItem(MARKET_CACHE_KEY);
  } catch {
    /* 저장소 한도·없는 환경 — 캐시 없이(시작 때 한 번 기준 언어로 보일 뿐) */
  }
}

/** 고르기 원값(prefs 의 language, ""= 시스템 언어). 언어 층이 바뀔 때마다 같은 풀이를 다시 한다 */
let pref = "";

function resolvePref() {
  setLanguage(urlLanguage ?? (pref || systemLanguage()));
}

/** prefs 가 부른다 — 푼 값이 아니라 원값을 넘긴다(시스템 언어 기기가 마켓 언어를 받는 순간 그 언어로 바뀌게) */
export function setLanguagePref(p: string) {
  pref = p;
  resolvePref();
}

/** 마켓 언어 패키지들(잠금 순서). 같은 meta.id 는 앞 것만 쓴다. 공식 id 는 받지 않는다(checkPack 이 이미 거른다) */
export function setMarketPacks(list: MarketPack[]) {
  marketAll = list.filter((m) => !isOfficialLang(m.pack.meta.id) && m.pack.meta.id !== PSEUDO);
  const seen = new Set<string>();
  marketPacks = marketAll.filter((m) => (seen.has(m.pack.meta.id) ? false : (seen.add(m.pack.meta.id), true)));
  resolvePref();
}

/** 같은 언어를 마켓 패키지 둘 이상이 줄 때: 쓰는 것과 쓰지 않는 것 */
export function marketLanguageConflicts(): { lang: string; used: string; ignored: string[] }[] {
  const out: { lang: string; used: string; ignored: string[] }[] = [];
  for (const used of marketPacks) {
    const ignored = marketAll.filter((m) => m.pack.meta.id === used.pack.meta.id && m.pkgId !== used.pkgId).map((m) => m.pkgId);
    if (ignored.length) out.push({ lang: used.pack.meta.id, used: used.pkgId, ignored });
  }
  return out;
}

export function marketPackReport(pkgId: string): PackReport | null {
  return marketAll.find((m) => m.pkgId === pkgId)?.report ?? null;
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

/** 지금 화면 언어 사슬(lookup 이 쓰는 것) — 위젯 글(widgets/messages.ts)이 앞머리 키만 떼어 쓴다 */
export function messageChain(): { messages: Messages; locale: string }[] {
  return chain.slice();
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

export interface LanguageEntry {
  id: string;
  name: string;
  official: boolean;
  base?: OfficialLang;
  source: "official" | "device" | "market";
  /** 마켓 언어면 그 패키지 id */
  pkgId?: string;
  /** 이 기기 언어팩이 같은 언어의 마켓 패키지를 가리면 그 패키지 id */
  shadows?: string;
}

/** 고를 수 있는 언어: 공식 + 이 기기 언어팩 + 마켓 언어(같은 id 는 하나만) */
export function languages(): LanguageEntry[] {
  const device: LanguageEntry[] = Object.values(packs).map((p) => {
    const shadow = marketPacks.find((m) => m.pack.meta.id === p.meta.id)?.pkgId;
    return { id: p.meta.id, name: p.meta.name, official: false, base: p.meta.base, source: "device", ...(shadow && { shadows: shadow }) };
  });
  const fromMarket: LanguageEntry[] = marketPacks
    .filter((m) => !packs[m.pack.meta.id])
    .map((m) => ({ id: m.pack.meta.id, name: m.pack.meta.name, official: false, base: m.pack.meta.base, source: "market", pkgId: m.pkgId }));
  return [
    ...OFFICIAL_LANGS.map((id): LanguageEntry => ({ id, name: OFFICIAL_NAMES[id], official: true, source: "official" })),
    ...[...device, ...fromMarket].sort((a, b) => a.name.localeCompare(b.name)),
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
  resolvePref();
}

export function removePack(id: string) {
  const next = { ...packs };
  delete next[id];
  packs = next;
  savePacks();
  resolvePref();
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
resolvePref();
