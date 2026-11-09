import { describe, expect, it } from "vitest";
import { fenceClosed, isKeyringFence, keyringSlotHtml } from "./slot";

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
    expect(fenceClosed("````keyring-widget\n{}\n```\n", [0, 4], "````")).toBe(false);
    expect(fenceClosed("~~~keyring-widget\n{}\n```\n", [0, 4], "~~~")).toBe(false);
    expect(fenceClosed("~~~keyring-widget\n{}\n~~~", [0, 3], "~~~")).toBe(true);
    expect(fenceClosed("```keyring-widget\n```", [0, 2], "```")).toBe(true);
    expect(fenceClosed("```keyring-widget", [0, 1], "```")).toBe(false);
  });
});
