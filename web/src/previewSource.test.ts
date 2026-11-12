import { describe, expect, it } from "vitest";
import { previewPlan, previewStep, type PreviewPlan, type PreviewState } from "./previewSource";

/** 렌더를 차례로 돌린다: [계획, 문서, 본문] 마다 그린 본문(null = 안 그림)과 나중에 다시 그려야 하는가 */
function run(steps: [PreviewPlan, string, string][], start: PreviewState = { plan: "skip", key: "a", text: "" }) {
  let st = start;
  return steps.map(([plan, key, source]) => {
    const r = previewStep(st, plan, key, source);
    st = r.state;
    return [r.text, r.settleLater] as const;
  });
}

describe("미리보기 계획", () => {
  it("편집만 보이면 그리지 않고, 나란히 보기는 멈춘 뒤, 미리보기·과거 판은 바로", () => {
    expect(previewPlan("edit", false)).toBe("skip");
    expect(previewPlan("split", false)).toBe("settle");
    expect(previewPlan("preview", false)).toBe("now");
    expect(previewPlan("edit", true)).toBe("now");
    expect(previewPlan("split", true)).toBe("now");
  });
});

describe("previewStep", () => {
  it("편집 전용 칸은 본문이 바뀌어도 그리지 않는다", () => {
    expect(
      run([
        ["skip", "a", "1"],
        ["skip", "a", "12"],
        ["skip", "a", "123"],
      ]),
    ).toEqual([
      [null, false],
      [null, false],
      [null, false],
    ]);
  });

  it("편집 → 나란히·미리보기로 바꾼 직후는 최신 본문을 바로 그린다", () => {
    expect(
      run([
        ["skip", "a", "1"],
        ["skip", "a", "12"],
        ["settle", "a", "12"],
      ]),
    ).toEqual([
      [null, false],
      [null, false],
      ["12", false],
    ]);
    expect(
      run([
        ["skip", "a", "12"],
        ["now", "a", "12"],
      ]),
    ).toEqual([
      [null, false],
      ["12", false],
    ]);
  });

  it("나란히 보기: 치는 동안은 그린 본문을 두고 다시 그릴 일만 남긴다, 멈추면(같은 본문) 남길 일이 없다", () => {
    const start: PreviewState = { plan: "settle", key: "a", text: "1" };
    expect(
      run(
        [
          ["settle", "a", "12"],
          ["settle", "a", "123"],
        ],
        start,
      ),
    ).toEqual([
      ["1", true],
      ["1", true],
    ]);
    expect(run([["settle", "a", "1"]], start)).toEqual([["1", false]]);
  });

  it("나란히 보기에서 다른 문서(키)가 오면 기다리지 않는다", () => {
    expect(run([["settle", "b", "다른 문서"]], { plan: "settle", key: "a", text: "옛" })).toEqual([["다른 문서", false]]);
  });

  it("나란히 → 편집 → 나란히: 그 사이 바뀐 본문을 바로 그린다", () => {
    expect(
      run([
        ["settle", "a", "1"],
        ["skip", "a", "12"],
        ["skip", "a", "123"],
        ["settle", "a", "123"],
      ]),
    ).toEqual([
      ["1", false],
      [null, false],
      [null, false],
      ["123", false],
    ]);
  });

  it("미리보기만 보이는 칸은 늘 지금 본문", () => {
    expect(
      run([
        ["now", "a", "1"],
        ["now", "a", "12"],
      ]),
    ).toEqual([
      ["1", false],
      ["12", false],
    ]);
  });
});
