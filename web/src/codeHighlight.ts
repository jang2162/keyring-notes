import { classHighlighter, highlightCode } from "@lezer/highlight";
import { findLanguage } from "./codeLanguages";

/**
 * 미리보기 코드 블록을 편집 화면과 같은 lezer 파서·같은 tok-* 클래스로 칠한다(색은 styles.css 의 tok-* 규칙).
 * 언어 파서는 편집기와 같은 지연 로딩 청크(@codemirror/language-data)라 미리보기를 위해 따로 받는 것이 없다.
 */
export interface Piece {
  text: string;
  cls: string;
}

/** 코드 글을 lezer 파서로 나눈 조각. 언어를 모르면 null, 파서 청크를 불러오지 못하면(오프라인 등) 실패로 끝난다 — 실패는 다시 시도할 수 있어야 해서 null 과 가른다 */
export async function highlightPieces(code: string, lang: string): Promise<Piece[] | null> {
  const desc = findLanguage(lang);
  if (!desc) return null;
  const support = await desc.load();
  const out: Piece[] = [];
  const tree = support.language.parser.parse(code);
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, cls) => out.push({ text, cls }),
    () => out.push({ text: "\n", cls: "" }),
  );
  return out;
}

/** code 요소의 글을 조각대로 <span class="tok-…"> 로 다시 채운다. 글 노드로 만든다 — 정화된 글을 HTML 문자열로 다시 넣지 않는다 */
export function paintCode(el: HTMLElement, pieces: Piece[]): void {
  el.replaceChildren(
    ...pieces.map((p) => {
      if (!p.cls) return document.createTextNode(p.text);
      const span = document.createElement("span");
      span.className = p.cls;
      span.textContent = p.text;
      return span;
    }),
  );
}

/**
 * 칠한 조각 기억(언어 + 원문 → 조각, 모르는 언어는 null). 입력마다 미리보기가 다시 그려져도 깜빡이지 않게 바로 칠한다.
 * 불러오기 실패는 기억하지 않는다 — 오프라인에서 한 번 실패한 블록도 다시 그릴 때 또 시도한다. 넘치면 오래된 것부터 버린다
 */
export function pieceCache(max: number, load: (code: string, lang: string) => Promise<Piece[] | null> = highlightPieces) {
  const cache = new Map<string, Piece[] | null>();
  const key = (code: string, lang: string) => `${lang}\u0000${code}`;
  return {
    /** 기억한 조각. 아직 없거나 실패했던 것은 undefined */
    peek: (code: string, lang: string) => cache.get(key(code, lang)),
    load: async (code: string, lang: string) => {
      const pieces = await load(code, lang);
      if (cache.size >= max) cache.delete(cache.keys().next().value!);
      cache.set(key(code, lang), pieces);
      return pieces;
    },
  };
}
