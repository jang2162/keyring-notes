import { describe, expect, it } from "vitest";
import {
  canSplitRect,
  clearActive,
  closeIn,
  dragSizes,
  dropTab,
  dropZone,
  emptyLayout,
  focusPane,
  fromTabs,
  handlesOf,
  isLayout,
  type Layout,
  type LayoutNode,
  mergePanes,
  migrateLayouts,
  migrateLegacyPanes,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  minExtent,
  moveTab,
  neighborOf,
  nextPaneId,
  nodeAt,
  openIn,
  otherPaneOf,
  otherPaneShowing,
  type Pane,
  panesOf,
  panesWith,
  rectsOf,
  removePane,
  removePaths,
  renamePath,
  rightPanelFloats,
  setActive,
  setMode,
  setSizes,
  shownModeOf,
  splitPane,
  type ViewMode,
} from "./panes";

const P = (id: string, tabs: string[], active: string | null = tabs[tabs.length - 1] ?? null, mode: ViewMode = "edit"): Pane => ({ id, tabs, active, mode });
const L = (root: LayoutNode | null, focused: string): Layout => ({ root, focused });
const row = (children: LayoutNode[], sizes = children.map(() => 1 / children.length)): LayoutNode => ({ dir: "row", children, sizes });
const col = (children: LayoutNode[], sizes = children.map(() => 1 / children.length)): LayoutNode => ({ dir: "column", children, sizes });
const one = (tabs: string[], active: string, mode: ViewMode = "edit"): Layout => L(P("p1", tabs, active, mode), "p1");
const ids = (l: Layout) => panesOf(l).map((p) => p.id);

