import { PathError } from "./errors.js";
import { setFrontmatterField } from "./frontmatter.js";
import { parseFrontmatter } from "./markdown.js";
import type { VaultNode } from "./nodes.js";
import { rankBetween, rankFits } from "./rank.js";

/**
 * 하위 노트 정렬. 정렬 방식은 부모 노트 프런트매터 `sort`, 커스텀 순서는 하위 노트마다 `rank`(rank.ts)다.
 * 정렬은 부모의 바로 아래 하위에만 쓰고 물려받지 않는다. 모든 규칙의 마지막 동점 처리는 이름순이라
 * 어느 기기에서 몇 번을 그려도 같은 순서가 나온다.
 */
export type SortKey = "name" | "modified" | "viewed" | "custom";
/**
 * 프런트매터에 적는 값. 기본 방향(이름은 오름차순, 수정·조회는 최신 먼저)이면 항목 이름 그대로, 반대 방향이면 접미사를 붙인다.
 * 접미사 없는 값이 예전 앱과 같은 뜻이라 기존 볼트가 그대로 읽히고, 예전 앱은 모르는 값을 이름순으로 본다. 커스텀에는 방향이 없다
 */
export type ChildSort = "name" | "name-desc" | "modified" | "modified-asc" | "viewed" | "viewed-asc" | "custom";
export const SORT_FIELD = "sort";
export const RANK_FIELD = "rank";

const SORTS: readonly ChildSort[] = ["name", "name-desc", "modified", "modified-asc", "viewed", "viewed-asc", "custom"];

/** 정렬의 항목(방향을 뺀 것) */
export const sortKey = (s: ChildSort): SortKey => s.replace(/-(asc|desc)$/, "") as SortKey;

/** 내림차순인가(이름 내림차순, 수정·조회의 최신 먼저). 커스텀은 false */
export const sortDescending = (s: ChildSort): boolean => s === "name-desc" || s === "modified" || s === "viewed";

/** 항목의 기본 방향이 내림차순인가(수정·조회) */
export const defaultDescending = (key: SortKey): boolean => key === "modified" || key === "viewed";

/** 항목과 방향 → 적을 값. 기본 방향이면 접미사가 없고, 커스텀은 방향을 무시한다 */
export function childSortOf(key: SortKey, descending: boolean): ChildSort {
  if (key === "custom" || descending === defaultDescending(key)) return key;
  return `${key}-${descending ? "desc" : "asc"}` as ChildSort;
}

/** rank 를 지운 내용(다른 부모로 옮긴 노드의 노트). rank 가 없거나 YAML 이 깨졌으면 그대로 — 옮기기가 실패하면 안 된다 */
export function withoutRank(content: string): string {
  if (parseFrontmatter(content).data?.[RANK_FIELD] === undefined) return content;
  try {
    return setFrontmatterField(content, RANK_FIELD, null);
  } catch {
    return content;
  }
}

/** 프런트매터 sort 값 → 정렬. 위 일곱 값이 아니면(대소문자가 다른 것 포함) 정하지 않은 것(null) */
export function parseChildSort(v: unknown): ChildSort | null {
  return typeof v === "string" && (SORTS as readonly string[]).includes(v) ? (v as ChildSort) : null;
}

const byName = (a: VaultNode, b: VaultNode) => a.name.localeCompare(b.name, "ko") || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** 값이 있는 것을 큰 것부터(descending) 또는 작은 것부터, 없는 것은 방향과 상관없이 그 뒤에 이름순. 동점도 이름순 */
function byTime(value: (n: VaultNode) => number | undefined, descending: boolean) {
  return (a: VaultNode, b: VaultNode) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1;
    return (descending ? y - x : x - y) || byName(a, b);
  };
}

/**
 * 하위 노드를 부모의 정렬로 늘어놓은 새 배열. null·name 은 받은 순서(buildNodeTree 의 이름순)를 그대로 둔다.
 * 수정·조회는 오름차순이어도 시각 없는 노드를 맨 뒤에 둔다(「시각 없음」 은 가장 오래된 것이 아니다).
 * viewedAt: 이 기기에서 그 노트를 마지막으로 연 시각(기기별 기록). 노트 없는 폴더 노드는 시각·rank 가 없는 것으로 친다.
 */
export function sortChildren(nodes: VaultNode[], sort: ChildSort | null, viewedAt: (notePath: string) => number | undefined): VaultNode[] {
  const out = [...nodes];
  if (sort === null) return out;
  const key = sortKey(sort);
  const desc = sortDescending(sort);
  // 이름 내림차순은 동점(경로)까지 뒤집는다 — 어느 기기에서나 같은 순서
  if (sort === "name-desc") return out.sort((a, b) => byName(b, a));
  if (key === "modified") return out.sort(byTime((n) => n.edited, desc));
  if (key === "viewed") return out.sort(byTime((n) => (n.note === null ? undefined : viewedAt(n.note)), desc));
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
    // 앞 이웃과 뒤 이웃 사이에 키를 만들 수 없으면(같은 rank, "a" 와 "a0") 그 노드들을 넘어설 때까지 함께 매긴다
    let end = at;
    while (end < ranked && !rankFits(lo, rest[end].rank!)) end++;
    if (end < ranked) hi = rest[end].rank!;
    run = [siblings[from], ...rest.slice(at, end)];
  }
  const keys = ranksBetween(lo, hi, run.length);
  return run.map((n, i) => ({ note: n.note, node: n.path, rank: keys[i] }));
}
