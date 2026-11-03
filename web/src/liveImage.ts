import { SAFE_URI } from "./markdown";

/**
 * 줄 안 마크다운 이미지 ![글](주소) 의 주소를 그릴 URL 로 바꾼다.
 * 볼트 상대 경로면 resolve(퍼센트 인코딩을 푼 경로) → rawUrl, 주소에 스킴이 있으면 SAFE_URI 를 지날 때만 그대로.
 * 못 찾았거나 막힌 주소는 null(그리지 않고 원문으로 둔다).
 */
export function inlineImageUrl(url: string, resolve: (target: string) => string | null, rawUrl: (path: string) => string): string | null {
  const src = url.trim();
  if (!src) return null;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return SAFE_URI.test(src) ? src : null;
  let decoded = src;
  try {
    decoded = decodeURI(src);
  } catch {
    /* 잘못된 퍼센트 인코딩은 그대로 찾는다 */
  }
  const resolved = resolve(decoded);
  return resolved ? rawUrl(resolved) : null;
}

/** HTML 블록이 <!-- … --> 주석 하나뿐인가(붙여넣기 업로드 자리 표시가 이 모양이라 그리지 않는다) */
export function isCommentBlock(text: string): boolean {
  return /^\s*<!--(?:(?!-->)[\s\S])*-->\s*$/.test(text);
}
