import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateField, type ChangeDesc, type EditorState, type RangeSet, type Text } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";
import { matchChunks, topChunks, type TopChunk } from "./treeChunks";

class HeadingGutterClass extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}
const headingGutterClasses = new Map([1, 2, 3, 5, 6].map((n) => [n, new HeadingGutterClass(`cm-fold-h${n}`)]));

/** 최상위 노드 중 시작이 from 이상 to 미만인 제목 줄에 단다(목록·인용 안 제목은 드물고, 문서 전체를 매번 훑지 않으려고 최상위만 본다) */
function addHeadings(state: EditorState, from: number, to: number, b: RangeSetBuilder<GutterMarker>) {
  const c = syntaxTree(state).cursor();
  if (!c.childAfter(from)) return;
  do {
    if (c.from >= to) break;
    const m = /^ATXHeading(\d)$/.exec(c.name);
    const marker = m && headingGutterClasses.get(Number(m[1]));
    if (marker) b.add(c.from, c.from, marker);
  } while (c.nextSibling());
}

export function headingGutterLines(state: EditorState): RangeSet<GutterMarker> {
  const b = new RangeSetBuilder<GutterMarker>();
  addHeadings(state, 0, state.doc.length + 1, b);
  return b.finish();
}

/** 표시와, 다음 갱신이 옛 트리와 맞대 볼 그때의 문서·최상위 덩어리 */
interface HeadingGutter {
  set: RangeSet<GutterMarker>;
  doc: Text;
  chunks: TopChunk[];
}

function createHeadings(state: EditorState): HeadingGutter {
  return { set: headingGutterLines(state), doc: state.doc, chunks: topChunks(syntaxTree(state)) };
}

/**
 * prev 를 state 로 옮긴다. 옛 트리의 같은 덩어리를 다시 쓴 자리(treeChunks.ts matchChunks)는 옛 표시를 옮기고 나머지 덩어리만 다시 본다.
 * 결과는 headingGutterLines(state) 와 늘 같다 — 퍼즈 시험(foldGutterClass.test.ts)이 맞대 본다
 */
export function updateHeadings(prev: HeadingGutter, state: EditorState, changes: ChangeDesc): HeadingGutter {
  const chunks = topChunks(syntaxTree(state));
  const match = matchChunks(prev.chunks, chunks, changes, prev.doc);
  const b = new RangeSetBuilder<GutterMarker>();
  const it = prev.set.iter();
  for (let j = 0; j < chunks.length;) {
    const m = match[j]!;
    if (m < 0) {
      let k = j;
      while (k < chunks.length && match[k]! < 0) k++;
      addHeadings(state, chunks[j]!.from, chunks[k - 1]!.to, b);
      j = k;
      continue;
    }
    const o = prev.chunks[m]!;
    const shift = chunks[j]!.from - o.from;
    while (it.value && it.from < o.from) it.next();
    for (; it.value && it.from < o.to; it.next()) b.add(it.from + shift, it.from + shift, it.value);
    j++;
  }
  return { set: b.finish(), doc: state.doc, chunks };
}

/**
 * 제목 줄(H1~H3, H5·H6)의 거터 칸에 cm-fold-h1 등을 단다. 거터 칸은 줄 블록 높이만 받고 그 줄의 글자 크기는 모른다 —
 * 접기 화살표를 그 줄 첫 줄의 세로 가운데에 두려고 styles.css 「접기」 가 이 클래스로 칸의 줄 높이를 제목 글자에 맞춘다.
 * H4 는 두 모드 모두 본문 크기라 달 것이 없다. H5·H6 은 Live Preview 에서만 본문보다 작다(원문 모드는 CSS 가 없다).
 */
export const headingGutterClass = StateField.define<HeadingGutter>({
  create: createHeadings,
  update: (v, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? updateHeadings(v, tr.state, tr.changes) : v),
  provide: (f) => gutterLineClass.from(f, (v) => v.set),
});