describe("칸 배치: 처음 만들기와 저장값", () => {
  it("fromTabs: 마지막 문서가 탭에 없으면 마지막 탭이 활성, 있으면 그것", () => {
    expect(fromTabs(["a.md", "b.md"], "z.md", "edit")).toEqual(one(["a.md", "b.md"], "b.md"));
    expect(fromTabs(["a.md", "b.md"], "a.md", "preview")).toEqual(one(["a.md", "b.md"], "a.md", "preview"));
    expect(fromTabs([], null, "edit")).toEqual(emptyLayout());
  });

  it("migrateLayouts: 옛 keyring:tabs 를 범위마다 옮기고, 모양이 틀리면 빈 객체", () => {
    expect(migrateLayouts('{"업무":["업무/a.md"]}', '{"업무":"업무/a.md"}', "edit")).toEqual({ 업무: one(["업무/a.md"], "업무/a.md") });
    expect(migrateLayouts('{"*":["a.md","b.md"]}', null, "edit")).toEqual({ "*": one(["a.md", "b.md"], "b.md") });
    expect(migrateLayouts('["a.md"]', null, "edit")).toEqual({});
    expect(migrateLayouts('{"*":["a.md"]}', '["a.md"]', "edit")).toEqual({});
    expect(migrateLayouts(null, null, "edit")).toEqual({});
    expect(migrateLayouts("{깨짐", null, "edit")).toEqual({});
  });

  it("migrateLegacyPanes: 옛 keyring:panes(0~2칸)를 트리로 — 두 칸이면 row 가지, 비율은 옛 splitRatio", () => {
    const raw = JSON.stringify({
      업무: {
        panes: [
          { tabs: ["a", "b"], active: "a", mode: "edit" },
          { tabs: ["c"], active: "c", mode: "preview" },
        ],
        focused: 1,
      },
      "*": { panes: [{ tabs: ["x"], active: "x", mode: "split" }], focused: 0 },
      빈: { panes: [], focused: 0 },
    });
    expect(migrateLegacyPanes(raw, 0.3)).toEqual({
      업무: L(row([P("p1", ["a", "b"], "a"), P("p2", ["c"], "c", "preview")], [0.3, 0.7]), "p2"),
      "*": L(P("p1", ["x"], "x", "split"), "p1"),
    });
    // 옮긴 결과는 새 모양 검사를 통과한다(저장했다 다시 읽어도 버려지지 않는다)
    for (const l of Object.values(migrateLegacyPanes(raw, 0.3)!)) expect(isLayout(l)).toBe(true);
  });

  it("migrateLegacyPanes: 저장값이 없으면 null, 모양이 틀리면 빈 객체, 비율이 범위 밖이면 반반", () => {
    expect(migrateLegacyPanes(null, 0.5)).toBeNull();
    expect(migrateLegacyPanes("{깨짐", 0.5)).toEqual({});
    expect(migrateLegacyPanes('{"*":{"panes":"x","focused":0}}', 0.5)).toEqual({});
    // 세 칸은 옛 모양이 아니다
    const three = { panes: [P("", ["a"]), P("", ["b"]), P("", ["c"])].map(({ tabs, active, mode }) => ({ tabs, active, mode })), focused: 0 };
    expect(migrateLegacyPanes(JSON.stringify({ "*": three }), 0.5)).toEqual({});
    const two = { panes: three.panes.slice(0, 2), focused: 0 };
    const out = migrateLegacyPanes(JSON.stringify({ "*": two }), 7)!;
    expect(out["*"].root).toEqual(row([P("p1", ["a"]), P("p2", ["b"])], [0.5, 0.5]));
  });

  it("isLayout: 새 모양만 받는다", () => {
    expect(isLayout(emptyLayout())).toBe(true);
    expect(isLayout(one(["a"], "a"))).toBe(true);
    expect(isLayout(L(row([P("p1", ["a"]), col([P("p2", ["b"]), P("p3", ["c"])])]), "p3"))).toBe(true);
    // 옛 모양
    expect(isLayout({ panes: [{ tabs: ["a"], active: "a", mode: "edit" }], focused: 0 })).toBe(false);
    // focused 가 없는 칸
    expect(isLayout(L(P("p1", ["a"]), "p9"))).toBe(false);
    expect(isLayout(L(null, "p1"))).toBe(false);
    // 자식 하나짜리 가지, 비율 개수·합이 틀림, id 중복, 보기 모드가 틀림
    expect(isLayout(L(row([P("p1", ["a"])]), "p1"))).toBe(false);
    expect(isLayout(L(row([P("p1", ["a"]), P("p2", ["b"])], [0.5]), "p1"))).toBe(false);
    expect(isLayout(L(row([P("p1", ["a"]), P("p2", ["b"])], [0.5, 0.9]), "p1"))).toBe(false);
    expect(isLayout(L(row([P("p1", ["a"]), P("p2", ["b"])], [1, 0]), "p1"))).toBe(false);
    expect(isLayout(L(row([P("p1", ["a"]), P("p1", ["b"])]), "p1"))).toBe(false);
    expect(isLayout(L({ ...P("p1", ["a"]), mode: "wide" } as unknown as Pane, "p1"))).toBe(false);
    expect(isLayout(L({ dir: "diagonal", children: [P("p1", ["a"]), P("p2", ["b"])], sizes: [0.5, 0.5] } as unknown as LayoutNode, "p1"))).toBe(false);
  });

  it("nextPaneId: 배치 안의 가장 큰 번호 다음", () => {
    expect(nextPaneId(emptyLayout())).toBe("p1");
    expect(nextPaneId(L(row([P("p1", ["a"]), P("p7", ["b"])]), "p1"))).toBe("p8");
  });
});

