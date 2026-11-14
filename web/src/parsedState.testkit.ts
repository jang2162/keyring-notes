import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * 끝까지 파싱한 상태. 편집기 시험이 함께 쓰는 도구다(시험 파일이 아니다).
 *
 * `ensureSyntaxTree(s)` 만으로는 `syntaxTree(s)` 가 바뀌지 않는다 — 앞의 것은 상태 사이에 공유되는 파싱 문맥만 더
 * 진행하고, 뒤의 것은 상태가 만들어질 때 받아 둔 트리를 돌려준다. 상태를 만들 때의 첫 파싱은 앞 3,000 자까지, 20ms
 * 안에서만 한다. 그래서 큰 문서는 늘, 작은 문서도 기계가 바쁘면 덜 파싱된 트리가 남아 블록·표를 못 찾는다(조용히 빈
 * 결과). 파싱을 더 시킨 뒤 빈 트랜잭션을 한 번 주면 새 상태가 그 트리를 받는다 — 편집기의 배경 파싱이 하는 일과 같다.
 * 재현은 `parsedState.test.ts`.
 */
export function parsed(state: EditorState): EditorState {
  if (!ensureSyntaxTree(state, state.doc.length, 5000)) throw new Error("5초 안에 문서 끝까지 파싱하지 못했다");
  return state.update({}).state;
}
