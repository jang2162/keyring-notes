import { WIDGET_FRAME_SCRIPT_HASH } from "@keyring-notes/core";

/**
 * keyring-widget iframe(srcdoc) 안의 유일한 인라인 스크립트. 부모가 postMessage 로 건넨 코드 글을 blob: 스크립트로 붙여
 * 실행할 뿐이고 나머지 메시지는 런타임이 받는다. iframe 은 URL 로 아무것도 받지 않는다 — 샌드박스(불투명 출처) iframe 은
 * 서비스 워커를 타지 않아 오프라인·기기 볼트에서 열리지 않기 때문이다(계획 「CSP 실험」).
 *
 * 이 글의 해시가 앱 CSP(서버 APP_CSP, tauri.conf.json security.csp)와 아래 meta CSP 의 script-src 에 들어간다.
 * 한 글자라도 바꾸면 bootstrap.test.ts 가 새 해시를 찍으며 떨어진다 — 그 해시를 core widgetFrame.ts 와 tauri.conf.json 에 넣는다.
 * 같은 해시가 앱 페이지에도 허용되므로, HTML 주입으로 최상위에서 돌아도 아무것도 하지 않게 첫 줄에서 돌아간다.
 */
export const FRAME_BOOTSTRAP = `(function () {
  if (window.parent === window) return;
  var parent = window.parent;
  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.kw !== "kw1" || d.type !== "load" || typeof d.code !== "string") return;
    var s = document.createElement("script");
    s.async = false;
    s.src = URL.createObjectURL(new Blob([d.code], { type: "text/javascript" }));
    document.head.appendChild(s);
  });
  parent.postMessage({ kw: "kw1", type: "ready" }, "*");
})();`;

/** 부모 CSP 를 물려받은 srcdoc 을 다시 좁힌다 — 네트워크(connect·frame·img URL)를 모두 막고 부모가 건넨 바이트만 쓴다 */
export const FRAME_META_CSP = `default-src 'none'; script-src ${WIDGET_FRAME_SCRIPT_HASH} blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;

export function frameSrcdoc(): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_META_CSP}"><script>${FRAME_BOOTSTRAP}</script></head><body></body></html>`;
}
