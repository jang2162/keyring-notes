import { KeyedError, type LockEntry, type RepoIndexResult } from "@keyring-notes/core";

/**
 * 서버 마켓 API(/api/market/*) 클라이언트. 서버 모드는 같은 출처 쿠키(base ""), 기기 볼트 + 동기화는 동기화와 같은 기기 토큰.
 * 실패는 서버 응답의 code·params 그대로의 KeyedError(HTTP 상태를 status 로 붙인다 — 401 이면 대신 받기를 고른다).
 */
export class MarketHttpError extends KeyedError {
  constructor(
    code: string,
    params: Record<string, string | number>,
    readonly status: number,
  ) {
    super(code, params);
  }
}

export interface MarketStatus {
  state: "ready" | "fetching" | "error";
  version: string;
  error?: { code: string; params: Record<string, string | number> };
}

export function marketClient(base: string, fetchFn: typeof fetch, token?: string) {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => (token ? { ...extra, authorization: `Bearer ${token}` } : extra);
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetchFn(`${base}/api/market/${path}`, { ...init, headers: headers(init.headers as Record<string, string>) });
    if (res.ok) return res;
    let body: { code?: unknown; params?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* 본문이 JSON 이 아니면 상태만 */
    }
    const code = typeof body.code === "string" ? body.code : res.status === 401 ? "device_unauthorized" : "market_fetch_failed";
    const params = body.params && typeof body.params === "object" ? (body.params as Record<string, string | number>) : { reason: `http_${res.status}` };
    throw new MarketHttpError(code, params, res.status);
  };
  return {
    async index(repo: string): Promise<RepoIndexResult> {
      return (await (await call(`index?repo=${encodeURIComponent(repo)}`)).json()) as RepoIndexResult;
    },
    async ensure(id: string, entry: LockEntry, sizes?: Record<string, number>): Promise<void> {
      await call("ensure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, entry, sizes }) });
    },
    async file(id: string, version: string, path: string, sha256: string): Promise<Uint8Array> {
      const q = new URLSearchParams({ id, version, path, sha256 });
      return new Uint8Array(await (await call(`file?${q}`)).arrayBuffer());
    },
    async status(): Promise<Record<string, MarketStatus>> {
      return (await (await call("status")).json()) as Record<string, MarketStatus>;
    },
  };
}
