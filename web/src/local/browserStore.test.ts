import { describe, expect, it, vi } from "vitest";

vi.mock("../persist", () => ({ requestPersist: vi.fn(async () => null) }));
vi.mock("./idbStore", () => ({ IdbStore: class {} }));

const { openBrowserStore } = await import("./browserStore");
const { requestPersist } = await import("../persist");

describe("브라우저 로컬 볼트 저장소", () => {
  it("열 때 저장소 보존을 청한다", () => {
    openBrowserStore();
    expect(requestPersist).toHaveBeenCalledTimes(1);
  });
});
