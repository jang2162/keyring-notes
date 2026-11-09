/**
 * keyring-widget iframe 부트스트랩(web/src/widgets/frame/bootstrap.ts 의 FRAME_BOOTSTRAP)의 CSP 해시.
 * 서버 APP_CSP 와 app/src-tauri/tauri.conf.json 의 security.csp 의 script-src 에 들어간다 — 부트스트랩을 바꾸면
 * web bootstrap.test.ts 가 새 값을 찍으며 떨어진다. 그 값을 여기와 tauri.conf.json 에 함께 넣는다.
 */
export const WIDGET_FRAME_SCRIPT_HASH = "'sha256-tIDY0jSqvDd1AmqUX2wRqRUlkn1r0bkU8VHWr3LqC3c='";
