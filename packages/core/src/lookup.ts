/**
 * 메시지 찾기·끼워 넣기·복수형. 메시지 JSON 을 import 하지 않는다 — keyring-widget iframe 런타임 묶음(widgetT.ts)이
 * `@keyring-notes/core/lookup` 으로 이것만 끌어와 크기 상한(widgetFrames.ts FRAME_RUNTIME_GZIP_LIMIT)을 지킨다.
 * 규칙의 설명은 i18n.ts 머리.
 */

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
export function lookup(chain: { messages: Record<string, string>; locale: string }[], key: string, params?: Params): string {
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