describe("칸 배치: 탭 열기·닫기", () => {
  it("openIn: 활성 탭을 바꿔치고, newTab 이면 뒤에 붙이고, 이미 있으면 활성만", () => {
    expect(openIn(one(["a", "b"], "a"), "p1", "c")).toEqual(one(["c", "b"], "c"));
    expect(openIn(one(["a", "b"], "a"), "p1", "c", { newTab: true })).toEqual(one(["a", "b", "c"], "c"));
    expect(openIn(one(["a", "b"], "a"), "p1", "b")).toEqual(one(["a", "b"], "b"));
  });

  it("openIn: 빈 배치에 열면 첫 칸을 만들고(보기 모드는 opts.mode), 없는 칸이면 그대로", () => {
    expect(openIn(emptyLayout(), "p1", "a")).toEqual(one(["a"], "a"));
    expect(openIn(emptyLayout(), "", "a", { mode: "preview" })).toEqual(one(["a"], "a", "preview"));
    const l = one(["a"], "a");
    expect(openIn(l, "p9", "b")).toBe(l);
  });

  it("openIn: 다른 칸에 열면 그 칸이 포커스", () => {
    const l = L(row([P("p1", ["a"]), P("p2", ["b"])]), "p1");
    expect(openIn(l, "p2", "c", { newTab: true })).toEqual(L(row([P("p1", ["a"]), P("p2", ["b", "c"])]), "p2"));
  });

  it("closeIn: 이웃이 활성이 되고, 활성이 아닌 탭을 닫으면 활성은 그대로", () => {
    expect(closeIn(one(["a", "b", "c"], "b"), "p1", "b")).toEqual(one(["a", "c"], "c"));
    expect(closeIn(one(["a", "b", "c"], "c"), "p1", "c")).toEqual(one(["a", "b"], "b"));
    expect(closeIn(one(["a", "b", "c"], "a"), "p1", "c")).toEqual(one(["a", "b"], "a"));
    expect(closeIn(one(["a"], "a"), "p1", "a")).toEqual(emptyLayout());
  });

  it("closeIn: 칸이 비면 빠지고, 자식이 하나 남은 가지는 걷혀 남은 칸이 부모에 붙는다", () => {
    // [a | (b / c)] 에서 c 를 닫으면 [a | b]
    const l = L(row([P("p1", ["a"]), col([P("p2", ["b"]), P("p3", ["c"])])], [0.4, 0.6]), "p3");
    expect(closeIn(l, "p3", "c")).toEqual(L(row([P("p1", ["a"]), P("p2", ["b"])], [0.4, 0.6]), "p2"));
    // 루트가 자식 둘인 가지면 남은 칸이 루트가 된다
    const two = L(row([P("p1", ["a"]), P("p2", ["b"])]), "p1");
    expect(closeIn(two, "p1", "a")).toEqual(L(P("p2", ["b"]), "p2"));
    expect(closeIn(two, "p2", "b")).toEqual(L(P("p1", ["a"]), "p1"));
  });

  it("removePane: 가지를 걷을 때 같은 방향이면 부모 가지에 펼쳐 넣는다", () => {
    // [a | (b / [c | d])] 에서 b 를 빼면 (b/[c|d]) 가지가 걷혀 [c|d] 가 남고, 부모와 같은 row 라 [a | c | d] 로 펼친다
    const l = L(row([P("p1", ["a"]), col([P("p2", ["b"]), row([P("p3", ["c"]), P("p4", ["d"])])])], [0.5, 0.5]), "p1");
    expect(removePane(l, "p2")).toEqual(L(row([P("p1", ["a"]), P("p3", ["c"]), P("p4", ["d"])], [0.5, 0.25, 0.25]), "p1"));
  });

  it("removePane: 빠진 칸의 비율은 남은 형제가 비율대로 나눠 갖는다", () => {
    const l = L(row([P("p1", ["a"]), P("p2", ["b"]), P("p3", ["c"])], [0.25, 0.25, 0.5]), "p1");
    const r = removePane(l, "p2").root as { sizes: number[] };
    expect(r.sizes[0]).toBeCloseTo(1 / 3);
    expect(r.sizes[1]).toBeCloseTo(2 / 3);
  });

  it("removePane: 포커스가 빠진 칸이었으면 읽는 순서로 바로 앞 칸(맨 앞이면 다음 칸)", () => {
    const l = L(row([P("p1", ["a"]), P("p2", ["b"]), P("p3", ["c"])]), "p2");
    expect(removePane(l, "p2").focused).toBe("p1");
    expect(removePane({ ...l, focused: "p1" }, "p1").focused).toBe("p2");
    expect(removePane({ ...l, focused: "p3" }, "p1").focused).toBe("p3");
    expect(removePane(l, "p9")).toBe(l);
  });

  it("removePaths: 사라진 문서를 모든 칸에서 빼고 빈 칸을 없앤다", () => {
    const l = L(row([P("p1", ["a", "x"], "x"), P("p2", ["x"])]), "p2");
    expect(removePaths(l, (p) => p === "x")).toEqual(L(P("p1", ["a"], "a"), "p1"));
    expect(removePaths(l, () => false)).toBe(l);
  });

  it("renamePath: 모든 칸의 탭과 활성을 바꾸고, 대상이 이미 탭에 있으면 하나로 줄인다", () => {
    const l = L(row([P("p1", ["a", "b"], "a"), P("p2", ["a"])]), "p1");
    expect(renamePath(l, "a", "z")).toEqual(L(row([P("p1", ["z", "b"], "z"), P("p2", ["z"])]), "p1"));
    expect(renamePath(one(["a", "b"], "a"), "a", "b")).toEqual(one(["b"], "b"));
    expect(renamePath(l, "q", "z")).toBe(l);
  });

  it("setActive·setMode·focusPane: 칸 하나만 바꾸고 없는 칸은 그대로", () => {
    const l = L(row([P("p1", ["a", "c"], "a"), P("p2", ["b"])]), "p2");
    expect(panesOf(setActive(l, "p1", "c"))[0].active).toBe("c");
    expect(panesOf(setMode(l, "p2", "preview")).map((p) => p.mode)).toEqual(["edit", "preview"]);
    expect(focusPane(l, "p1").focused).toBe("p1");
    expect(focusPane(l, "p9")).toBe(l);
    expect(setMode(l, "p9", "split")).toBe(l);
    expect(setActive(l, "p1", "zz")).toBe(l);
    expect(panesOf(clearActive(l, "p2"))[1]).toEqual(P("p2", ["b"], null));
    expect(clearActive(clearActive(l, "p2"), "p2")).toEqual(clearActive(l, "p2"));
  });

  it("panesWith·otherPaneShowing·otherPaneOf", () => {
    const l = L(row([P("p1", ["a", "b"], "a"), col([P("p2", ["a"], "a", "preview"), P("p3", ["b"])])]), "p1");
    expect(panesWith(l, "b")).toEqual(["p1", "p3"]);
    expect(panesWith(l, "z")).toEqual([]);
    expect(otherPaneShowing(l, "p1", "a")).toBe("p2");
    expect(otherPaneShowing(l, "p3", "a")).toBe("p1");
    expect(otherPaneShowing(l, "p1", "b")).toBe("p3");
    // 탭으로만 갖고 보고 있지 않으면 아니다
    expect(otherPaneShowing(l, "p3", "b")).toBeNull();
    expect(otherPaneShowing(one(["a"], "a"), "p1", "a")).toBeNull();
    // 다른 칸: 읽는 순서의 다음 칸(끝이면 처음), 칸이 하나면 없다
    expect(otherPaneOf(l, "p1")).toBe("p2");
    expect(otherPaneOf(l, "p3")).toBe("p1");
    expect(otherPaneOf(one(["a"], "a"), "p1")).toBeNull();
  });

  it("mergePanes: 읽는 순서로 중복 없이 이어 붙이고 포커스 칸의 활성을 지킨다", () => {
    const l = L(row([P("p1", ["a", "b"], "a"), col([P("p2", ["b", "c"], "c", "preview"), P("p3", ["d"])])]), "p2");
    expect(mergePanes(l)).toEqual(L(P("p1", ["a", "b", "c", "d"], "c"), "p1"));
    const s = one(["a"], "a");
    expect(mergePanes(s)).toBe(s);
  });
});

