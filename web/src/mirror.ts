/**
 * 같은 문서를 두 칸에 열었을 때 한쪽 에디터의 변경(ChangeSet)을 다른 쪽에 그대로 옮기는 데 쓰는 것.
 * Editor.tsx 는 화면·core 를 끌어오므로, 단위 테스트(node)에서 쓸 수 있게 따로 둔다.
 */
import { Annotation, type ChangeSet } from "@codemirror/state";

/** 다른 칸에서 온 트랜잭션 표식: 받은 쪽이 다시 내보내지 않게 한다 */
export const mirrored = Annotation.define<boolean>();

/** 변경이 이 문서에 그대로 들어맞는가(변경의 원래 길이 = 문서 길이). 어긋나면 내용 전체로 맞춘다 */
export const canMirror = (docLength: number, changes: ChangeSet): boolean => changes.length === docLength;

/**
 * 칸 source 의 에디터(docKey = 문서 경로#판)에서 생긴 변경을 넣어도 되는 다른 칸들.
 * 배치상 그 문서를 보고 있고, 그 칸의 에디터가 **같은 docKey 로 만들어진 것**이어야 한다 — 배치는 바뀌었는데
 * 아직 다시 그리기 전이면 그 칸의 에디터는 다른 문서의 것이라, 넣으면 그 문서가 덮어써진다.
 */
export function mirrorTargets(
  source: number,
  path: string,
  sourceKey: string,
  panes: readonly { active: string | null }[],
  editorKeys: readonly (string | null)[],
): number[] {
  const out: number[] = [];
  panes.forEach((p, j) => {
    if (j !== source && p.active === path && editorKeys[j] === sourceKey) out.push(j);
  });
  return out;
}
