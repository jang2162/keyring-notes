import { describe, expect, it } from "vitest";
import type { Resume } from "./mount";
import { resumePlan } from "./refresh";

const resume = (stateFrom: number, entryKey = "@me/c@1.0.0#a"): Resume => ({ draft: { n: 1 }, base: { n: 1 }, focus: null, stateFrom, entryKey });

describe("resumePlan — 다시 붙는 위젯이 필드의 수정을 이어받는가", () => {
  it("이어받을 것이 없으면 none", () => {
    expect(resumePlan(null, { kind: "widget", version: 1 })).toBe("none");
    expect(resumePlan(null, { kind: "error" })).toBe("none");
  });

  it("지금 판정이 위젯이고 판이 초안의 판 이상이면 resume — 항목 키는 보지 않는다", () => {
    expect(resumePlan(resume(1), { kind: "widget", version: 1 })).toBe("resume");
    expect(resumePlan(resume(1, "@me/c@0.9.0#z"), { kind: "widget", version: 2 })).toBe("resume");
  });

  it("판이 초안보다 낮거나 지금 오류면 hold(쓰지도 끝내지도 않는다 — 사용자 결정 2026-11-11)", () => {
    expect(resumePlan(resume(2), { kind: "widget", version: 1 })).toBe("hold");
    expect(resumePlan(resume(1), { kind: "error" })).toBe("hold");
  });
});
