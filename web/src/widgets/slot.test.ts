import MarkdownIt from "markdown-it";
import { describe, expect, it, vi } from "vitest";
import { fenceClosedIn, isKeyringFence, keyringSlotHtml, markClosedFences } from "./slot";

/** 고치기 전 판정(펜스마다 문서를 나눴다) — 새 판정이 같은 결과를 내는지 대조한다 */
function fenceClosedBefore(src: string, map: [number, number], markup: string): boolean {
  const last = map[1] - 1;
  if (last <= map[0]) return false;
  const line = src.split("\n", last + 1)[last];
  const m = line === undefined ? null : /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1]![0] === markup[0] && m[1]!.length >= markup.length;
}
const fenceClosed = (src: string, map: [number, number], markup: string) => fenceClosedIn(src.split("\n"), map, markup);

describe("미리보기 위젯 자리", () => {
  it("isKeyringFence", () => {
    expect(isKeyringFence("keyring-widget", 0, true)).toBe(true);
    expect(isKeyringFence("keyring-widget x", 0, true)).toBe(true);
    expect(isKeyringFence(" keyring-widget ", 0, true)).toBe(true);
    expect(isKeyringFence("keyring-widget", 1, true)).toBe(false);
    expect(isKeyringFence("keyring-widget", 0, false)).toBe(false);
    expect(isKeyringFence("widget", 0, true)).toBe(false);
    expect(isKeyringFence("keyring-widgets", 0, true)).toBe(false);
  });

  it("keyringSlotHtml", () => {
    expect(keyringSlotHtml(2, 14)).toBe('<div class="kw-slot" data-kw="2" data-kw-line="14"></div>');
  });

  it("fenceClosed — 마지막 줄이 같은 글자·같거나 긴 펜스인가", () => {
    const src = "```keyring-widget\n{}\n```\n\n뒤";
    expect(fenceClosed(src, [0, 3], "```")).toBe(true);
    expect(fenceClosed("```keyring-widget\n{}\n", [0, 3], "```")).toBe(false);
    expect(fenceClosed("```keyring-widget\n{}\n  ````  ", [0, 3], "```")).toBe(true);
    expect(fenceClosed("````keyring-widget\n{}\n```\n", [0, 3], "````")).toBe(false);
    expect(fenceClosed("~~~keyring-widget\n{}\n```\n", [0, 3], "~~~")).toBe(false);
    expect(fenceClosed("~~~keyring-widget\n{}\n~~~", [0, 3], "~~~")).toBe(true);
    expect(fenceClosed("```keyring-widget\n```", [0, 2], "```")).toBe(true);
    expect(fenceClosed("```keyring-widget", [0, 1], "```")).toBe(false);
    // 여는 펜스 줄 자체를 닫는 줄로 보지 않는다
    expect(fenceClosed("```", [0, 1], "```")).toBe(false);
  });

  it("markClosedFences — 고치기 전 판정과 같다(CRLF·물결·목록 안·안 닫힘·더 긴 닫는 펜스)", () => {
    const docs = [
      "```keyring-widget\n{}\n```\n\n뒤",
      "```keyring-widget\r\n{}\r\n```\r\n\r\n뒤\r\n",
      "~~~js\nx\n~~~\n\n````md\n```\nin\n```\n````\n",
      "- 목록\n  ```js\n  x\n  ```\n- 둘\n\n> ```\n> q\n> ```\n",
      "```keyring-widget\n{}\n",
      "```\n```\n```\n",
      "  ```py  \r\n  a\r\n  ````  \r\n",
    ];
    for (const src of docs) {
      const tokens = new MarkdownIt().parse(src, {});
      const before = tokens.map((t) => t.type === "fence" && !!t.map && fenceClosedBefore(src, t.map as [number, number], t.markup));
      markClosedFences(src, tokens);
      expect(
        tokens.map((t) => t.meta?.kwClosed === true),
        src,
      ).toEqual(before);
    }
  });

  it("markClosedFences — 펜스가 많아도 문서를 한 번만 나눈다", () => {
    const src = Array.from({ length: 300 }, (_, i) => "```js\nconst v" + i + " = 1;\n```").join("\n\n");
    const tokens = new MarkdownIt().parse(src, {});
    expect(tokens.filter((t) => t.type === "fence")).toHaveLength(300);
    const split = vi.spyOn(String.prototype, "split");
    try {
      markClosedFences(src, tokens);
      expect(split.mock.calls.filter(([sep]) => (sep as unknown) === "\n").length).toBe(1);
    } finally {
      split.mockRestore();
    }
    expect(tokens.filter((t) => t.meta?.kwClosed === true)).toHaveLength(300);
  });
});
