import { describe, expect, it } from "vitest";
import { persistRequester } from "./persist";

function manager(persisted: boolean, grant = true) {
  const calls = { persisted: 0, persist: 0 };
  const m = {
    persisted: async () => (calls.persisted++, persisted),
    persist: async () => (calls.persist++, grant),
  };
  return { m, calls };
}

describe("저장소 보존 요청", () => {
  it("보존되지 않았으면 요청하고 그 결과를 돌려준다", async () => {
    const { m, calls } = manager(false, true);
    expect(await persistRequester(() => m)()).toBe(true);
    expect(calls.persist).toBe(1);
    const denied = manager(false, false);
    expect(await persistRequester(() => denied.m)()).toBe(false);
  });

  it("이미 보존되면 묻지 않는다", async () => {
    const { m, calls } = manager(true);
    expect(await persistRequester(() => m)()).toBe(true);
    expect(calls.persist).toBe(0);
  });

  it("페이지마다 많아야 한 번 묻는다", async () => {
    const { m, calls } = manager(false, false);
    const ask = persistRequester(() => m);
    await Promise.all([ask(), ask()]);
    expect(await ask()).toBe(false);
    expect(calls.persist).toBe(1);
    expect(calls.persisted).toBe(1);
  });

  it("API 가 없거나 실패하면 조용히 null", async () => {
    expect(await persistRequester(() => undefined)()).toBeNull();
    expect(await persistRequester(() => ({}) as never)()).toBeNull();
    const broken = { persisted: async () => Promise.reject(new Error("x")), persist: async () => true };
    expect(await persistRequester(() => broken)()).toBeNull();
  });
});
