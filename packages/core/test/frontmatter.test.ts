import { describe, expect, it } from "vitest";
import { convertProperty, parseFieldInput, parseFrontmatter, propertyStats, propertyType, renameFrontmatterField, setFrontmatterField } from "../src/index.js";

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

describe("속성 입력 화면", () => {
  it("이름 바꾸기는 자리·값·주석을 지킨다", () => {
    const doc = "---\ntitle: 계획\nstate: 진행 # 상태\ndue: 2026-10-10\n---\n본문";
    expect(renameFrontmatterField(doc, "state", "status")).toBe("---\ntitle: 계획\nstatus: 진행 # 상태\ndue: 2026-10-10\n---\n본문");
    expect(() => renameFrontmatterField(doc, "state", "title")).toThrow(expect.objectContaining({ code: "field_exists" }));
    expect(() => renameFrontmatterField(doc, "없음", "x")).toThrow(expect.objectContaining({ code: "field_missing" }));
  });
  it("빈 값으로 더하면 `key:`", () => {
    expect(setFrontmatterField("---\ntitle: x\n---\n", "owner", null, { keepEmpty: true })).toBe("---\ntitle: x\nowner:\n---\n");
    expect(parseFrontmatter("---\ntitle: x\nowner:\n---\n").data).toEqual({ title: "x", owner: null });
  });
  it("날짜·목록·참거짓을 원래 모양으로 쓴다", () => {
    let doc = setFrontmatterField("# 글\n", "due", "2026-10-06");
    doc = setFrontmatterField(doc, "done", true);
    doc = setFrontmatterField(doc, "aliases", ["가", "나"]);
    doc = setFrontmatterField(doc, "code", "007");
    expect(doc).toBe('---\ndue: 2026-10-06\ndone: true\naliases:\n  - 가\n  - 나\ncode: "007"\n---\n# 글\n');
    expect(parseFrontmatter(doc).data).toEqual({ due: "2026-10-06", done: true, aliases: ["가", "나"], code: "007" });
  });
  it("종류 알아내기·통계·바꾸기", () => {
    expect([1, true, ["a"], { a: 1 }, "2026-10-06", "2026-10-06T09:30", "글", null].map(propertyType)).toEqual([
      "number",
      "checkbox",
      "list",
      "object",
      "date",
      "datetime",
      "text",
      null,
    ]);
    const stats = propertyStats([
      { frontmatter: { status: "진행", tags: ["a"] } },
      { frontmatter: { status: "완료", due: "2026-10-01" } },
      { frontmatter: { status: "진행" } },
      { frontmatter: null },
    ]);
    expect(stats[0]).toEqual({ key: "status", type: "text", count: 3, values: ["진행", "완료"] });
    expect(stats.find((s) => s.key === "due")).toEqual({ key: "due", type: "date", count: 1, values: [] });
    const today = new Date(2026, 9, 6);
    expect(convertProperty("a, b", "list")).toEqual(["a", "b"]);
    expect(convertProperty(["a", "b"], "text")).toBe("a, b");
    expect(convertProperty("x", "number")).toBeNull();
    expect(convertProperty("3", "number")).toBe(3);
    expect(convertProperty("x", "date", today)).toBe("2026-10-06");
    expect(convertProperty("2026-10-01", "datetime")).toBe("2026-10-01T09:00");
  });
});

describe("속성 고칠 때 원래 모양 잇기", () => {
  it("한 줄 목록·값 뒤 주석", () => {
    const doc = "---\ntags: [a, b]\nstatus: 진행 # 상태\ncode: '007'\n---\n";
    let out = setFrontmatterField(doc, "tags", ["a", "b", "c"]);
    out = setFrontmatterField(out, "status", "완료");
    out = setFrontmatterField(out, "code", "008");
    expect(out).toBe("---\ntags: [a, b, c]\nstatus: 완료 # 상태\ncode: '008'\n---\n");
    expect(setFrontmatterField(out, "status", 3)).toContain("status: 3 # 상태");
  });
});
