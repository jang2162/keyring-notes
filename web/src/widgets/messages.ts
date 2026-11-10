import { messageChain } from "../i18n";
import type { WidgetEntry } from "./registry";
import type { MessageChain } from "./widgetT";

/**
 * 위젯이 받을 글 사슬(부모 쪽). 앱 메시지 앞머리면 화면 언어 사슬의 각 단계에서 `${앞머리}.` 키만 앞머리를 떼어 담고,
 * 제3자 표면 [표[lang], 표[lang 의 앞 낱말], 표.en] 중 있는 것. iframe 에는 이 사슬만 건너간다 — 다른 앱 글은 넘기지 않는다.
 */
export function widgetMessages(entry: WidgetEntry, lang: string): MessageChain {
  const m = entry.messages;
  if (typeof m === "string") {
    const prefix = `${m}.`;
    return messageChain().map(({ messages, locale }) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(messages)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      return { messages: out, locale };
    });
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
