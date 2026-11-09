import { useSyncExternalStore } from "react";

/**
 * 첨부 내용이 같은 경로에서 바뀌었을 때(교체·동기화) 화면이 새 내용을 보이게 하는 판 번호(경로별, 이 창 안).
 * 브라우저는 한 문서 안에서 같은 주소의 그림을 다시 받지 않으므로 첨부 주소에 판을 붙이고, 이미 그려진 그림은 주소를 바꿔 끼운다
 */
const versions = new Map<string, number>();
const subs = new Set<() => void>();

export const rawVersion = (path: string) => versions.get(path) ?? 0;

/** 판이 있으면 주소에 붙인다(판 0 은 주소 그대로) */
export function versioned(url: string, path: string): string {
  const v = versions.get(path);
  return v ? `${url}${url.includes("?") ? "&" : "?"}v=${v}` : url;
}

/** 이미 그려진 그림(미리보기·Live Preview·첨부 목록·파일 보기)의 주소를 바꿔 끼운다 */
export function swapImageSrc(before: string, after: string) {
  if (before === after || typeof document === "undefined") return;
  for (const img of document.querySelectorAll("img")) if (img.getAttribute("src") === before) img.setAttribute("src", after);
}

/** 경로의 판을 올린다. urlOf 를 주면 그려진 그림을 새 주소로 바꾼다 */
export function bumpRawVersion(paths: Iterable<string>, urlOf?: (path: string) => string) {
  let any = false;
  for (const p of paths) {
    const before = urlOf?.(p);
    versions.set(p, rawVersion(p) + 1);
    if (urlOf && before !== undefined) swapImageSrc(before, urlOf(p));
    any = true;
  }
  if (!any) return;
  for (const f of subs) f();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("keyring:asset-loaded"));
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** 그 경로의 판(PDF 보기처럼 바이트를 직접 읽는 곳이 다시 읽게) */
export function useRawVersion(path: string): number {
  return useSyncExternalStore(subscribe, () => rawVersion(path));
}
