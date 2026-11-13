import { describe, expect, it } from "vitest";
import { addPdfAnnotation, blockText, cleanPdfQuote, newPdfAnnotationId, pdfAnnotations, pdfCompanionPath, removePdfAnnotation } from "../src/index.js";

const PDF = "경제/raw/assets/보고서.pdf";

describe("PDF 주석", () => {
  it("절이 없으면 끝에 만들고, 쪽 순서로 넣는다", () => {
    let doc = "---\ntitle: 보고서\n---\n# 보고서\n\n본문\n";
    doc = addPdfAnnotation(doc, { pdf: PDF, page: 5, quote: "다섯째 쪽", id: "pdf-5-aaaa" }, "ko");
    doc = addPdfAnnotation(doc, { pdf: PDF, page: 3, quote: "셋째\n쪽의 “인용”", note: "중요", id: "pdf-3-bbbb" }, "ko");
    doc = addPdfAnnotation(doc, { pdf: PDF, page: 9, quote: "아홉", id: "pdf-9-cccc" }, "ko");
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
    const out = addPdfAnnotation(doc, { pdf: "a.pdf", page: 1, quote: "x", id: "pdf-1-zzzz" }, "ko");
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

/**
 * 주석 줄을 읽는 규칙을 정규식으로 적은 것. 구현에는 쓰지 않는다 — 블록 ID 없이 ` — ` 뒤에 공백이 긴 줄에서 공백 수의 세제곱으로
 * 느리다(2,000칸에 10초쯤 — 이 정규식에 아래 「긴 공백」 시험의 줄을 넣어 잰다). 짧은 줄에만 돌려 pdfAnnotations 와 견준다.
 */
const LINE_RE = /^\s*[-*]\s+\[\[([^\]|#]+\.pdf)#page=(\d+)(?:\|[^\]]*)?\]\]\s+“(.*)”(?:\s+—\s+(.*?))?\s+\^([A-Za-z0-9-]+)\s*$/i;

function byRegex(line: string) {
  const m = LINE_RE.exec(line);
  return m ? [{ id: m[5], pdf: m[1], page: Number(m[2]), quote: m[3], ...(m[4] ? { note: m[4] } : {}), line: 1 }] : [];
}

describe("PDF 주석 줄 읽기는 규칙(정규식)과 같은 답을 낸다", () => {
  it("문서에 나오는 꼴", () => {
    const lines = [
      "- [[a.pdf#page=3|3쪽]] “고른 글” — 메모 ^pdf-3-k2x9",
      "- [[a.pdf#page=3|3쪽]] “고른 글” ^pdf-3-k2x9",
      "* [[폴더/A B.PDF#PAGE=12]] “글”  —  메모 둘  ^id-1  ",
      "  - [[a.pdf#page=3]] “그는 “안녕” 이라 했다” — “인용” 이 든 메모 ^x",
      "- [[a.pdf#page=3]] “글” — ^x",
      "- [[a.pdf#page=3]] “글” —  ^x",
      "- [[a.pdf#page=3]] “글” —   ^x",
      "- [[a.pdf#page=3]] “글” —메모 ^x",
      "- [[a.pdf#page=3]] “글”— 메모 ^x",
      "- [[a.pdf#page=3]] “글” — 메모^x",
      "- [[a.pdf#page=3]] “글” — 메모 ^x y",
      "- [[a.pdf#page=3]] “글” — 메 ^a 모 ^x",
      "- [[a.pdf#page=3]] “글” — 메모 — 둘 ^x",
      "- [[a.pdf#page=3]] “글” ” — 메모 ^x",
      "- [[a.pdf#page=3]] “글”^x",
      "- [[a.pdf#page=3]] “” ^x",
      "- [[a.pdf#page=3]]“글” ^x",
      "- [[a.pdf#page=3]] 글 ^x",
      "- [[a.pdf#page=3]] “글 ^x",
      "- [[a.pdf#page=x]] “글” ^x",
      "- [[a.png#page=3]] “글” ^x",
      "- [[.pdf#page=3]] “글” ^x",
      "- [[a.pdf#page=3|별^칭]] “글” ^x",
      "- [[a.pdf#page=3]] “글” — 메모 ^",
      "- [[a.pdf#page=3]] “글” — 메모 ^x!",
      "- [[a.pdf#page=3]] “줄\r끝” — 메모 ^x",
      "- [[a.pdf#page=3]] “글” — 메\r모 ^x",
      "- [[a.pdf#page=3]] “글”\r—\r메모\r^x\r",
      "- [[a.pdf#page=3]] “글” — 메모   ^x",
      "글 [[a.pdf#page=3]] “글” ^x",
      "",
    ];
    for (const line of lines) expect(pdfAnnotations(line), JSON.stringify(line)).toEqual(byRegex(line));
  });

  it("무작위 조각 조합 6만 건", () => {
    const heads = ["- [[a.pdf#page=3|3쪽]]", "- [[a.pdf#page=3]]", "* [[b c.PDF#page=10|x]]", "- [[a.pdf#page=3]", "-[[a.pdf#page=3]]"];
    const parts = ["“", "”", "—", "^", " ", " ", "  ", "\t", "\r", " ", "a", "b", "-", "1", "^x", " ^x", " — ", "” ", " “"];
    // 시드를 고정한 난수(mulberry32)
    let seed = 7131;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (from: string[]) => from[Math.floor(next() * from.length)];
    const opens = [" “", "  “", "\t“", "“", " "];
    const ends = [" ^x", "” ^pdf-1-a ", "” — a ^x", "^x", " ^", " ^x y", "”", ""];
    let matched = 0;
    let failed: unknown[] = [];
    for (let k = 0; k < 60000 && failed.length === 0; k++) {
      // 앞머리 + 여는 따옴표 + 무작위 조각 + 줄 끝 — 주석 줄로 읽히는 것이 자주 나오게 뼈대를 준다
      let line = pick(heads) + pick(opens);
      for (let len = Math.floor(next() * 12); len > 0; len--) line += pick(parts);
      line += pick(ends);
      const want = byRegex(line);
      const got = pdfAnnotations(line);
      if (want.length) matched++;
      if (JSON.stringify(got) !== JSON.stringify(want)) failed = [JSON.stringify(line), got, want];
    }
    expect(failed).toEqual([]);
    // 주석 줄로 읽히는 것이 충분히 섞여 있어야 견준 것이다
    expect(matched).toBeGreaterThan(3000);
  });

  // 긴 공백: 정규식 꼴로 돌아가면 2,000칸에 10초쯤 걸려 여기서 실패하고, 20,000칸(몇 시간)으로는 넘어가지 않는다
  it("블록 ID 없이 공백이 긴 줄도 바로 끝난다", { timeout: 120_000 }, () => {
    for (const n of [2000, 20000]) {
      const gap = " ".repeat(n);
      for (const line of [
        `- [[a.pdf#page=1|1쪽]] “x” — ${gap}y`,
        `- [[a.pdf#page=1|1쪽]] “x” — a${gap}b ^pdf-1-a`,
        `- [[a.pdf#page=1]] “${"” — a ".repeat(n)}`,
      ]) {
        const t = performance.now();
        pdfAnnotations(line);
        expect(performance.now() - t, `공백 ${n}칸`).toBeLessThan(1000);
      }
    }
  });
});
