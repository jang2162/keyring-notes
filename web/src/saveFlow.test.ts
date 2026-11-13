import { describe, expect, it, vi } from "vitest";
import { flushDocs, logoutLoss } from "./saveFlow";

/** 저장하면 깨끗해지는 가짜 저장소. stuck 에 든 문서는 저장해도 그대로 남는다(충돌·저장 실패) */
const store = (dirty: string[], stuck: string[] = []) => {
  const left = new Set(dirty);
  const save = vi.fn(async (p: string) => {
    if (!stuck.includes(p)) left.delete(p);
  });
  return { left, save, dirty: (p: string) => left.has(p) };
};

describe("다른 일 전에 저장하기(flushDocs)", () => {
  it("저장 안 한 문서가 없으면 true, 저장을 부르지 않는다", async () => {
    const s = store([]);
    expect(await flushDocs(["a.md", "b.md"], { ...s, autosave: true })).toBe(true);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("자동 저장이 켜져 있으면 저장하고, 다 저장됐으면 true", async () => {
    const s = store(["a.md", "b.md"]);
    expect(await flushDocs(["a.md", "b.md", "c.md"], { ...s, autosave: true })).toBe(true);
    expect(s.save.mock.calls.map((c) => c[0])).toEqual(["a.md", "b.md"]);
  });

  it("자동 저장을 껐으면 대신 저장하지 않고, 저장 안 한 것이 남았다고 false 로 답한다", async () => {
    const s = store(["a.md"]);
    expect(await flushDocs(["a.md"], { ...s, autosave: false })).toBe(false);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.left.has("a.md")).toBe(true);
  });

  it("자동 저장을 꺼도 저장 안 한 문서가 없으면 true", async () => {
    const s = store([]);
    expect(await flushDocs(["a.md"], { ...s, autosave: false })).toBe(true);
  });

  it("저장해도 남은 문서(충돌·저장 실패)가 있으면 false", async () => {
    const s = store(["a.md", "b.md"], ["b.md"]);
    expect(await flushDocs(["a.md", "b.md"], { ...s, autosave: true })).toBe(false);
    expect(s.left.has("a.md")).toBe(false);
  });
});

describe("로그아웃하면 사라질 것(logoutLoss)", () => {
  it("저장 안 한 것도 못 보낸 것도 없으면 null(묻지 않는다)", () => {
    expect(logoutLoss({ dirty: [], files: [], queued: 0 })).toBeNull();
  });

  it("뒤 탭의 저장 안 한 노트도 센다", () => {
    expect(logoutLoss({ dirty: ["a.md", "b.md"], files: [], queued: 0 })).toEqual({ unsaved: ["a.md", "b.md"], queued: 0 });
  });

  it("저장 안 한 그림(데이터 파일)도 센다", () => {
    expect(logoutLoss({ dirty: ["a.md"], files: ["a.draw.json"], queued: 0 })).toEqual({ unsaved: ["a.md", "a.draw.json"], queued: 0 });
  });

  it("저장은 다 됐어도 못 보낸 오프라인 저장분이 있으면 묻는다", () => {
    expect(logoutLoss({ dirty: [], files: [], queued: 3 })).toEqual({ unsaved: [], queued: 3 });
  });
});
