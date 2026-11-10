import { describe, expect, it } from "vitest";
import { installFontShim } from "./fontShim";

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: unknown,
    readonly descriptors?: FontFaceDescriptors,
  ) {}
}

function install(fonts: Record<string, ArrayBuffer>) {
  (globalThis as { window?: unknown }).window = { FontFace: FakeFontFace };
  installFontShim((rel) => fonts[rel]);
  return (globalThis as unknown as { window: { FontFace: new (f: string, s: unknown, d?: FontFaceDescriptors) => FakeFontFace } }).window.FontFace;
}

describe("installFontShim — 글꼴 주소를 부모가 건넨 바이트로", () => {
  it("실린 글꼴은 바이트로 만든다", () => {
    const bytes = new ArrayBuffer(4);
    const F = install({ "Virgil/Virgil-Regular.woff2": bytes });
    const f = new F("Virgil", 'url(https://esm.sh/x/fonts/Virgil/Virgil-Regular.woff2) format("woff2")', { unicodeRange: "U+0-FF" });
    expect(f.source).toBe(bytes);
    expect(f.descriptors?.unicodeRange).toBe("U+0-FF");
  });
  it("싣지 않은 글꼴은 어떤 글자에도 맞지 않게 만든다 — 받으러 가지도, 불러오다 실패해 콘솔 오류를 내지도 않고 시스템 글꼴로 보인다", () => {
    const F = install({});
    const f = new F("Excalifont", 'url(https://esm.sh/x/fonts/Excalifont/Excalifont-Regular-a88b.woff2) format("woff2")', { unicodeRange: "U+0-FF" });
    expect(typeof f.source).toBe("string");
    expect(String(f.source)).not.toMatch(/https?:/);
    expect(f.descriptors?.unicodeRange).toBe("U+10FFFF");
  });
});
