/**
 * 데일리 노트를 열 워크스페이스 정하기. 한 워크스페이스 보기는 그 워크스페이스, 모든 워크스페이스 보기는 데일리가 켜진
 * 워크스페이스가 하나면 그것, 둘 이상이면 고르게 한다(워크스페이스 순서 그대로, 마지막 선택은 기억하지 않는다)
 */
export type DailyTarget = { kind: "none" } | { kind: "one"; workspace: string } | { kind: "pick"; workspaces: string[] };

export function dailyTarget(opts: {
  allWs: boolean;
  /** 한 워크스페이스 보기의 워크스페이스 */
  ws: string;
  /** 워크스페이스 순서(orderWorkspaces) */
  names: readonly string[];
  hasDaily: (ws: string) => boolean;
}): DailyTarget {
  if (!opts.allWs) return opts.ws && opts.hasDaily(opts.ws) ? { kind: "one", workspace: opts.ws } : { kind: "none" };
  const on = opts.names.filter(opts.hasDaily);
  if (on.length === 0) return { kind: "none" };
  if (on.length === 1) return { kind: "one", workspace: on[0] };
  return { kind: "pick", workspaces: on };
}
