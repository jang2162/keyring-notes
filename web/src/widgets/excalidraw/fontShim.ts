/**
 * iframe CSP(font-src data:)는 글꼴 주소를 막으므로, Excalidraw 가 `new FontFace(name, "url(…/fonts/<rel>.woff2) …")` 로 만드는 글꼴을
 * 부모가 건넨 바이트로 바꿔 만든다. frame.tsx 의 첫 import 여야 한다(Excalidraw 가 모듈을 불러올 때 FontFace 를 잡는다).
 */
const FONT_RE = /fonts\/([^)"'\s]+?\.woff2)/g;

export function installFontShim(lookup: (rel: string) => ArrayBuffer | undefined): void {
  const Orig = window.FontFace;
  function Shimmed(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors): FontFace {
    if (typeof source === "string") {
      for (const m of source.matchAll(FONT_RE)) {
        const bytes = lookup(m[1]!);
        if (bytes) return new Orig(family, bytes, descriptors);
      }
    }
    return new Orig(family, source, descriptors);
  }
  Shimmed.prototype = Orig.prototype;
  window.FontFace = Shimmed as unknown as typeof FontFace;
}
