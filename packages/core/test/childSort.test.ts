import { describe, expect, it } from "vitest";
import { parseChildSort, planReorder, seedRanks, sortChildren, type VaultNode } from "../src/index.js";

/** 노트 노드(rank·edited 는 선택). folder: 노트 없는 폴더 노드 */
function node(name: string, extra: Partial<VaultNode> & { folder?: boolean } = {}): VaultNode {
  const { folder, ...rest } = extra;
  return { name, path: `ws/${name}`, note: folder ? null : `ws/${name}.md`, dir: !!folder, children: [], attachments: [], ...rest };
}

const names = (ns: VaultNode[]) => ns.map((n) => n.name);
const none = () => undefined;

/** 결과를 노드에 적용한 새 목록 */
function applied(nodes: VaultNode[], plan: { node: string; rank: string }[]): VaultNode[] {
  const by = new Map(plan.map((p) => [p.node, p.rank]));
  return nodes.map((n) => (by.has(n.path) ? { ...n, rank: by.get(n.path) } : n));
}

/** 같은 원소를 섞은 목록(시험마다 같은 순서) */
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 48271) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("sortChildren", () => {
  it("custom: rank 오름차순, 그 뒤 rank 없는 노트를 이름순", () => {
    const list = [node("나"), node("B", { rank: "a1" }), node("가"), node("A", { rank: "a0" })];
    expect(names(sortChildren(list, "custom", none))).toEqual(["A", "B", "가", "나"]);
  });

  it("custom: rank 끼리는 글자 코드로 비교한다(대문자가 소문자보다 앞)", () => {
    const list = [node("x", { rank: "a" }), node("y", { rank: "Z" })];
    expect(names(sortChildren(list, "custom", none))).toEqual(["y", "x"]);
  });

  it("같은 rank 둘은 이름순이고, 입력 순서를 섞어 10번 불러도 같다", () => {
    const list = [node("다", { rank: "V" }), node("가", { rank: "V" }), node("나", { rank: "U" }), node("라")];
    for (let i = 1; i <= 10; i++) expect(names(sortChildren(shuffled(list, i), "custom", none))).toEqual(["나", "가", "다", "라"]);
  });

  it("modified: edited 가 큰 것이 위, 시각 없는(노트 없는 폴더) 노드는 맨 뒤 이름순", () => {
    const list = [
      node("가", { edited: 100 }),
      node("폴더2", { folder: true }),
      node("나", { edited: 300 }),
      node("폴더1", { folder: true }),
      node("다", { edited: 200 }),
    ];
    expect(names(sortChildren(list, "modified", none))).toEqual(["나", "다", "가", "폴더1", "폴더2"]);
  });

  it("modified: 시각이 같으면 이름순", () => {
    expect(names(sortChildren([node("나", { edited: 5 }), node("가", { edited: 5 })], "modified", none))).toEqual(["가", "나"]);
  });

  it("viewed: 최근에 연 것이 위, 연 적 없는 노트는 뒤에 이름순", () => {
    const seen: Record<string, number> = { "ws/다.md": 10, "ws/나.md": 30 };
    const list = [node("라"), node("다"), node("가"), node("나"), node("폴더", { folder: true })];
    expect(names(sortChildren(list, "viewed", (p) => seen[p]))).toEqual(["나", "다", "가", "라", "폴더"]);
  });

  it("null·name 은 받은 순서(이미 이름순)를 그대로 두고 새 배열을 돌려준다", () => {
    const list = [node("나", { rank: "a" }), node("가", { rank: "b" })];
    for (const s of [null, "name"] as const) {
      const out = sortChildren(list, s, none);
      expect(names(out)).toEqual(["나", "가"]);
      expect(out).not.toBe(list);
    }
  });
});

describe("parseChildSort", () => {
  it("네 값만 받고 나머지(대소문자 다름·목록·숫자)는 null", () => {
    expect(parseChildSort("viewed")).toBe("viewed");
    expect(parseChildSort("name")).toBe("name");
    expect(parseChildSort("modified")).toBe("modified");
    expect(parseChildSort("custom")).toBe("custom");
    expect(parseChildSort("Custom")).toBeNull();
    expect(parseChildSort(["custom"])).toBeNull();
    expect(parseChildSort(3)).toBeNull();
    expect(parseChildSort(undefined)).toBeNull();
  });
});

describe("seedRanks", () => {
  it("노트가 있는 하위에만 지금 순서대로 오름차순 rank", () => {
    const list = [node("가"), node("나"), node("폴더", { folder: true }), node("다")];
    const out = seedRanks(list);
    expect(out.map((o) => o.note)).toEqual(["ws/가.md", "ws/나.md", "ws/다.md"]);
    expect(out.every((o, i) => i === 0 || out[i - 1].rank < o.rank)).toBe(true);
  });

  it("rank 가 하나라도 있으면 아무것도 적지 않는다", () => {
    expect(seedRanks([node("가"), node("나", { rank: "V" })])).toEqual([]);
  });

  it("하위가 많아도 키가 짧다", () => {
    const list = Array.from({ length: 500 }, (_, i) => node(`n${String(i).padStart(3, "0")}`));
    const out = seedRanks(list);
    expect(out).toHaveLength(500);
    expect(Math.max(...out.map((o) => o.rank.length))).toBeLessThanOrEqual(4);
    expect(
      names(
        sortChildren(
          applied(
            list,
            out.map((o) => ({ node: o.note.replace(/\.md$/, ""), rank: o.rank })),
          ),
          "custom",
          none,
        ),
      ),
    ).toEqual(names(list));
  });
});

