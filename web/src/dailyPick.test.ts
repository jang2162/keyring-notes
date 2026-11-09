import { describe, expect, it } from "vitest";
import { dailyTarget } from "./dailyPick";
import { paletteKey } from "./Palette";

const names = ["다", "가", "나"];
const on =
  (...ws: string[]) =>
  (w: string) =>
    ws.includes(w);

describe("데일리 노트를 열 워크스페이스", () => {
  it("한 워크스페이스 보기는 그 워크스페이스(다른 곳에 데일리가 켜져 있어도)", () => {
    expect(dailyTarget({ allWs: false, ws: "가", names, hasDaily: on("가", "나") })).toEqual({ kind: "one", workspace: "가" });
    expect(dailyTarget({ allWs: false, ws: "다", names, hasDaily: on("가", "나") })).toEqual({ kind: "none" });
  });

  it("모든 워크스페이스 보기: 켜진 곳이 하나면 바로 그것", () => {
    expect(dailyTarget({ allWs: true, ws: "다", names, hasDaily: on("나") })).toEqual({ kind: "one", workspace: "나" });
  });

  it("모든 워크스페이스 보기: 둘 이상이면 워크스페이스 순서대로 고르게 한다", () => {
    expect(dailyTarget({ allWs: true, ws: "가", names, hasDaily: on("나", "다") })).toEqual({ kind: "pick", workspaces: ["다", "나"] });
  });

  it("켜진 곳이 없으면 none", () => {
    expect(dailyTarget({ allWs: true, ws: "가", names, hasDaily: on() })).toEqual({ kind: "none" });
  });
});

describe("번호 고르기 목록의 키", () => {
  it("↑↓ 는 끝에서 멈추고 Enter 는 지금 줄", () => {
    expect(paletteKey("ArrowDown", 2, 3, true)).toEqual({ sel: 2 });
    expect(paletteKey("ArrowUp", 0, 3, true)).toEqual({ sel: 0 });
    expect(paletteKey("ArrowDown", 0, 3, true)).toEqual({ sel: 1 });
    expect(paletteKey("Enter", 1, 3, true)).toEqual({ choose: 1 });
  });

  it("숫자는 그 번째를 바로 고른다. 없는 번호·0 은 무시", () => {
    expect(paletteKey("1", 2, 3, true)).toEqual({ choose: 0 });
    expect(paletteKey("3", 0, 3, true)).toEqual({ choose: 2 });
    expect(paletteKey("4", 0, 3, true)).toBeNull();
    expect(paletteKey("0", 0, 3, true)).toBeNull();
  });

  it("번호가 없는 목록(찾기 칸)에서는 숫자를 가져가지 않는다", () => {
    expect(paletteKey("1", 0, 3, false)).toBeNull();
  });
});
