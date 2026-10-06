import { describe, expect, it } from "vitest";
import { parseFieldInput, parseFrontmatter, setFrontmatterField } from "../src/index.js";

describe("프런트매터 필드 고치기", () => {
  it("한 필드만 바꾸고 주석·순서·본문은 그대로", () => {
    const doc = "---\ntitle: 계획 # 제목\nstatus: 진행\ntags: [a, b]\n---\n# 본문\n";
    const out = setFrontmatterField(doc, "status", "완료");
    expect(out).toBe("---\ntitle: 계획 # 제목\nstatus: 완료\ntags: [a, b]\n---\n# 본문\n");
    expect(parseFrontmatter(out).data).toEqual({ title: "계획", status: "완료", tags: ["a", "b"] });
    expect(out.endsWith("---\n# 본문\n")).toBe(true);
  });
  it("없는 필드는 끝에 더하고, null이면 지운다", () => {
    const doc = "---\ntitle: x\n---\n본문";
    expect(setFrontmatterField(doc, "due", "2026-10-10")).toBe("---\ntitle: x\ndue: 2026-10-10\n---\n본문");
    expect(setFrontmatterField(doc, "title", null)).toBe("본문");
  });
  it("프런트매터가 없으면 만든다", () => {
    expect(setFrontmatterField("# 글\n", "status", "할 일")).toBe("---\nstatus: 할 일\n---\n# 글\n");
  });
  it("깨진 YAML은 고치지 않는다", () => {
    expect(() => setFrontmatterField("---\na: [\n---\nx", "b", 1)).toThrow(/YAML/);
  });
  it("입력 글자를 원래 값의 형태로", () => {
    expect(parseFieldInput("3", 1)).toBe(3);
    expect(parseFieldInput("3", "x")).toBe("3");
    expect(parseFieldInput("a, b", ["x"])).toEqual(["a", "b"]);
    expect(parseFieldInput("true", undefined)).toBe(true);
    expect(parseFieldInput(" ", "x")).toBeNull();
  });
});