describe("planReorder", () => {
  it("rank 있는 [A,B,C] 에서 C 를 A 앞으로 → C 하나만, C < A", () => {
    const list = [node("A", { rank: "a" }), node("B", { rank: "b" }), node("C", { rank: "c" })];
    const plan = planReorder(list, "ws/C", "ws/A");
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ node: "ws/C", note: "ws/C.md" });
    expect(plan[0].rank < "a").toBe(true);
    expect(names(sortChildren(applied(list, plan), "custom", none))).toEqual(["C", "A", "B"]);
  });

  it("rank 있는 [A,B] + 없는 [x,y] 에서 y 를 B 와 x 사이로 → A,B,y,x", () => {
    const list = [node("A", { rank: "a" }), node("B", { rank: "b" }), node("x"), node("y")];
    const plan = planReorder(list, "ws/y", "ws/x");
    expect(plan.map((p) => p.node)).toEqual(["ws/y"]);
    expect(names(sortChildren(applied(list, plan), "custom", none))).toEqual(["A", "B", "y", "x"]);
  });

  it("rank 없는 노트들 사이로 옮기면 그 자리까지의 rank 없는 노트에도 rank 를 매긴다", () => {
    const list = [node("A", { rank: "a" }), node("w"), node("x"), node("y"), node("z")];
    const plan = planReorder(list, "ws/A", "ws/y");
    expect(plan.map((p) => p.node)).toEqual(["ws/w", "ws/x", "ws/A"]);
    expect(names(sortChildren(applied(list, plan), "custom", none))).toEqual(["w", "x", "A", "y", "z"]);
  });

  it("맨 뒤로(beforePath null) 옮기면 rank 없는 노트까지 매긴다", () => {
    const list = [node("A", { rank: "a" }), node("B", { rank: "b" }), node("x")];
    const plan = planReorder(list, "ws/A", null);
    expect(plan.map((p) => p.node)).toEqual(["ws/x", "ws/A"]);
    expect(names(sortChildren(applied(list, plan), "custom", none))).toEqual(["B", "x", "A"]);
  });

  it("노트 없는 폴더 노드는 note 가 null 인 항목으로 돌려준다", () => {
    const list = [node("A", { rank: "a" }), node("폴더", { folder: true })];
    const plan = planReorder(list, "ws/폴더", "ws/A");
    expect(plan).toEqual([{ node: "ws/폴더", note: null, rank: plan[0].rank }]);
    expect(plan[0].rank < "a").toBe(true);
  });

  it("같은 rank 둘 사이로 넣으면 뒤쪽 동점 노트도 다시 매겨 그 순서가 된다", () => {
    const list = [node("A", { rank: "V" }), node("B", { rank: "V" }), node("C", { rank: "W" }), node("D", { rank: "X" })];
    const plan = planReorder(list, "ws/D", "ws/B");
    expect(plan.map((p) => p.node).sort()).toEqual(["ws/B", "ws/D"]);
    expect(names(sortChildren(applied(list, plan), "custom", none))).toEqual(["A", "D", "B", "C"]);
  });

  it("손으로 쓴 a 와 a0 사이처럼 키를 만들 수 없으면 뒤쪽 노드도 다시 매긴다", () => {
    const list = [node("A", { rank: "a" }), node("B", { rank: "a0" }), node("C", { rank: "b" })];
    const plan = planReorder(list, "ws/C", "ws/B");
    expect(plan.map((p) => p.node).sort()).toEqual(["ws/B", "ws/C"]);
    expect(names(sortChildren(applied(list, plan), "custom", none))).toEqual(["A", "C", "B"]);
  });

  it("자리가 그대로면 아무것도 적지 않는다", () => {
    const list = [node("A", { rank: "a" }), node("B", { rank: "b" }), node("x")];
    expect(planReorder(list, "ws/A", "ws/B")).toEqual([]);
    expect(planReorder(list, "ws/x", null)).toEqual([]);
  });

  it("어떤 순서에서 어디로 옮겨도 결과가 그 순서가 된다", () => {
    const base = [
      node("A", { rank: "V" }),
      node("B", { rank: "V" }),
      node("C", { rank: "k" }),
      node("D", { rank: "k0" }),
      node("E", { rank: "0" }),
      node("f"),
      node("g"),
      node("폴더", { folder: true }),
    ];
    let list = sortChildren(base, "custom", none);
    let seed = 3;
    for (let i = 0; i < 200; i++) {
      seed = (seed * 48271) % 2147483647;
      const moving = list[seed % list.length].path;
      const rest = list.filter((n) => n.path !== moving);
      const at = (seed >> 3) % (rest.length + 1);
      const before = rest[at]?.path ?? null;
      const want = [...rest.slice(0, at).map((n) => n.name), moving.slice(3), ...rest.slice(at).map((n) => n.name)];
      list = sortChildren(applied(list, planReorder(list, moving, before)), "custom", none);
      expect(names(list)).toEqual(want);
    }
  });
});
