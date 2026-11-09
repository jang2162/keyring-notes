import type { FrameCode } from "../registry";

/** 위젯 코드 원천 → iframe 에 건넬 글·바이트. 주소면 부모가 받는다(iframe 은 URL 로 아무것도 받지 않는다). 하나라도 못 받으면 거절 */
export async function resolveFrameCode(
  c: FrameCode,
  get: { text(url: string): Promise<string>; bytes(url: string): Promise<ArrayBuffer> },
): Promise<{ js: string; css: string; fonts: Record<string, ArrayBuffer> }> {
  if (c.kind === "text") return { js: c.js, css: c.css ?? "", fonts: {} };
  const fontEntries = Object.entries(c.fonts ?? {});
  const [js, css, fonts] = await Promise.all([
    get.text(c.js),
    c.css ? get.text(c.css) : Promise.resolve(""),
    Promise.all(fontEntries.map(async ([k, url]) => [k, await get.bytes(url)] as const)),
  ]);
  return { js, css, fonts: Object.fromEntries(fonts) };
}

/** 앱 출처에서 받는다. 오프라인이면 SW 캐시(한 번 연 뒤)에서 나온다 */
export const fetchFrameCode = {
  async text(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.text();
  },
  async bytes(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.arrayBuffer();
  },
};
