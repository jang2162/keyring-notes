import en from "./messages/en.json" with { type: "json" };
import ko from "./messages/ko.json" with { type: "json" };

/**
 * 키 기반 메시지 묶음. 공식 언어는 영어(기준)·한국어이고, 둘이 같은 키를 갖는다(빠진 키는 영어로 대신 보인다).
 * - 끼워 넣기: `{name}`. 값에 HTML을 넣지 않는다(화면은 늘 글자로 그린다).
 * - 복수형: `키#one`·`키#other`처럼 Intl.PluralRules 범주를 붙인 키. 한국어는 `#other`만 둔다.
 * 웹 화면·서버 오류·에이전트 글·CLI가 같은 묶음을 쓴다. 비공식 언어팩(이 기기에 저장)은 이 묶음 위에 얹는다.
 */
export type Messages = Record<string, string>;
export type OfficialLang = "en" | "ko";

export const BASE_LANG: OfficialLang = "en";
export const OFFICIAL_LANGS: OfficialLang[] = ["en", "ko"];
export const OFFICIAL_MESSAGES: Record<OfficialLang, Messages> = { en, ko };
export const OFFICIAL_NAMES: Record<OfficialLang, string> = { en: "English", ko: "한국어" };

/** 앱 버전(언어팩 meta.appVersion) */
export const APP_VERSION = "0.8.6";

export function isOfficialLang(v: unknown): v is OfficialLang {
  return v === "en" || v === "ko";
}

/** 언어 태그 → 공식 언어(모르면 영어) */
export function officialLangOf(tag: string | null | undefined): OfficialLang {
  return typeof tag === "string" && tag.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** 복수형 범주를 뗀 키 */
export const baseKey = (key: string) => key.replace(/#[a-z]+$/, "");

/** 메시지 안의 끼워 넣기 자리 이름(정렬, 중복 없음) */
export function placeholders(msg: string): string[] {
  return [...new Set([...msg.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].sort();
}

export type Params = Record<string, string | number | null | undefined>;

/** 끼워 넣기. 숫자는 그 언어의 숫자 모양으로(count 포함) */
export function interpolate(msg: string, params: Params | undefined, locale = "en"): string {
  if (!params) return msg;
  return msg.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) return all;
    return typeof v === "number" ? new Intl.NumberFormat(locale).format(v) : String(v);
  });
}

const pluralCache = new Map<string, Intl.PluralRules>();
function pluralOf(locale: string, n: number): string {
  let r = pluralCache.get(locale);
  if (!r) {
    try {
      r = new Intl.PluralRules(locale);
    } catch {
      r = new Intl.PluralRules("en");
    }
    pluralCache.set(locale, r);
  }
  return r.select(n);
}

/**
 * 메시지 찾기: 묶음 목록을 앞에서부터(언어팩 → 그 기준 언어 → 영어) 본다. params.count가 숫자면 복수형 키를 먼저.
 * 어디에도 없으면 키를 그대로 돌려준다(빠뜨린 키가 화면에 보이게).
 */
export function lookup(chain: { messages: Messages; locale: string }[], key: string, params?: Params): string {
  const count = typeof params?.count === "number" ? params.count : null;
  for (const { messages, locale } of chain) {
    if (count !== null) {
      const form = messages[`${key}#${pluralOf(locale, count)}`] ?? messages[`${key}#other`];
      if (form !== undefined) return interpolate(form, params, locale);
    }
    const m = messages[key];
    if (m !== undefined) return interpolate(m, params, locale);
  }
  return key;
}

/** 공식 언어로 바로(서버 오류·에이전트 글·CLI) */
export function translate(lang: string | null | undefined, key: string, params?: Params): string {
  const l = officialLangOf(lang);
  const chain =
    l === BASE_LANG
      ? [{ messages: OFFICIAL_MESSAGES.en, locale: "en" }]
      : [
          { messages: OFFICIAL_MESSAGES[l], locale: l },
          { messages: OFFICIAL_MESSAGES.en, locale: "en" },
        ];
  return lookup(chain, key, params);
}

// ── 비공식 언어팩 ──

export interface LanguagePackMeta {
  /** 언어 태그(BCP 47 비슷하게, 예: ja, pt-BR) */
  id: string;
  /** 언어 목록에 보일 이름 */
  name: string;
  /** 빠진 키를 대신 보일 공식 언어 */
  base: OfficialLang;
  appVersion: string;
  author: string;
}

export interface LanguagePack {
  meta: LanguagePackMeta;
  messages: Messages;
}

export const PACK_MAX_BYTES = 1024 * 1024;

export interface PackReport {
  /** 기준 언어에 없는 키(무시) */
  unknown: string[];
  /** 번역이 없는 키(기준 언어로 대신 보인다) */
  missing: string[];
  /** 끼워 넣기 자리가 기준과 다른 키(그 메시지만 기준 언어로) */
  placeholderMismatch: string[];
  /** 글자가 아닌 값(버림) */
  notString: string[];
  /** HTML 태그처럼 보이는 값(글자로만 보인다는 알림) */
  htmlLike: string[];
}

export type PackError = "too_large" | "not_json" | "bad_shape" | "bad_id" | "bad_name" | "official_id";

/** 기준 언어 메시지 묶음(복수형 키 포함)과 언어팩을 맞춰 본다: 쓸 메시지만 남긴 팩과 보고서 */
export function checkPack(raw: unknown, sizeBytes: number): { pack: LanguagePack; report: PackReport } | { error: PackError } {
  if (sizeBytes > PACK_MAX_BYTES) return { error: "too_large" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "bad_shape" };
  const r = raw as { meta?: Record<string, unknown>; messages?: unknown };
  if (!r.meta || typeof r.meta !== "object" || !r.messages || typeof r.messages !== "object" || Array.isArray(r.messages)) return { error: "bad_shape" };
  const id = typeof r.meta.id === "string" ? r.meta.id.trim() : "";
  if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(id)) return { error: "bad_id" };
  if (isOfficialLang(id) || id === "pseudo") return { error: "official_id" };
  const name = typeof r.meta.name === "string" ? r.meta.name.trim().slice(0, 60) : "";
  if (!name) return { error: "bad_name" };
  const base = isOfficialLang(r.meta.base) ? r.meta.base : BASE_LANG;
  const ref = OFFICIAL_MESSAGES[base];
  const refBases = new Set(Object.keys(ref).map(baseKey));
  const report: PackReport = { unknown: [], missing: [], placeholderMismatch: [], notString: [], htmlLike: [] };
  const messages: Messages = {};
  for (const [k, v] of Object.entries(r.messages as Record<string, unknown>)) {
    if (!refBases.has(baseKey(k))) {
      report.unknown.push(k);
      continue;
    }
    if (typeof v !== "string") {
      report.notString.push(k);
      continue;
    }
    // 자리는 같은 키(복수형이면 기준의 어느 한 형태)와 같아야 한다
    const refMsg = ref[k] ?? ref[`${baseKey(k)}#other`] ?? ref[baseKey(k)];
    if (refMsg !== undefined && placeholders(refMsg).join() !== placeholders(v).join()) {
      report.placeholderMismatch.push(k);
      continue;
    }
    if (/<\/?[a-z][^>]*>/i.test(v)) report.htmlLike.push(k);
    messages[k] = v.slice(0, 4000);
  }
  const have = new Set(Object.keys(messages).map(baseKey));
  report.missing = [...refBases].filter((k) => !have.has(k)).sort();
  return {
    pack: {
      meta: {
        id,
        name,
        base,
        appVersion: typeof r.meta.appVersion === "string" ? r.meta.appVersion.slice(0, 20) : "",
        author: typeof r.meta.author === "string" ? r.meta.author.slice(0, 100) : "",
      },
      messages,
    },
    report,
  };
}

