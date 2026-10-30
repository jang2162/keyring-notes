import { describe, expect, it } from "vitest";
import { parseRank, PathError, rankBetween, rankFits } from "../src/index.js";

/** 시험이 매번 같은 수열을 쓰게 하는 작은 난수 */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const ascending = (list: string[]) => list.every((k, i) => i === 0 || list[i - 1] < k);

describe("rankBetween", () => {
  it("열린 두 끝 사이에는 비어 있지 않은 키", () => {
    const k = rankBetween(null, null);
    expect(k.length).toBeGreaterThan(0);
    expect(k).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("아무 자리에나 1000번 넣어도 목록이 늘 엄격히 오름차순", () => {
    const rand = rng(7);
    const list: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const at = Math.floor(rand() * (list.length + 1));
      const k = rankBetween(list[at - 1] ?? null, list[at] ?? null);
      expect(k).toMatch(/^[0-9A-Za-z]+$/);
      list.splice(at, 0, k);
      expect(ascending(list)).toBe(true);
    }
  });

  it("맨 앞에 200번 연달아 넣어도 키가 40자를 넘지 않는다", () => {
    let first: string | null = null;
    const list: string[] = [];
    for (let i = 0; i < 200; i++) {
      first = rankBetween(null, first);
      list.unshift(first);
      expect(first.length).toBeLessThanOrEqual(40);
    }
    expect(ascending(list)).toBe(true);
  });

  it("맨 뒤에 200번 연달아 넣어도 키가 40자를 넘지 않는다", () => {
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      const next = rankBetween(last, null);
      if (last !== null) expect(last < next).toBe(true);
      last = next;
      expect(last.length).toBeLessThanOrEqual(40);
    }
  });

  it("같은 두 이웃 사이에 200번 연달아 넣어도 키가 40자를 넘지 않는다", () => {
    const a = rankBetween(null, null);
    let b = rankBetween(a, null);
    for (let i = 0; i < 200; i++) {
      b = rankBetween(a, b);
      expect(a < b).toBe(true);
      expect(b.length).toBeLessThanOrEqual(40);
    }
  });

  it("순서가 거꾸로이거나 같거나 사이에 글자가 없으면 rank_order", () => {
    for (const [a, b] of [
      ["b", "a"],
      ["a", "a"],
      ["a", "a0"],
      ["a", "a00"],
      [null, "00"],
    ]) {
      let err: unknown;
      try {
        rankBetween(a as string | null, b);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PathError);
      expect((err as PathError).code).toBe("rank_order");
    }
  });

  it("0 으로 끝나는 손으로 쓴 키도 이웃으로 받는다", () => {
    for (const [a, b] of [
      ["a0", "a1"],
      ["a1", "b0"],
      [null, "b0"],
      ["a00", null],
      ["a0", "a01"],
    ] as [string | null, string | null][]) {
      const r = rankBetween(a, b);
      expect(r).not.toMatch(/0$/);
      if (a !== null) expect(a < r).toBe(true);
      if (b !== null) expect(r < b).toBe(true);
    }
    expect(rankFits("a", "a0")).toBe(false);
    expect(rankFits("a", "a01")).toBe(true);
    expect(rankFits(null, "0")).toBe(false);
    expect(rankFits("a", null)).toBe(true);
  });

  it("키 모양이 아닌 값은 rank_invalid", () => {
    for (const [a, b] of [
      ["a-", null],
      [null, "가"],
      ["", null],
    ]) {
      let err: unknown;
      try {
        rankBetween(a, b);
      } catch (e) {
        err = e;
      }
      expect((err as PathError).code).toBe("rank_invalid");
    }
  });
});

describe("parseRank", () => {
  it("키 모양의 글자만 받는다", () => {
    expect(parseRank("a1")).toBe("a1");
    expect(parseRank("a0")).toBe("a0");
    expect(parseRank("")).toBeNull();
    expect(parseRank(3)).toBeNull();
    expect(parseRank(["a"])).toBeNull();
    expect(parseRank("a b")).toBeNull();
  });
});
