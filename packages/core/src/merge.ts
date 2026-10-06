import { diffArrays } from "diff";

/**
 * 줄 단위 3방향 병합(diff3). base에서 ours와 theirs가 각각 어떻게 바뀌었는지 보고,
 * 서로 다른 곳을 고쳤으면 둘 다 반영한 내용을 만든다.
 *
 * 같은 줄(또는 바로 붙은 줄)을 양쪽이 다르게 고쳤으면 병합하지 않는다(git과 같은 기준).
 * 이때 문서 안에 충돌 표시(<<<<<<<)를 넣지 않고, 부르는 쪽이 지금처럼 충돌 사본을 만든다.
 */
export type MergeResult = { ok: true; text: string } | { ok: false; conflicts: number };

interface Hunk {
  /** base에서 바뀐 범위 [start, end) */
  start: number;
  end: number;
  /** 그 자리에 들어갈 줄 */
  lines: string[];
  side: "ours" | "theirs";
}

function hunks(base: string[], side: string[], tag: Hunk["side"]): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  let cur: Hunk | null = null;
  for (const c of diffArrays(base, side)) {
    const n = c.count ?? c.value.length;
    if (!c.added && !c.removed) {
      if (cur) out.push(cur);
      cur = null;
      i += n;
      continue;
    }
    cur ??= { start: i, end: i, lines: [], side: tag };
    if (c.removed) {
      i += n;
      cur.end = i;
    } else {
      cur.lines.push(...c.value);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** base[start, end)에 이 쪽 변경들을 적용한 결과 */
function apply(base: string[], start: number, end: number, list: Hunk[]): string[] {
  const out: string[] = [];
  let i = start;
  for (const h of list) {
    out.push(...base.slice(i, h.start), ...h.lines);
    i = h.end;
  }
  out.push(...base.slice(i, end));
  return out;
}

export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs) return { ok: true, text: ours };
  if (base === ours) return { ok: true, text: theirs };
  if (base === theirs) return { ok: true, text: ours };
  const b = base.split("\n");
  const all = [...hunks(b, ours.split("\n"), "ours"), ...hunks(b, theirs.split("\n"), "theirs")].sort((x, y) => x.start - y.start || x.end - y.end);

  // 겹치거나 맞닿은 변경끼리 묶는다
  const groups: Hunk[][] = [];
  let groupEnd = -1;
  for (const h of all) {
    const g = groups[groups.length - 1];
    if (g && h.start <= groupEnd) {
      g.push(h);
      groupEnd = Math.max(groupEnd, h.end);
    } else {
      groups.push([h]);
      groupEnd = h.end;
    }
  }

  const out: string[] = [];
  let i = 0;
  let conflicts = 0;
  for (const g of groups) {
    const start = Math.min(...g.map((h) => h.start));
    const end = Math.max(...g.map((h) => h.end));
    out.push(...b.slice(i, start));
    const mine = g.filter((h) => h.side === "ours");
    const other = g.filter((h) => h.side === "theirs");
    if (mine.length === 0) out.push(...apply(b, start, end, other));
    else if (other.length === 0) out.push(...apply(b, start, end, mine));
    else {
      const a = apply(b, start, end, mine);
      const t = apply(b, start, end, other);
      // 양쪽이 똑같이 고쳤으면 하나로
      if (a.length === t.length && a.every((l, k) => l === t[k])) out.push(...a);
      else conflicts++;
    }
    i = end;
  }
  if (conflicts) return { ok: false, conflicts };
  out.push(...b.slice(i));
  return { ok: true, text: out.join("\n") };
}
