import { messageChain } from "../i18n";
import type { WidgetEntry } from "./registry";
import type { MessageChain } from "./widgetT";

/**
 * 앞머리로 거른 글 — 사슬 단계의 메시지 표 객체와 앞머리마다 한 번만 거른다. 위젯의 t() 가 부를 때마다 사슬을 다시 받으므로
 * 거르지 않으면 글 한 줄에 앱 카탈로그 전체를 훑는다.
 * 표 객체를 열쇠로 쓰므로 낡지 않는다: 언어를 바꾸거나 언어팩을 받으면(i18n.ts setLanguage·putPack·setMarketPacks) 사슬에 새 표 객체가
 * 들어온다 — 표를 제자리에서 고치는 곳이 생기면 이 캐시가 낡는다. 받는 쪽이 고치지 못하게 얼려 둔다
 */
const filtered = new WeakMap<object, Map<string, Readonly<Record<string, string>>>>();

function withPrefix(messages: Readonly<Record<string, string>>, prefix: string): Readonly<Record<string, string>> {
  let byPrefix = filtered.get(messages);
  if (!byPrefix) filtered.set(messages, (byPrefix = new Map()));
  let out = byPrefix.get(prefix);
  if (!out) {
    const picked: Record<string, string> = {};
    for (const [k, v] of Object.entries(messages)) if (k.startsWith(prefix)) picked[k.slice(prefix.length)] = v;
    byPrefix.set(prefix, (out = Object.freeze(picked)));
  }
  return out;
}

/**
 * 위젯이 받을 글 사슬(부모 쪽). 앱 메시지 앞머리면 화면 언어 사슬의 각 단계에서 `${앞머리}.` 키만 앞머리를 떼어 담고,
 * 제3자 표면 [표[lang], 표[lang 의 앞 낱말], 표.en] 중 있는 것. iframe 에는 이 사슬만 건너간다 — 다른 앱 글은 넘기지 않는다.
 */
export function widgetMessages(entry: WidgetEntry, lang: string): MessageChain {
  const m = entry.messages;
  if (typeof m === "string") {
    const prefix = `${m}.`;
    return messageChain().map(({ messages, locale }) => ({ messages: withPrefix(messages, prefix), locale }));
  }
  const chain: MessageChain = [];
  const seen = new Set<string>();
  for (const l of [lang, lang.split("-")[0]!, "en"]) {
    if (seen.has(l) || !m[l]) continue;
    seen.add(l);
    chain.push({ messages: m[l]!, locale: l });
  }
  return chain;
}
