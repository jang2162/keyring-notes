import { describe, expect, it, vi } from "vitest";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightPieces, pieceCache, type Piece } from "./codeHighlight";

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

  it("언어 파서를 불러오지 못하면 null 이 아니라 실패로 끝난다(모르는 언어와 가른다)", async () => {
    const desc = LanguageDescription.matchLanguageName(languages, "ts", true)!;
    const spy = vi.spyOn(desc, "load").mockRejectedValueOnce(new Error("offline"));
    await expect(highlightPieces("const a = 1;", "ts")).rejects.toThrow("offline");
    spy.mockRestore();
  });
});

describe("조각 기억", () => {
  const pieces: Piece[] = [{ text: "x", cls: "tok-keyword" }];

  it("불러오기 실패는 기억하지 않아 다음에 다시 불러온다", async () => {
    const load = vi.fn<(code: string, lang: string) => Promise<Piece[] | null>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(pieces);
    const cache = pieceCache(10, load);
    await expect(cache.load("x", "ts")).rejects.toThrow("offline");
    expect(cache.peek("x", "ts")).toBeUndefined();
    expect(await cache.load("x", "ts")).toEqual(pieces);
    expect(cache.peek("x", "ts")).toEqual(pieces);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("모르는 언어(null)는 기억한다", async () => {
    const cache = pieceCache(10, async () => null);
    expect(await cache.load("x", "없는언어")).toBeNull();
    expect(cache.peek("x", "없는언어")).toBeNull();
  });

  it("넘치면 오래된 것부터 버린다", async () => {
    const cache = pieceCache(2, async () => pieces);
    await cache.load("a", "ts");
    await cache.load("b", "ts");
    await cache.load("c", "ts");
    expect(cache.peek("a", "ts")).toBeUndefined();
    expect(cache.peek("c", "ts")).toEqual(pieces);
  });
});
