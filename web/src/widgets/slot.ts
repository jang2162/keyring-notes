import { KEYRING_WIDGET_LANG } from "@keyring-notes/core";

/**
 * 미리보기(markdown.ts)의 ```keyring-widget 자리. Live Preview 와 같은 범위만 위젯으로 친다 —
 * 문서 최상위(level 0)이고 닫는 펜스가 있는 것(blockEdit.ts 「위젯 블록은 문서 최상위…」).
 */
export function isKeyringFence(info: string, level: number, closed: boolean): boolean {
  return level === 0 && closed && info.trim().split(/\s+/)[0] === KEYRING_WIDGET_LANG;
}

/**
 * markdown-it 의 fence 토큰이 닫혔는가: map 의 마지막 줄이 여는 펜스와 같은 글자이고 그만큼 이상 긴 펜스만 있는 줄인가.
 * lines 는 src.split("\n") — 줄 끝의 \r 은 정규식의 \s* 가 먹는다
 */
export function fenceClosedIn(lines: readonly string[], map: [number, number], markup: string): boolean {
  const last = map[1] - 1;
  if (last <= map[0]) return false;
  const line = lines[last];
  const m = line === undefined ? null : /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1]![0] === markup[0] && m[1]!.length >= markup.length;
}

/**
 * 닫힌 fence 토큰에 meta.kwClosed 를 단다(markdown.ts 의 kw_fence 규칙). 문서는 한 번만 줄로 나눈다 —
 * 펜스마다 나누면 펜스 수 × 문서 크기라 펜스가 많은 큰 문서에서 렌더 한 번에 수백 ms 가 든다.
 */
export function markClosedFences(src: string, tokens: readonly { type: string; map: [number, number] | null; markup: string; meta: unknown }[]): void {
  let lines: string[] | null = null;
  for (const t of tokens) {
    if (t.type !== "fence" || !t.map) continue;
    lines ??= src.split("\n");
    if (fenceClosedIn(lines, t.map, t.markup)) t.meta = { ...(t.meta as object | null), kwClosed: true };
  }
}

export function keyringSlotHtml(index: number, line: number): string {
  return `<div class="kw-slot" data-kw="${index}" data-kw-line="${line}"></div>`;
}
