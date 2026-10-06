import { describe, expect, it } from "vitest";
import { addPdfAnnotation, blockText, cleanPdfQuote, newPdfAnnotationId, pdfAnnotations, pdfCompanionPath, removePdfAnnotation } from "../src/index.js";

const PDF = "경제/raw/assets/보고서.pdf";

describe("PDF 주석", () => {
  it("절이 없으면 끝에 만들고, 쪽 순서로 넣는다", () => {
    let doc = "---\ntitle: 보고서\n---\n# 보고서\n\n본문\n";
    doc = addPdfAnnotation(doc, { pdf: PDF, page: 5, quote: "다섯째 쪽", id: "pdf-5-aaaa" });
    doc = addPdfAnnotation(doc, { pdf: PDF, page: 3, quote: "셋째\n쪽의 “인용”", note: "중요", id: "pdf-3-bbbb" });
    doc = addPdfAnnotation(doc, { pdf: PDF, page: 9, quote: "아홉", id: "pdf-9-cccc" });
    expect(doc).toBe(
      "---\ntitle: 보고서\n---\n# 보고서\n\n본문\n\n## PDF 주석\n\n" +
        `- [[${PDF}#page=3|3쪽]] “셋째 쪽의 "인용"” — 중요 ^pdf-3-bbbb\n` +
        `- [[${PDF}#page=5|5쪽]] “다섯째 쪽” ^pdf-5-aaaa\n` +
        `- [[${PDF}#page=9|9쪽]] “아홉” ^pdf-9-cccc\n`,
    );
    const anns = pdfAnnotations(doc, undefined, PDF);
    expect(anns.map((a) => [a.id, a.page, a.quote, a.note])).toEqual([
      ["pdf-3-bbbb", 3, '셋째 쪽의 "인용"', "중요"],
      ["pdf-5-aaaa", 5, "다섯째 쪽", undefined],
      ["pdf-9-cccc", 9, "아홉", undefined],
    ]);
    // 블록 ID로 그 줄을 인용할 수 있다(출처 연결)
    expect(blockText(doc, "pdf-5-aaaa")).toBe(`- [[${PDF}#page=5|5쪽]] “다섯째 쪽”`);
    expect(removePdfAnnotation(doc, "pdf-5-aaaa")).not.toContain("pdf-5-aaaa");
  });
  it("절이 중간에 있으면 그 절 안에 넣는다", () => {
    const doc = "# 글\n\n## PDF 주석\n\n## 다른 절\n내용\n";
    const out = addPdfAnnotation(doc, { pdf: "a.pdf", page: 1, quote: "x", id: "pdf-1-zzzz" });
    expect(out).toBe("# 글\n\n## PDF 주석\n\n- [[a.pdf#page=1|1쪽]] “x” ^pdf-1-zzzz\n\n## 다른 절\n내용\n");
  });
  it("고른 글 다듬기·ID·짝 노트 경로", () => {
    expect(cleanPdfQuote("exam-\nple  text\n둘째 줄")).toBe("example text 둘째 줄");
    let n = 0;
    const rnd = () => [0, 0, 0.5][n++];
    expect(newPdfAnnotationId("^pdf-2-0000 있음", 2, rnd)).toBe("pdf-2-" + Math.floor(0.5 * 36 ** 4).toString(36));
    expect(pdfCompanionPath("경제/raw/assets/보고서.pdf")).toBe("경제/raw/보고서.md");
    expect(pdfCompanionPath("첨부/a.pdf")).toBe("첨부/a.md");
  });
});
