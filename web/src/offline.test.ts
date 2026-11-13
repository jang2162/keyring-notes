import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./persist", () => ({ requestPersist: vi.fn(async () => null) }));

const { ApiError } = await import("./api");
const { offline, outboxFailure, rejectionsToClear, saveFailedOffline, searchFailedOffline } = await import("./offline");
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

describe("저장 실패를 오프라인 저장으로 돌릴지", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("서버 모드의 네트워크 오류만 대기열로 돌린다", () => {
    expect(saveFailedOffline(false, new TypeError("Failed to fetch"))).toBe(true);
    expect(saveFailedOffline(false, new ApiError(413, "error", "too large"))).toBe(false);
  });

  it("기기 볼트는 네트워크가 끊겨 있어도 돌리지 않는다 — 디스크 쓰기 실패는 저장 실패다(대기열을 보낼 곳이 없다)", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(saveFailedOffline(true, new Error("ENOSPC: no space left on device"))).toBe(false);
    expect(saveFailedOffline(true, "write failed")).toBe(false);
    expect(saveFailedOffline(true, new TypeError("x is not a function"))).toBe(false);
  });
});

describe("대기열 항목을 보내다 실패했을 때", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("서버에서 먼저 바뀌었으면(409) 충돌", () => {
    expect(outboxFailure(new ApiError(409, "conflict", "x", "h"))).toBe("conflict");
  });

  it("연결이 없거나 로그인이 필요하면(401) 멈춘다 — 뒤 항목도 같은 이유로 못 간다", () => {
    expect(outboxFailure(new TypeError("Failed to fetch"))).toBe("stop");
    expect(outboxFailure(new ApiError(401, "unauthorized", "x"))).toBe("stop");
    vi.stubGlobal("navigator", { onLine: false });
    expect(outboxFailure(new Error("aborted"))).toBe("stop");
  });

  it("서버·프록시가 통째로 내려가 있으면(502·503·504) 멈춘다 — 그 항목이 거절된 것이 아니다", () => {
    for (const status of [502, 503, 504]) expect(outboxFailure(new ApiError(status, "error", "x"))).toBe("stop");
  });

  it("그 밖의 서버 거절은 그 항목만 건너뛴다 — 뒤 항목을 막지 않는다", () => {
    for (const status of [400, 403, 404, 413, 422, 500, 501]) expect(outboxFailure(new ApiError(status, "error", "x"))).toBe("skip");
  });
});

describe("거절을 알린 기록 가운데 걷을 것", () => {
  it("이번에 보낸 경로와 대기열에서 이미 빠진 경로", () => {
    expect(rejectionsToClear(["a.md", "b.md", "c.md"], ["a.md", "b.md"], ["a.md"])).toEqual(["a.md", "c.md"]);
  });

  it("아직 대기 중이고 이번에 못 보낸 경로는 남긴다(멈춰서 손대지 않은 항목 포함)", () => {
    expect(rejectionsToClear(["a.md", "b.md"], ["a.md", "b.md"], [])).toEqual([]);
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
