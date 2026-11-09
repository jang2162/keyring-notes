import { KEYRING_WIDGET_LANG } from "@keyring-notes/core";

/**
 * 미리보기(markdown.ts)의 ```keyring-widget 자리. Live Preview 와 같은 범위만 위젯으로 친다 —
 * 문서 최상위(level 0)이고 닫는 펜스가 있는 것(blockEdit.ts 「위젯 블록은 문서 최상위…」).
 */
export function isKeyringFence(info: string, level: number, closed: boolean): boolean {
  return level === 0 && closed && info.trim().split(/\s+/)[0] === KEYRING_WIDGET_LANG;
}

/** markdown-it 의 fence 토큰이 닫혔는가: map 의 마지막 줄이 여는 펜스와 같은 글자이고 그만큼 이상 긴 펜스만 있는 줄인가 */
export function fenceClosed(src: string, map: [number, number], markup: string): boolean {
  const last = map[1] - 1;
  if (last <= map[0]) return false;
  const line = src.split("\n", last + 1)[last];
  const m = line === undefined ? null : /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1]![0] === markup[0] && m[1]!.length >= markup.length;
}

export function keyringSlotHtml(index: number, line: number): string {
  return `<div class="kw-slot" data-kw="${index}" data-kw-line="${line}"></div>`;
}
