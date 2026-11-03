import { describe, expect, it } from "vitest";
import { highlightPieces } from "./codeHighlight";

const join = (pieces: { text: string }[]) => pieces.map((p) => p.text).join("");

describe("코드 블록 언어별 조각", () => {
  it("조각을 이으면 원래 글이고, 키워드에 tok-keyword 가 붙는다", async () => {
    const code = "const a = 1;\n// 끝";
    const pieces = (await highlightPieces(code, "ts"))!;
    expect(join(pieces)).toBe(code);
    expect(pieces.find((p) => p.text === "const")?.cls).toContain("tok-keyword");
    expect(pieces.find((p) => p.text === "// 끝")?.cls).toContain("tok-comment");
  });

  it("언어 별칭과 대소문자도 찾는다", async () => {
    for (const lang of ["js", "typescript", "JavaScript", "Python"]) {
      const pieces = await highlightPieces("x = 1", lang);
      expect(pieces, lang).not.toBeNull();
      expect(join(pieces!)).toBe("x = 1");
    }
  });

  it("모르는 언어는 null, 빈 글은 빈 배열", async () => {
    expect(await highlightPieces("x", "없는언어")).toBeNull();
    expect(await highlightPieces("x", "")).toBeNull();
    expect(await highlightPieces("", "ts")).toEqual([]);
  });
});
