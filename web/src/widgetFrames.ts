// vite 설정(frameBuild.ts)도 이 파일을 읽는다 — 설정을 불러올 때는 core 패키지가 빌드 전일 수 있어 해시 파일 하나만 원본에서 가져온다
import { sha256Sync } from "../../packages/core/src/hash";

/**
 * keyring-widget iframe 묶음(/widget-frame/)의 순수 도우미. 빌드는 web/frameBuild.ts, 묶음을 iframe 에 싣는 것은 widgets/frame/source.ts.
 * iframe 은 URL 로 아무것도 받지 않으므로(샌드박스 iframe 은 서비스 워커를 타지 않는다) 부모가 이 주소에서 받아 글·바이트로 건넨다.
 */
export const FRAME_DIR = "widget-frame";
/** 런타임은 위젯마다 다시 건넨다 — 크면 core 본체나 web i18n 이 끌려온 것(런타임 쪽 import 는 core/lookup·widgetT·protocol·session 뿐) */
export const FRAME_RUNTIME_GZIP_LIMIT = 20480;
/** 위젯 묶음 하나(Excalidraw 0.18.1 실측 gzip 약 1.6MB, mermaid 변환 뺌) */
export const FRAME_WIDGET_GZIP_LIMIT = 2_097_152;

export function frameAssetName(name: string, code: string | Uint8Array, ext: string): string {
  const bytes = typeof code === "string" ? new TextEncoder().encode(code) : code;
  return `${FRAME_DIR}/${name}-${sha256Sync(bytes).slice(0, 8)}${ext}`;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** CSS 안 `url(…fonts/<rel>.woff2)` → data: 주소(iframe CSP 는 font-src data: 만). 못 읽으면 그 자리는 그대로 */
export function inlineCssFonts(css: string, read: (rel: string) => Uint8Array | null): string {
  return css.replace(/url\(\s*(["']?)([^"')]*?fonts\/([^"')]+?\.woff2))\1\s*\)/g, (all, _q: string, _full: string, rel: string) => {
    const bytes = read(rel);
    return bytes ? `url(data:font/woff2;base64,${base64(bytes)})` : all;
  });
}

/** 값은 "/widget-frame/…" 주소 */
export interface FrameManifestEntry {
  js: string;
  css?: string;
  fonts?: Record<string, string>;
}

export function frameSizeErrors(sizes: { name: string; gzip: number }[]): string[] {
  return sizes.flatMap(({ name, gzip }) => {
    const limit = name === "runtime" ? FRAME_RUNTIME_GZIP_LIMIT : FRAME_WIDGET_GZIP_LIMIT;
    return gzip > limit ? [`widget-frame ${name}: ${gzip} B gzip > ${limit} B`] : [];
  });
}
