/**
 * 같은 문서를 여러 칸에 열었을 때 한쪽 에디터의 변경(ChangeSet)을 다른 쪽에 그대로 옮기는 데 쓰는 것.
 * Editor.tsx 는 화면·core 를 끌어오므로, 단위 테스트(node)에서 쓸 수 있게 따로 둔다.
 */
import { Annotation, Transaction, type ChangeSet, type EditorState, type TransactionSpec } from "@codemirror/state";

/** 다른 칸에서 온 트랜잭션 표식: 받은 쪽이 다시 내보내지 않게 한다 */
export const mirrored = Annotation.define<boolean>();

/** 변경이 이 문서에 그대로 들어맞는가(변경의 원래 길이 = 문서 길이). 어긋나면 내용 전체로 맞춘다 */
export const canMirror = (docLength: number, changes: ChangeSet): boolean => changes.length === docLength;

/** 두 글의 앞뒤 같은 부분을 빼고 달라진 한 구간. 같으면 null */
export function diffChange(cur: string, next: string): { from: number; to: number; insert: string } | null {
  if (cur === next) return null;
  let a = 0;
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
  let b = 0;
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
  return { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) };
}

/**
 * 다른 칸의 변경을 이 뷰에 넣을 트랜잭션. 표식(mirrored)을 붙여 되돌아 나가지 않게 하고, 이 칸의 실행 취소 기록에는 남기지 않는다.
 * 두 뷰가 어긋났으면(예: 다시 만드는 중) fallback(저장소의 최신 초안)과 달라진 곳만 맞춘다. 넣을 것이 없으면 null
 */
export function mirrorSpec(state: EditorState, changes: ChangeSet, fallback: string): TransactionSpec | null {
  const annotations = [mirrored.of(true), Transaction.addToHistory.of(false)];
  if (canMirror(state.doc.length, changes)) return { changes, annotations };
  const diff = diffChange(state.doc.toString(), fallback);
  return diff ? { changes: diff, annotations } : null;
}

/**
 * 뷰 업데이트 하나에서 밖(초안·다른 칸)으로 내보낼 변경. 초안은 이 칸에서 친 변경으로만 고친다 —
 * 다른 칸에서 받은 변경(mirrored)은 원본(저장소)에 이미 들어 있고, 낡은 뷰(만든 docKey ≠ 지금 docKey:
 * 칸의 문서가 바뀐 뒤 다시 만들기 전)의 콜백은 새 문서에 묶여 있어 부르면 다른 문서의 초안을 덮는다
 */
export function outgoingChanges(transactions: readonly Transaction[], createdKey: string, currentKey: string): ChangeSet[] {
  if (createdKey !== currentKey) return [];
  return transactions.filter((tr) => tr.docChanged && tr.annotation(mirrored) !== true).map((tr) => tr.changes);
}

/**
 * 칸 source 의 에디터(docKey = 문서 경로#판)에서 생긴 변경을 넣어도 되는 다른 칸들.
 * 배치상 그 문서를 보고 있고, 그 칸의 에디터가 **같은 docKey 로 만들어진 것**이어야 한다 — 배치는 바뀌었는데
 * 아직 다시 그리기 전이면 그 칸의 에디터는 다른 문서의 것이라, 넣으면 그 문서가 덮어써진다.
 */
export function mirrorTargets(
  source: string,
  path: string,
  sourceKey: string,
  panes: readonly { id: string; active: string | null }[],
  editorKeys: Readonly<Record<string, string | null>>,
): string[] {
  return panes.filter((p) => p.id !== source && p.active === path && editorKeys[p.id] === sourceKey).map((p) => p.id);
}
