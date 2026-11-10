import { lookup, type Params } from "@keyring-notes/core/lookup";

/**
 * 위젯의 api.t. iframe 런타임 묶음이 쓰므로 React·web/src/i18n.ts·core 본체를 부르지 않는다(import 는 이 하나 —
 * 끌려오면 런타임 크기 상한을 넘는다, widgetFrames.ts FRAME_RUNTIME_GZIP_LIMIT).
 */
export type MessageChain = { messages: Record<string, string>; locale: string }[];

export function widgetT(chain: MessageChain, key: string, vars?: object): string {
  return lookup(chain, key, vars as Params | undefined);
}
