import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetViewed, markViewed, renameViewed, VIEWED_KEY, viewedAt } from "./viewed";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("조회 기록(keyring:viewed)", () => {
  it("연 시각을 남기고 다시 열면 새 시각으로 바꾼다", () => {
    expect(viewedAt("W/a.md")).toBeUndefined();
    markViewed("W/a.md", 100);
    markViewed("W/b.md", 200);
    expect(viewedAt("W/a.md")).toBe(100);
    markViewed("W/a.md", 300);
    expect(viewedAt("W/a.md")).toBe(300);
    expect(JSON.parse(store.get(VIEWED_KEY)!)).toEqual({ "W/a.md": 300, "W/b.md": 200 });
  });

  it("개수를 자르지 않는다(최근 문서의 30개와 다르다)", () => {
    for (let i = 0; i < 100; i++) markViewed(`W/n${i}.md`, i + 1);
    expect(viewedAt("W/n0.md")).toBe(1);
    expect(Object.keys(JSON.parse(store.get(VIEWED_KEY)!))).toHaveLength(100);
  });

  it("다른 창이 저장한 기록 위에 더한다(덮어쓰지 않는다)", () => {
    markViewed("W/a.md", 1);
    store.set(VIEWED_KEY, JSON.stringify({ "W/a.md": 1, "W/다른 창.md": 2 }));
    markViewed("W/b.md", 3);
    expect(viewedAt("W/다른 창.md")).toBe(2);
    expect(viewedAt("W/b.md")).toBe(3);
  });

  it("노드 이동은 노트와 그 하위 노트의 기록을 함께 옮긴다", () => {
    markViewed("업무/A.md", 1);
    markViewed("업무/A/b.md", 2);
    markViewed("업무/A/b/c.md", 3);
    markViewed("업무/AB.md", 4);
    renameViewed("업무/A.md", "개인/A.md");
    expect(JSON.parse(store.get(VIEWED_KEY)!)).toEqual({ "개인/A.md": 1, "개인/A/b.md": 2, "개인/A/b/c.md": 3, "업무/AB.md": 4 });
  });

  it("노트 파일 하나만 옮기면 하위는 그 자리에 남는다", () => {
    markViewed("업무/A.md", 1);
    markViewed("업무/A/b.md", 2);
    renameViewed("업무/A.md", "업무/C.md", false);
    expect(viewedAt("업무/C.md")).toBe(1);
    expect(viewedAt("업무/A/b.md")).toBe(2);
    expect(viewedAt("업무/A.md")).toBeUndefined();
  });

  it("옮긴 자리에 기록이 이미 있으면 더 최근 것을 남긴다", () => {
    markViewed("W/a.md", 5);
    markViewed("W/b.md", 9);
    renameViewed("W/a.md", "W/b.md");
    expect(viewedAt("W/b.md")).toBe(9);
    expect(viewedAt("W/a.md")).toBeUndefined();
  });

  it("지운 노트의 기록을 치운다", () => {
    markViewed("W/a.md", 1);
    markViewed("W/a/b.md", 2);
    markViewed("W/c.md", 3);
    forgetViewed((p) => p === "W/a.md" || p.startsWith("W/a/"));
    expect(JSON.parse(store.get(VIEWED_KEY)!)).toEqual({ "W/c.md": 3 });
  });

  it("모양이 틀린 저장값은 빈 기록으로 본다", () => {
    store.set(VIEWED_KEY, JSON.stringify(["W/a.md"]));
    expect(viewedAt("W/a.md")).toBeUndefined();
    store.set(VIEWED_KEY, JSON.stringify({ "W/a.md": "어제" }));
    expect(viewedAt("W/a.md")).toBeUndefined();
    store.set(VIEWED_KEY, "{깨짐");
    expect(viewedAt("W/a.md")).toBeUndefined();
  });

  it("localStorage 가 던져도 오류 없이 기록이 없다고 본다", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => markViewed("W/a.md", 1)).not.toThrow();
    expect(() => renameViewed("W/a.md", "W/b.md")).not.toThrow();
    expect(() => forgetViewed(() => true)).not.toThrow();
    expect(viewedAt("W/a.md")).toBeUndefined();
  });

  it("localStorage 가 아예 없어도 오류가 없다", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => markViewed("W/a.md", 1)).not.toThrow();
    expect(viewedAt("W/a.md")).toBeUndefined();
  });
});