describe("칸 배치: 나누기·옮기기", () => {
  it("splitPane: 다른 축이면 그 칸 자리를 새 가지로 바꾼다(새 칸이 포커스, 보기 모드는 원래 칸의 것)", () => {
    const l = L(P("p1", ["a"], "a", "preview"), "p1");
    expect(splitPane(l, "p1", "right", "a")).toEqual(L(row([P("p1", ["a"], "a", "preview"), P("p2", ["a"], "a", "preview")], [0.5, 0.5]), "p2"));
    expect(splitPane(l, "p1", "top", "b")).toEqual(L(col([P("p2", ["b"], "b", "preview"), P("p1", ["a"], "a", "preview")], [0.5, 0.5]), "p2"));
    // 가지 안의 칸을 다른 축으로 나누면 그 칸만 가지가 된다
    const r = L(row([P("p1", ["a"]), P("p2", ["b"])], [0.3, 0.7]), "p2");
    expect(splitPane(r, "p2", "bottom", "c")).toEqual(L(row([P("p1", ["a"]), col([P("p2", ["b"]), P("p3", ["c"])], [0.5, 0.5])], [0.3, 0.7]), "p3"));
  });

  it("splitPane: 같은 축으로 거듭 나누면 같은 가지에 자식을 더하고 그 칸의 비율을 반으로 나눠 준다", () => {
    const r = L(row([P("p1", ["a"]), P("p2", ["b"])], [0.4, 0.6]), "p2");
    expect(splitPane(r, "p2", "right", "c")).toEqual(L(row([P("p1", ["a"]), P("p2", ["b"]), P("p3", ["c"])], [0.4, 0.3, 0.3]), "p3"));
    expect(splitPane(r, "p1", "left", "c")).toEqual(L(row([P("p3", ["c"]), P("p1", ["a"]), P("p2", ["b"])], [0.2, 0.2, 0.6]), "p3"));
    expect(splitPane(r, "p9", "left", "c")).toBe(r);
    expect(splitPane(r, "p1", "left", "c", "split").focused).toBe("p3");
    expect(panesOf(splitPane(r, "p1", "left", "c", "split"))[0].mode).toBe("split");
  });

  it("moveTab: 다른 칸으로 옮기고, 원래 칸이 비면 빠진다", () => {
    const l = L(row([P("p1", ["a", "b"], "b"), P("p2", ["c"])]), "p1");
    expect(moveTab(l, "p1", "p2", "b")).toEqual(L(row([P("p1", ["a"], "a"), P("p2", ["c", "b"], "b")]), "p2"));
    expect(moveTab(L(row([P("p1", ["a"]), P("p2", ["c"], "c", "preview")]), "p1"), "p1", "p2", "a")).toEqual(L(P("p2", ["c", "a"], "a", "preview"), "p2"));
    // 그 칸에 이미 있으면 중복 없이 그 탭이 활성
    const dup = L(row([P("p1", ["a", "b"], "b"), P("p2", ["b", "c"], "c")]), "p1");
    expect(moveTab(dup, "p1", "p2", "b")).toEqual(L(row([P("p1", ["a"], "a"), P("p2", ["b", "c"], "b")]), "p2"));
    expect(moveTab(l, "p1", "p1", "a")).toBe(l);
    expect(moveTab(l, "p1", "p2", "zz")).toBe(l);
    expect(moveTab(l, "p1", "p9", "a")).toBe(l);
  });

  it("dropTab: 가운데에 놓으면 그 칸의 탭으로, 가장자리에 놓으면 그쪽에 새 칸", () => {
    const l = L(row([P("p1", ["a", "b"], "b"), P("p2", ["c"])]), "p1");
    expect(dropTab(l, "p1", "b", "p2", "center")).toEqual(moveTab(l, "p1", "p2", "b"));
    expect(dropTab(l, "p1", "b", "p2", "bottom")).toEqual(L(row([P("p1", ["a"], "a"), col([P("p2", ["c"]), P("p3", ["b"])], [0.5, 0.5])]), "p3"));
    // 같은 칸의 가장자리: 탭이 둘 이상이면 나누고, 하나뿐이면 그대로
    expect(dropTab(l, "p1", "b", "p1", "left")).toEqual(L(row([P("p3", ["b"]), P("p1", ["a"], "a"), P("p2", ["c"])], [0.25, 0.25, 0.5]), "p3"));
    expect(dropTab(l, "p2", "c", "p2", "right")).toBe(l);
    expect(dropTab(l, "p1", "b", "p1", "center")).toBe(l);
  });

  it("dropTab: 원래 칸의 마지막 탭을 다른 칸 가장자리로 옮기면 원래 칸이 빠지고 가지가 걷힌다", () => {
    const l = L(row([P("p1", ["a"]), P("p2", ["c"])]), "p1");
    expect(dropTab(l, "p1", "a", "p2", "top")).toEqual(L(col([P("p3", ["a"]), P("p2", ["c"])], [0.5, 0.5]), "p3"));
  });
});

