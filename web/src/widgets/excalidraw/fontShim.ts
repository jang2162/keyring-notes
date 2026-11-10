/**
 * iframe CSP(font-src data:)는 글꼴 주소를 막으므로, Excalidraw 가 `new FontFace(name, "url(…/fonts/<rel>.woff2) …")` 로 만드는 글꼴을
 * 부모가 건넨 바이트로 바꿔 만든다. frame.tsx 의 첫 import 여야 한다(Excalidraw 가 모듈을 불러올 때 FontFace 를 잡는다).
 */
const FONT_RE = /fonts\/([^)"'\s]+?\.woff2)/g;

export function installFontShim(lookup: (rel: string) => ArrayBuffer | undefined): void {
  const Orig = window.FontFace;
  function Shimmed(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors): FontFace {
    if (typeof source === "string") {
      const rels = [...source.matchAll(FONT_RE)].map((m) => m[1]!);
      for (const rel of rels) {
        const bytes = lookup(rel);
        if (bytes) return new Orig(family, bytes, descriptors);
      }
      // 싣지 않은 글꼴(Excalifont·Liberation·Xiaolai — vite.config.ts 의 fontsSkip): 주소(CDN)로 받으러 가지 않게 없는 local() 로 만들고,
      // unicode-range 를 쓰지 않는 한 글자(U+10FFFF)로 좁혀 어떤 글에도 맞지 않게 한다 — 맞으면 브라우저가 불러오다 실패하고
      // Excalidraw 가 그 실패를 글꼴 CDN 주소와 함께 콘솔 오류로 적는다. 그 글꼴로 쓴 글은 시스템 글꼴로 보인다
      if (rels.length) return new Orig(family, "local('keyring-font-not-bundled')", { ...descriptors, unicodeRange: "U+10FFFF" });
    }
    return new Orig(family, source, descriptors);
  }
  Shimmed.prototype = Orig.prototype;
  window.FontFace = Shimmed as unknown as typeof FontFace;
}
