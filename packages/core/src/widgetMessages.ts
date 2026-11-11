/**
 * 받은 위젯의 글(messages/<언어>.json) 검사. 키는 앞머리 없는 위젯의 것이라 앱 글 묶음과 섞이지 않는다.
 * 앱은 이 글을 HTML 로 해석하지 않는다 — 값은 글자로만 받는다(마켓 3단계 계획 「받은 위젯 글」).
 */

export const WIDGET_MESSAGE_LIMITS = { keys: 1000, value: 2000 } as const;

/** 복수형은 `#zero|one|two|few|many|other` 꼬리 */
export const WIDGET_MESSAGE_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(#(zero|one|two|few|many|other))?$/;

/** 객체가 아니면 null. 꼴이 틀린 키·글자 아닌 값·상한을 넘는 값·1000개를 넘는 뒤쪽 키는 버리고 dropped 에 */
export function checkWidgetMessages(raw: unknown): { messages: Record<string, string>; dropped: string[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const messages: Record<string, string> = {};
  const dropped: string[] = [];
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!WIDGET_MESSAGE_KEY_RE.test(k) || typeof v !== "string" || v.length > WIDGET_MESSAGE_LIMITS.value || count >= WIDGET_MESSAGE_LIMITS.keys) {
      dropped.push(k);
      continue;
    }
    messages[k] = v;
    count++;
  }
  return { messages, dropped };
}
