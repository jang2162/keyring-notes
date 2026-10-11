import { describe, expect, it } from "vitest";
import {
  canSplit,
  closeIn,
  emptyLayout,
  fromTabs,
  isLayout,
  type Layout,
  mergePanes,
  migrateLayouts,
  moveTab,
  openIn,
  removePaths,
  renamePath,
  setActive,
  setMode,
  focusPane,
  panesWith,
  type ViewMode,
} from "./panes";

const one = (tabs: string[], active: string, mode: ViewMode = "edit"): Layout => ({ panes: [{ tabs, active, mode }], focused: 0 });

describe("칸 배치", () => {
  it("fromTabs: 마지막 문서가 탭에 없으면 마지막 탭이 활성", () =>
    expect(fromTabs(["a.md", "b.md"], "z.md", "edit")).toEqual({ panes: [{ tabs: ["a.md", "b.md"], active: "b.md", mode: "edit" }], focused: 0 }));

  it("fromTabs: 마지막 문서가 탭에 있으면 그것이 활성", () =>
    expect(fromTabs(["a.md", "b.md"], "a.md", "preview")).toEqual(one(["a.md", "b.md"], "a.md", "preview")));

  it("fromTabs: 빈 탭은 칸이 없다", () => expect(fromTabs([], null, "edit")).toEqual({ panes: [], focused: 0 }));

  it("migrateLayouts: 범위마다 옮기고, 모양이 틀리면 빈 객체", () => {
    expect(migrateLayouts('{"업무":["업무/a.md"]}', '{"업무":"업무/a.md"}', "edit")).toEqual({
      업무: { panes: [{ tabs: ["업무/a.md"], active: "업무/a.md", mode: "edit" }], focused: 0 },
    });
    expect(migrateLayouts('["a.md"]', null, "edit")).toEqual({});
  });

  it("migrateLayouts: 마지막 문서 기록이 없으면 마지막 탭, 기록 모양이 틀리면 빈 객체", () => {
    expect(migrateLayouts('{"*":["a.md","b.md"]}', null, "edit")).toEqual({ "*": one(["a.md", "b.md"], "b.md") });
    expect(migrateLayouts('{"*":["a.md"]}', '["a.md"]', "edit")).toEqual({});
    expect(migrateLayouts(null, null, "edit")).toEqual({});
    expect(migrateLayouts("{깨짐", null, "edit")).toEqual({});
  });

  it("openIn: 활성 탭을 바꿔치고, newTab 이면 뒤에 붙인다", () => {
    expect(openIn(one(["a", "b"], "a"), 0, "c")).toEqual(one(["c", "b"], "c"));
    expect(openIn(one(["a", "b"], "a"), 0, "c", { newTab: true })).toEqual(one(["a", "b", "c"], "c"));
    expect(openIn(one(["a", "b"], "a"), 0, "b")).toEqual(one(["a", "b"], "b"));
  });

  it("openIn: 빈 배치에 열면 첫 칸을 만든다", () => expect(openIn(emptyLayout(), 0, "a")).toEqual(one(["a"], "a")));

  it("openIn: 둘째 칸을 만들 수 있고 셋째는 못 만든다", () => {
    const l = openIn(one(["a"], "a"), 1, "b");
    expect(l).toEqual({
      panes: [
        { tabs: ["a"], active: "a", mode: "edit" },
        { tabs: ["b"], active: "b", mode: "edit" },
      ],
      focused: 1,
    });
    expect(openIn(l, 2, "c")).toBe(l);
  });

  it("openIn: 새 칸의 보기 모드는 opts.mode, 없으면 첫 칸의 것", () => {
    expect(openIn(one(["a"], "a", "preview"), 1, "b").panes[1].mode).toBe("preview");
    expect(openIn(one(["a"], "a", "preview"), 1, "b", { mode: "split" }).panes[1].mode).toBe("split");
  });

  it("closeIn: 이웃이 활성이 되고, 빈 칸은 사라지며 오른쪽이 왼쪽으로 온다", () => {
    expect(closeIn(one(["a", "b", "c"], "b"), 0, "b")).toEqual(one(["a", "c"], "c"));
    expect(closeIn(one(["a", "b", "c"], "c"), 0, "c")).toEqual(one(["a", "b"], "b"));
    const two = openIn(one(["a"], "a"), 1, "b");
    expect(closeIn(two, 0, "a")).toEqual(one(["b"], "b"));
    expect(closeIn(one(["a"], "a"), 0, "a")).toEqual(emptyLayout());
  });

  it("closeIn: 활성이 아닌 탭을 닫으면 활성은 그대로", () => expect(closeIn(one(["a", "b", "c"], "a"), 0, "c")).toEqual(one(["a", "b"], "a")));

  it("moveTab: 옮기면 원래 칸이 비어 사라져도 대상 인덱스가 맞다", () => {
    const two = openIn(one(["a"], "a"), 1, "b"); // [a] | [b], focused 1
    expect(moveTab(two, 1, 0, "b")).toEqual(one(["a", "b"], "b")); // 둘째가 비어 사라짐
    expect(moveTab(one(["a", "b"], "a"), 0, 1, "a")).toEqual({
      panes: [
        { tabs: ["b"], active: "b", mode: "edit" },
        { tabs: ["a"], active: "a", mode: "edit" },
      ],
      focused: 1,
    });
    expect(moveTab(two, 0, 0, "a")).toBe(two);
  });

  it("moveTab: 같은 칸으로 옮기거나 그 칸에 없는 탭이면 그대로", () => {
    const two = openIn(one(["a", "c"], "a"), 1, "b");
    expect(moveTab(two, 1, 1, "b")).toBe(two);
    expect(moveTab(two, 0, 1, "zz")).toBe(two);
  });

  it("moveTab: 왼쪽 칸의 마지막 탭을 옮기면 왼쪽 칸이 사라지고 focused 는 0", () => {
    const two: Layout = {
      panes: [
        { tabs: ["a"], active: "a", mode: "edit" },
        { tabs: ["b"], active: "b", mode: "preview" },
      ],
      focused: 0,
    };
    expect(moveTab(two, 0, 1, "a")).toEqual({ panes: [{ tabs: ["b", "a"], active: "a", mode: "preview" }], focused: 0 });
  });

  it("moveTab: 오른쪽 칸에 이미 있는 탭을 옮기면 중복 없이 그 탭이 활성", () => {
    const l: Layout = {
      panes: [
        { tabs: ["a", "b"], active: "b", mode: "edit" },
        { tabs: ["b", "c"], active: "c", mode: "edit" },
      ],
      focused: 0,
    };
    expect(moveTab(l, 0, 1, "b")).toEqual({
      panes: [
        { tabs: ["a"], active: "a", mode: "edit" },
        { tabs: ["b", "c"], active: "b", mode: "edit" },
      ],
      focused: 1,
    });
  });

  it("mergePanes: 중복 없이 이어 붙이고 focused 칸의 활성을 지킨다", () => {
    const l: Layout = {
      panes: [
        { tabs: ["a", "b"], active: "a", mode: "edit" },
        { tabs: ["b", "c"], active: "c", mode: "preview" },
      ],
      focused: 1,
    };
    expect(mergePanes(l)).toEqual(one(["a", "b", "c"], "c"));
    expect(mergePanes(one(["a"], "a"))).toEqual(one(["a"], "a"));
  });

  it("removePaths: 사라진 문서를 모든 칸에서 빼고 빈 칸을 없앤다", () => {
    const l: Layout = {
      panes: [
        { tabs: ["a", "x"], active: "x", mode: "edit" },
        { tabs: ["x"], active: "x", mode: "edit" },
      ],
      focused: 1,
    };
    expect(removePaths(l, (p) => p === "x")).toEqual(one(["a"], "a"));
  });

  it("renamePath: 모든 칸의 탭과 활성을 바꾸고, 대상이 이미 탭에 있으면 하나로 줄인다", () => {
    const l: Layout = {
      panes: [
        { tabs: ["a", "b"], active: "a", mode: "edit" },
        { tabs: ["a"], active: "a", mode: "edit" },
      ],
      focused: 0,
    };
    expect(renamePath(l, "a", "z")).toEqual({
      panes: [
        { tabs: ["z", "b"], active: "z", mode: "edit" },
        { tabs: ["z"], active: "z", mode: "edit" },
      ],
      focused: 0,
    });
    expect(renamePath(one(["a", "b"], "a"), "a", "b")).toEqual(one(["b"], "b"));
  });

  it("setActive·setMode·focusPane: 칸 하나만 바꾸고 없는 칸은 그대로", () => {
    const two = openIn(one(["a", "c"], "a"), 1, "b");
    expect(setActive(two, 0, "c").panes[0].active).toBe("c");
    expect(setMode(two, 1, "preview").panes.map((p) => p.mode)).toEqual(["edit", "preview"]);
    expect(focusPane(two, 0).focused).toBe(0);
    expect(focusPane(two, 5)).toBe(two);
    expect(setMode(two, 5, "split")).toBe(two);
  });

  it("panesWith: 그 문서를 탭으로 가진 칸들", () => {
    const l: Layout = {
      panes: [
        { tabs: ["a", "b"], active: "a", mode: "edit" },
        { tabs: ["b"], active: "b", mode: "edit" },
      ],
      focused: 0,
    };
    expect(panesWith(l, "b")).toEqual([0, 1]);
    expect(panesWith(l, "a")).toEqual([0]);
    expect(panesWith(l, "z")).toEqual([]);
  });

  it("isLayout: 모양이 틀리면 false", () => {
    expect(isLayout({ panes: [{ tabs: ["a"], active: "a", mode: "edit" }], focused: 0 })).toBe(true);
    expect(isLayout(emptyLayout())).toBe(true);
    expect(isLayout({ panes: "x" })).toBe(false);
    expect(isLayout({ panes: [{ tabs: ["a"], active: "a", mode: "edit" }], focused: 3 })).toBe(false);
    expect(isLayout({ panes: [{ tabs: ["a"], active: "a", mode: "wide" }], focused: 0 })).toBe(false);
  });

  it("canSplit: 560 미만이거나 좁은 화면이면 false", () => {
    expect(canSplit(560, false)).toBe(true);
    expect(canSplit(559, false)).toBe(false);
    expect(canSplit(1200, true)).toBe(false);
  });
});
