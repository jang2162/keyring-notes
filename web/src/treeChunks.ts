import type { syntaxTree } from "@codemirror/language";
import type { ChangeDesc, Text } from "@codemirror/state";

/** @lezer/common 은 web 의 직접 의존성이 아니라 syntaxTree 의 결과에서 타입을 얻는다 */
type Tree = ReturnType<typeof syntaxTree>;

/**
 * 문서 트리 최상위의 한 덩어리 — 루트의 자식(Tree 나 TreeBuffer)이고, 균형을 맞추려 끼운 익명 노드는 풀어서 본다.
 * TreeBuffer 하나에 최상위 노드가 여럿 들 수 있다. 최상위 노드는 꼭 한 덩어리에 들고, 덩어리끼리 겹치지 않는다.
 */
export interface TopChunk {
  node: object;
  from: number;
  to: number;
}

export function topChunks(tree: Tree): TopChunk[] {
  const out: TopChunk[] = [];
  const walk = (t: Tree, off: number) => {
    for (let i = 0; i < t.children.length; i++) {
      const c = t.children[i]!;
      const at = off + t.positions[i]!;
      // TreeBuffer 의 type 도 익명(NodeType.none)이라 자식 목록이 있는지로 가른다
      if ("children" in c && c.type.isAnonymous) walk(c, at);
      else out.push({ node: c, from: at, to: at + c.length });
    }
  };
  walk(tree, 0);
  return out;
}

/**
 * next 의 덩어리마다, 바뀌기 전 트리(prev)의 같은 객체가 같은 자리(바뀐 뒤 위치로 옮겨서)에 있고 그 덩어리가 걸친 줄을
 * 고친 데가 없으면 그 순번, 아니면 -1.
 *
 * 트리는 불변이라 같은 객체면 그 안 노드가 모두 같다. 파서는 고치지 않은 곳의 노드를 객체째 다시 쓴다(mixed-800 의 가운데
 * 한 글자: 최상위 덩어리 5,277 개 중 5,275 개). 다만 줄 처음·끝 글(들여쓰기 등)은 덩어리 밖일 수 있고, 그 줄을 보고 판정하는 쪽이
 * 있어서(liveBlocks 의 펜스 정보 줄) 덩어리가 걸친 줄을 고쳤으면 같은 객체여도 다시 보게 한다.
 * 다시 쓰지 않은 덩어리는 -1 이 될 뿐이라, 파서가 덜 다시 써도 결과가 틀리지는 않고 느려지기만 한다
 */
export function matchChunks(prev: readonly TopChunk[], next: readonly TopChunk[], changes: ChangeDesc, oldDoc: Text): Int32Array {
  // 고친 범위를 줄 전체로 늘린 것(바뀌기 전 위치, 문서 순서)
  const dirty: [number, number][] = [];
  changes.iterChangedRanges((fromA, toA) => dirty.push([oldDoc.lineAt(fromA).from, oldDoc.lineAt(toA).to]));
  const out = new Int32Array(next.length).fill(-1);
  let i = 0;
  let d = 0;
  for (let j = 0; j < next.length; j++) {
    const n = next[j]!;
    while (i < prev.length && changes.mapPos(prev[i]!.from, 1) < n.from) i++;
    // 옮긴 자리가 같은 것이 여럿일 수 있다(지운 범위 안의 덩어리는 한 점으로 모인다)
    for (let k = i; k < prev.length && changes.mapPos(prev[k]!.from, 1) === n.from; k++) {
      const p = prev[k]!;
      if (p.node !== n.node || changes.mapPos(p.to, -1) !== n.to) continue;
      while (d < dirty.length && dirty[d]![1] < p.from) d++;
      if (d < dirty.length && dirty[d]![0] <= p.to) break;
      out[j] = k;
      i = k + 1;
      break;
    }
  }
  return out;
}
