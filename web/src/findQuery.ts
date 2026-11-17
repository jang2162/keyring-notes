import type { SearchQuery } from "@codemirror/search";
import { Facet, type EditorState } from "@codemirror/state";

/** 찾기 막대(findBar.ts)가 쓰는 계산. DOM 없이 상태만 본다 */
export interface Match {
  from: number;
  to: number;
}

export interface MatchStats {
  total: number;
  /** 선택이 놓인 일치가 몇 번째인지(1부터). 일치 위가 아니면 0 */
  current: number;
  /** 상한까지만 셌다 */
  capped: boolean;
}

/**
 * 찾기에서 뺄 문서 맨 앞 범위의 끝(그 위치까지 포함, 없으면 -1). 화면에 없는 글이다 — 접힌 프런트매터(livePreview.ts frontmatterFold).
 * 그 안에서 시작하는 일치는 세지도 고르지도 않는다
 */
export const hiddenFromFind = Facet.define<(state: EditorState) => number, (state: EditorState) => number>({
  combine: (fs) => (state) => fs.reduce((end, f) => Math.max(end, f(state)), -1),
});

export const hiddenEnd = (state: EditorState) => state.facet(hiddenFromFind)(state);

/** 일치를 차례로. 빈 일치(정규식 ^ 등)는 찾기에서 쓸모가 없어 뺀다 */
function* matches(state: EditorState, query: SearchQuery, from = 0): Generator<Match> {
  if (!query.valid) return;
  const hidden = hiddenEnd(state);
  const cur = query.getCursor(state, Math.min(state.doc.length, Math.max(from, hidden + 1)));
  for (let r = cur.next(); !r.done; r = cur.next()) {
    if (r.value.to > r.value.from && r.value.from > hidden) yield { from: r.value.from, to: r.value.to };
  }
}

export function matchStats(state: EditorState, query: SearchQuery, limit = 1000): MatchStats {
  const sel = state.selection.main;
  let total = 0;
  let current = 0;
  for (const m of matches(state, query)) {
    if (total === limit) return { total, current, capped: true };
    total++;
    if (m.from === sel.from && m.to === sel.to) current = total;
  }
  return { total, current, capped: false };
}

/** pos(기본: 선택 끝) 이후의 첫 일치(그 자리에서 시작하는 일치도). 없으면 처음으로 돈다 */
export function nextMatch(state: EditorState, query: SearchQuery, pos = state.selection.main.to): Match | null {
  const after = matches(state, query, pos).next();
  if (!after.done) return after.value;
  const first = matches(state, query).next();
  return first.done ? null : first.value;
}

/** 선택 시작 앞의 마지막 일치. 없으면 끝으로 돈다 */
export function prevMatch(state: EditorState, query: SearchQuery): Match | null {
  const before = state.selection.main.from;
  let last: Match | null = null;
  let prev: Match | null = null;
  for (const m of matches(state, query)) {
    if (m.from < before) prev = m;
    last = m;
  }
  return prev ?? last;
}

/** 일치 수 글: 「3/12」, 일치 위가 아니면 「?/12」, 없으면 「결과 없음」. 검색어가 없으면 빈 글 */
export function countLabel(query: SearchQuery, s: MatchStats, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!query.search) return "";
  if (!query.valid) return t("find.invalid");
  if (!s.total) return t("find.none");
  return t("find.count", { current: s.current || "?", total: `${s.total}${s.capped ? "+" : ""}` });
}
