import { describe, expect, it } from "vitest";
import { headingSizes, headingStyle } from "./editorCommands";

const rules = (s: typeof headingStyle) => s.module?.getRules() ?? "";

describe("제목 글자 크기", () => {
  it("두 모드가 함께 거는 headingStyle 에는 크기가 없다 — Live Preview 는 줄 클래스로 크기를 주므로 여기 있으면 배율이 두 번 곱해진다", () => {
    expect(rules(headingStyle)).not.toMatch(/font-size/);
  });

  it("원문 모드 크기는 headingSizes 가 H1~H3 에만 준다", () => {
    expect(rules(headingSizes).match(/font-size:\s*[\d.]+em/g)).toEqual(["font-size: 1.6em", "font-size: 1.35em", "font-size: 1.18em"]);
  });
});
