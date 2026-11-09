import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, type EditorState, type RangeSet } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

class HeadingGutterClass extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}
const headingGutterClasses = new Map([1, 2, 3, 5, 6].map((n) => [n, new HeadingGutterClass(`cm-fold-h${n}`)]));

export function headingGutterLines(state: EditorState): RangeSet<GutterMarker> {
  const b = new RangeSetBuilder<GutterMarker>();
  // 최상위 블록만 본다(목록·인용 안 제목은 드물고, 문서 전체를 매번 훑지 않으려고)
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      const m = /^ATXHeading(\d)$/.exec(n.name);
      const marker = m && headingGutterClasses.get(Number(m[1]));
      if (marker) b.add(n.from, n.from, marker);
      return false;
    },
  });
  return b.finish();
}

/**
 * 제목 줄(H1~H3, H5·H6)의 거터 칸에 cm-fold-h1 등을 단다. 거터 칸은 줄 블록 높이만 받고 그 줄의 글자 크기는 모른다 —
 * 접기 화살표를 그 줄 첫 줄의 세로 가운데에 두려고 styles.css 「접기」 가 이 클래스로 칸의 줄 높이를 제목 글자에 맞춘다.
 * H4 는 두 모드 모두 본문 크기라 달 것이 없다. H5·H6 은 Live Preview 에서만 본문보다 작다(원문 모드는 CSS 가 없다).
 */
export const headingGutterClass = StateField.define<RangeSet<GutterMarker>>({
  create: headingGutterLines,
  update: (v, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? headingGutterLines(tr.state) : v),
  provide: (f) => gutterLineClass.from(f),
});