/** 글(파일 내용) → 언어팩 검사. JSON이 아니면 not_json */
export function parsePack(text: string): { pack: LanguagePack; report: PackReport } | { error: PackError } {
  const size = new TextEncoder().encode(text).length;
  if (size > PACK_MAX_BYTES) return { error: "too_large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "not_json" };
  }
  return checkPack(raw, size);
}

/** 공식 언어로 언어팩 틀 만들기(내려받기). only를 주면 그 키들만(빠진 키만 내려받기) */
export function packTemplate(base: OfficialLang, meta: Partial<LanguagePackMeta> = {}, only?: Iterable<string>): LanguagePack {
  const src = OFFICIAL_MESSAGES[base];
  const keys = only ? new Set([...only].flatMap((k) => Object.keys(src).filter((x) => baseKey(x) === baseKey(k)))) : null;
  const messages: Messages = {};
  for (const [k, v] of Object.entries(src)) if (!keys || keys.has(k)) messages[k] = v;
  return { meta: { id: meta.id ?? "xx", name: meta.name ?? "New language", base, appVersion: APP_VERSION, author: meta.author ?? "" }, messages };
}

/** 지금 언어팩에 더해 고친 일부(빠진 키만 받아 고친 것)를 합친다 */
export function mergePacks(current: LanguagePack, update: LanguagePack): LanguagePack {
  return { meta: { ...current.meta, ...update.meta, id: current.meta.id }, messages: { ...current.messages, ...update.messages } };
}

/** 의사 언어(개발용): 모든 메시지를 [!! … !!]로 감싸 빠뜨린 하드코딩 글을 찾는다 */
export function pseudoMessages(): Messages {
  const out: Messages = {};
  for (const [k, v] of Object.entries(OFFICIAL_MESSAGES.en)) out[k] = `[!! ${v} !!]`;
  return out;
}