describe("칸 배치: 위치·크기", () => {
  // [a | (b / c)] 왼쪽 0.4
  const tree = L(row([P("p1", ["a"]), col([P("p2", ["b"]), P("p3", ["c"])], [0.5, 0.5])], [0.4, 0.6]), "p1");

  it("rectsOf: 비율로 단위 사각형을 나눈다", () => {
    const r = rectsOf(tree);
    expect(r.p1).toEqual({ x: 0, y: 0, w: 0.4, h: 1 });
    expect(r.p2).toEqual({ x: 0.4, y: 0, w: 0.6, h: 0.5 });
    expect(r.p3).toEqual({ x: 0.4, y: 0.5, w: 0.6, h: 0.5 });
  });

  it("handlesOf: 가지마다 이웃한 자식 사이에 하나씩, 그 가지의 사각형과 경계 자리", () => {
    expect(handlesOf(tree)).toEqual([
      { at: [], i: 0, dir: "row", rect: { x: 0, y: 0, w: 1, h: 1 }, pos: 0.4 },
      { at: [1], i: 0, dir: "column", rect: { x: 0.4, y: 0, w: 0.6, h: 1 }, pos: 0.5 },
    ]);
    expect(handlesOf(one(["a"], "a"))).toEqual([]);
    expect(handlesOf(L(row([P("p1", ["a"]), P("p2", ["b"]), P("p3", ["c"])], [0.25, 0.25, 0.5]), "p1")).map((h) => h.pos)).toEqual([0.25, 0.5]);
  });

  it("neighborOf: 그 방향으로 맞닿은 칸, 여럿이면 지금 칸의 가운데 줄을 품는 칸", () => {
    expect(neighborOf(tree, "p1", "right")).toBe("p2");
    expect(neighborOf(tree, "p3", "left")).toBe("p1");
    expect(neighborOf(tree, "p2", "bottom")).toBe("p3");
    expect(neighborOf(tree, "p3", "top")).toBe("p2");
    expect(neighborOf(tree, "p1", "left")).toBeNull();
    expect(neighborOf(tree, "p2", "top")).toBeNull();
    // [(a / b) | c] 에서 c 의 왼쪽은 a·b 둘 다 맞닿는다 — c 의 가운데 줄(0.5)을 품는 b
    const t2 = L(row([col([P("p1", ["a"]), P("p2", ["b"])], [0.3, 0.7]), P("p3", ["c"])]), "p3");
    expect(neighborOf(t2, "p3", "left")).toBe("p2");
    expect(neighborOf(one(["a"], "a"), "p1", "right")).toBeNull();
  });

  it("minExtent: 같은 방향 가지는 자식의 합, 다른 방향은 가장 큰 자식", () => {
    expect(minExtent(P("p1", ["a"]), "row")).toBe(MIN_PANE_WIDTH);
    expect(minExtent(P("p1", ["a"]), "column")).toBe(MIN_PANE_HEIGHT);
    expect(minExtent(tree.root!, "row")).toBe(MIN_PANE_WIDTH * 2);
    expect(minExtent(tree.root!, "column")).toBe(MIN_PANE_HEIGHT * 2);
  });

  it("nodeAt: 자식 번호를 따라 내려간다", () => {
    expect(nodeAt(tree.root!, [])).toBe(tree.root);
    expect(nodeAt(tree.root!, [1, 1])).toEqual(P("p3", ["c"]));
    expect(nodeAt(tree.root!, [0, 5])).toEqual(P("p1", ["a"]));
  });

  it("setSizes: 가리킨 가지의 비율만 바꾸고, 개수가 틀리거나 가지가 아니면 그대로", () => {
    const next = setSizes(tree, [1], [0.25, 0.75]);
    expect((next.root as { children: { sizes: number[] }[] }).children[1].sizes).toEqual([0.25, 0.75]);
    expect(setSizes(tree, [], [0.5, 0.5]).root).toMatchObject({ sizes: [0.5, 0.5] });
    expect(setSizes(tree, [0], [0.5, 0.5])).toBe(tree);
    expect(setSizes(tree, [1], [1])).toBe(tree);
  });

  it("dragSizes: 이웃한 두 자식의 합을 지키며 각자 최소를 넘지 않게", () => {
    const near = (got: number[], want: number[]) => {
      expect(got.length).toBe(want.length);
      got.forEach((g, i) => expect(g).toBeCloseTo(want[i]));
    };
    near(dragSizes([0.5, 0.5], 0, 0.1, 0.2, 0.2), [0.6, 0.4]);
    near(dragSizes([0.5, 0.5], 0, 0.5, 0.2, 0.2), [0.8, 0.2]);
    near(dragSizes([0.5, 0.5], 0, -0.5, 0.2, 0.2), [0.2, 0.8]);
    // 셋째는 그대로
    near(dragSizes([0.25, 0.25, 0.5], 1, 0.1, 0.1, 0.1), [0.25, 0.35, 0.4]);
    // 둘 다 최소보다 작아 자리가 없으면 그대로
    const s = [0.5, 0.5];
    expect(dragSizes(s, 0, 0.1, 0.6, 0.6)).toBe(s);
  });

  it("canSplitRect: 나눈 절반이 최소보다 작아지면 나누지 않고, 좁은 화면이면 늘 아니다", () => {
    expect(canSplitRect(MIN_PANE_WIDTH * 2, 100, "right", false)).toBe(true);
    expect(canSplitRect(MIN_PANE_WIDTH * 2 - 1, 2000, "left", false)).toBe(false);
    expect(canSplitRect(100, MIN_PANE_HEIGHT * 2, "bottom", false)).toBe(true);
    expect(canSplitRect(2000, MIN_PANE_HEIGHT * 2 - 1, "top", false)).toBe(false);
    expect(canSplitRect(4000, 4000, "right", true)).toBe(false);
  });

  it("dropZone: 가장 가까운 가장자리가 1/4 안이면 그 가장자리, 아니면 가운데. 막힌 가장자리는 가운데", () => {
    const all = () => true;
    expect(dropZone(10, 200, 400, 400, all)).toBe("left");
    expect(dropZone(390, 200, 400, 400, all)).toBe("right");
    expect(dropZone(200, 5, 400, 400, all)).toBe("top");
    expect(dropZone(200, 395, 400, 400, all)).toBe("bottom");
    expect(dropZone(200, 200, 400, 400, all)).toBe("center");
    expect(dropZone(10, 200, 400, 400, (s) => s !== "left")).toBe("center");
    // 왼쪽 위 모서리: 더 가까운 쪽
    expect(dropZone(30, 10, 400, 400, all)).toBe("top");
    expect(dropZone(30, 10, 400, 400, (s) => s !== "top")).toBe("left");
    expect(dropZone(0, 0, 0, 0, all)).toBe("center");
  });

  it("ids: 읽는 순서는 위에서 아래, 왼쪽에서 오른쪽(트리의 깊이 우선)", () => expect(ids(tree)).toEqual(["p1", "p2", "p3"]));
});

