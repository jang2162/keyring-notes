import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";

/**
 * 미리보기 코드 블록을 편집 화면과 같은 lezer 파서·같은 tok-* 클래스로 칠한다(색은 styles.css 의 tok-* 규칙).
 * 언어 파서는 편집기와 같은 지연 로딩 청크(@codemirror/language-data)라 미리보기를 위해 따로 받는 것이 없다.
 */
export interface Piece {
  text: string;
  cls: string;
}

/** 코드 글을 lezer 파서로 나눈 조각. 언어를 모르거나 불러오지 못하면 null */
export async function highlightPieces(code: string, lang: string): Promise<Piece[] | null> {
  const desc = LanguageDescription.matchLanguageName(languages, lang.trim(), true);
  if (!desc) return null;
  let support;
  try {
    support = await desc.load();
  } catch {
    return null;
  }
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
