import { describe, expect, it } from "vitest";
import { FRAME_RUNTIME_GZIP_LIMIT, FRAME_WIDGET_GZIP_LIMIT, frameAssetName, frameSizeErrors, inlineCssFonts } from "./widgetFrames";

describe("iframe 묶음 도우미", () => {
  it("이름에 내용 해시 앞 8자", () => {
    expect(frameAssetName("runtime", "abc", ".js")).toBe("widget-frame/runtime-ba7816bf.js");
    expect(frameAssetName("x", new TextEncoder().encode("abc"), ".woff2")).toBe("widget-frame/x-ba7816bf.woff2");
  });

  it("CSS 안 woff2 를 data: 로, 못 읽으면 그대로", () => {
    const css = '@font-face{src:url(./fonts/Assistant/A-1.woff2) format("woff2")}';
    const out = inlineCssFonts(css, (rel) => (rel === "Assistant/A-1.woff2" ? new Uint8Array([1, 2, 3]) : null));
    expect(out).toBe('@font-face{src:url(data:font/woff2;base64,AQID) format("woff2")}');
    expect(inlineCssFonts(css, () => null)).toBe(css);
    const quoted = '@font-face{src:url("../fonts/B.woff2")}';
    expect(inlineCssFonts(quoted, (rel) => (rel === "B.woff2" ? new Uint8Array([255]) : null))).toBe("@font-face{src:url(data:font/woff2;base64,/w==)}");
  });

  it("크기 상한: runtime 은 런타임 한도, 나머지는 위젯 한도", () => {
    expect(FRAME_RUNTIME_GZIP_LIMIT).toBe(20480);
    expect(FRAME_WIDGET_GZIP_LIMIT).toBe(2_097_152);
    const errs = frameSizeErrors([
      { name: "runtime", gzip: 20481 },
      { name: "excalidraw", gzip: 2_097_152 },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("runtime");
    expect(frameSizeErrors([{ name: "excalidraw", gzip: 2_097_153 }])).toHaveLength(1);
    expect(frameSizeErrors([{ name: "runtime", gzip: 20480 }])).toEqual([]);
  });
});
