import { PathError } from "./errors.js";
import type { VaultNode } from "./nodes.js";
import { rankBetween } from "./rank.js";

/**
 * 하위 노트 정렬. 정렬 방식은 부모 노트 프런트매터 `sort`, 커스텀 순서는 하위 노트마다 `rank`(rank.ts)다.
 * 정렬은 부모의 바로 아래 하위에만 쓰고 물려받지 않는다. 모든 규칙의 마지막 동점 처리는 이름순이라
 * 어느 기기에서 몇 번을 그려도 같은 순서가 나온다.
 */
export type ChildSort = "name" | "modified" | "viewed" | "custom";
export const SORT_FIELD = "sort";
export const RANK_FIELD = "rank";

const SORTS: readonly ChildSort[] = ["name", "modified", "viewed", "custom"];

/** 프런트매터 sort 값 → 정렬. 네 글자 값이 아니면(대소문자가 다른 것 포함) 정하지 않은 것(null) */
export function parseChildSort(v: unknown): ChildSort | null {
  return typeof v === "string" && (SORTS as readonly string[]).includes(v) ? (v as ChildSort) : null;
}

const byName = (a: VaultNode, b: VaultNode) => a.name.localeCompare(b.name, "ko") || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** 값이 있는 것을 큰 것부터, 없는 것은 그 뒤에 이름순 */
function latestFirst(value: (n: VaultNode) => number | undefined) {
  return (a: VaultNode, b: VaultNode) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1;
    return y - x || byName(a, b);
  };
}

/**
 * 하위 노드를 부모의 정렬로 늘어놓은 새 배열. null·name 은 받은 순서(buildNodeTree 의 이름순)를 그대로 둔다.
 * viewedAt: 이 기기에서 그 노트를 마지막으로 연 시각(기기별 기록). 노트 없는 폴더 노드는 시각·rank 가 없는 것으로 친다.
 */
export function sortChildren(nodes: VaultNode[], sort: ChildSort | null, viewedAt: (notePath: string) => number | undefined): VaultNode[] {
  const out = [...nodes];
  if (sort === "modified") return out.sort(latestFirst((n) => n.edited));
  if (sort === "viewed") return out.sort(latestFirst((n) => (n.note === null ? undefined : viewedAt(n.note))));
  if (sort === "custom") {
    // rank 끼리는 글자 코드 비교(localeCompare 가 아니다 — rank 키는 코드 순서로 만든다)
    return out.sort((a, b) => {
      if (a.rank === undefined || b.rank === undefined) return a.rank === b.rank ? byName(a, b) : a.rank === undefined ? 1 : -1;
      return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : byName(a, b);
    });
  }
  return out;
}

/** lo < r₁ < … < rₙ < hi 인 키 n 개. 가운데부터 반씩 나눠 매겨 키가 고르게 짧다 */
function ranksBetween(lo: string | null, hi: string | null, n: number): string[] {
  if (n <= 0) return [];
  const mid = Math.floor(n / 2);
  const key = rankBetween(lo, hi);
  return [...ranksBetween(lo, key, mid), key, ...ranksBetween(key, hi, n - mid - 1)];
}

/**
 * 처음 커스텀으로 바꿀 때 적을 rank. 하위에 rank 가 하나도 없으면 노트가 있는 하위에 지금 순서대로 매긴다.
 * 노트 없는 폴더 노드에는 노트를 만들지 않는다(데일리의 연·월 묶음처럼 빈 노트가 한꺼번에 생기지 않게).
 * rank 가 하나라도 있으면(커스텀이었다가 다른 정렬로 바꿨던 경우) 남은 rank 로 보이므로 아무것도 적지 않는다.
 */
export function seedRanks(siblings: VaultNode[]): { note: string; rank: string }[] {
  if (siblings.some((n) => n.rank !== undefined)) return [];
  const notes = siblings.filter((n): n is VaultNode & { note: string } => n.note !== null);
  const keys = ranksBetween(null, null, notes.length);
  return notes.map((n, i) => ({ note: n.note, rank: keys[i] }));
}

/**
 * moving(노드 경로)을 beforePath 앞(null 이면 맨 뒤)에 두려면 적을 rank. siblings 는 지금 보이는 커스텀 순서다.
 * 보통은 옮긴 노드 하나만 바뀐다. 두 가지만 여러 개를 함께 매긴다 — 옮길 자리까지 rank 없는 노드가 있으면 그 노드들
 * (rank 없는 노드는 rank 있는 노드 뒤에 이름순으로 붙으므로), 같은 rank 둘 사이에 넣으면 뒤쪽의 같은 rank 노드들.
 * note 가 null 인 항목은 노트 없는 폴더 노드다 — 부르는 쪽이 노트를 만든 뒤 적는다. 자리가 그대로면 빈 목록.
 */
export function planReorder(siblings: VaultNode[], moving: string, beforePath: string | null): { note: string | null; node: string; rank: string }[] {
  const from = siblings.findIndex((n) => n.path === moving);
  if (from < 0) throw new PathError("node_missing", { path: moving });
  if (beforePath === moving) return [];
  const rest = siblings.filter((n) => n.path !== moving);
  const at = beforePath === null ? rest.length : rest.findIndex((n) => n.path === beforePath);
  if (at < 0) throw new PathError("node_missing", { path: beforePath! });
  if (at === from) return [];
  // rank 있는 노드는 보이는 순서의 앞쪽에 모여 있다
  let ranked = 0;
  while (ranked < rest.length && rest[ranked].rank !== undefined) ranked++;
  const lo = rest[Math.min(at, ranked) - 1]?.rank ?? null;
  let run: VaultNode[];
  let hi: string | null = null;
  if (at > ranked) {
    // rank 없는 노드들 사이·뒤: 그 자리까지의 rank 없는 노드를 앞에서부터 함께 매긴다
    run = [...rest.slice(ranked, at), siblings[from]];
  } else {
    // 뒤 이웃의 rank 가 앞 이웃보다 크지 않으면(같은 rank) 그 노드들을 넘어설 때까지 함께 매긴다
    let end = at;
    while (lo !== null && end < ranked && rest[end].rank! <= lo) end++;
    if (end < ranked) hi = rest[end].rank!;
    run = [siblings[from], ...rest.slice(at, end)];
  }
  const keys = ranksBetween(lo, hi, run.length);
  return run.map((n, i) => ({ note: n.note, node: n.path, rank: keys[i] }));
}
