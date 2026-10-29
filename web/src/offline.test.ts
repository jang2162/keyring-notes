import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./persist", () => ({ requestPersist: vi.fn(async () => null) }));

const { ApiError } = await import("./api");
const { offline, searchFailedOffline } = await import("./offline");
const { requestPersist } = await import("./persist");

describe("검색이 연결이 없어 실패했는지", () => {
  it("서버 모드의 네트워크 오류(fetch 의 TypeError)만", () => {
    expect(searchFailedOffline(false, new TypeError("Failed to fetch"))).toBe(true);
  });

  it("서버가 준 오류(4xx·5xx)는 아니다", () => {
    for (const status of [400, 401, 404, 500, 503]) expect(searchFailedOffline(false, new ApiError(status, "error", "x"))).toBe(false);
  });

  it("로컬 볼트는 아니다", () => {
    expect(searchFailedOffline(true, new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("오프라인 대기열에 넣기", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("넣을 때 저장소 보존을 청한다", async () => {
    // IndexedDB 는 Node 에 없다: 여는 즉시 실패하는 가짜를 둔다(보존 요청은 저장보다 먼저 나간다)
    vi.stubGlobal("indexedDB", {
      open: () => {
        const req: { onerror?: () => void; error: Error } = { error: new Error("no idb") };
        setTimeout(() => req.onerror?.(), 0);
        return req;
      },
    });
    await offline.queue("a.md", "x", null).catch(() => undefined);
    expect(requestPersist).toHaveBeenCalledTimes(1);
  });
});