describe("칸 배치: 화면 폭", () => {
  it("rightPanelFloats: 다 붙이면 가운데가 440 보다 좁아질 때만 띄운다", () => {
    // 기본 폭(레일 44·왼쪽 260·오른쪽 280)이면 1024 는 붙이고, 900 은 가운데가 316 이라 띄운다
    expect(rightPanelFloats(1024, { rail: 44, left: 260, right: 280 })).toBe(false);
    expect(rightPanelFloats(900, { rail: 44, left: 260, right: 280 })).toBe(true);
    // 경계: 가운데가 정확히 440 이면 붙인다
    expect(rightPanelFloats(44 + 260 + 280 + 440, { rail: 44, left: 260, right: 280 })).toBe(false);
    expect(rightPanelFloats(44 + 260 + 280 + 439, { rail: 44, left: 260, right: 280 })).toBe(true);
    // 왼쪽 패널을 닫으면 그만큼 자리가 난다
    expect(rightPanelFloats(900, { rail: 44, left: 0, right: 280 })).toBe(false);
  });

  it("shownModeOf: 좁은 화면의 나란히 보기는 편집으로, 과거 판은 늘 미리보기", () => {
    expect(shownModeOf("split", { revision: false, narrow: true })).toBe("edit");
    expect(shownModeOf("split", { revision: false, narrow: false })).toBe("split");
    expect(shownModeOf("preview", { revision: false, narrow: true })).toBe("preview");
    expect(shownModeOf("edit", { revision: true, narrow: true })).toBe("preview");
  });
});
