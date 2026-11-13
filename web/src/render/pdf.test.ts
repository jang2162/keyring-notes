import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { closePdf, openPdf } from "./pdf";

// 한 쪽(200×100pt)짜리 PDF. xref 표가 없어 pdf.js 가 객체를 훑어 복구한다
const ONE_PAGE = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
  "",
].join("\n");

describe("pdf.js 문서 열고 닫기", () => {
  beforeAll(() => {
    // 시험(Node)에서는 워커 파일을 import 로 읽는다 — pdf.ts 가 넣은 ?url 주소는 브라우저용이라 파일 주소로 바꾼다
    GlobalWorkerOptions.workerSrc = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  });

  it("연 문서의 쪽 수를 읽고, closePdf 로 닫으면 읽기 작업이 끝난다", async () => {
    const pdf = await openPdf(new TextEncoder().encode(ONE_PAGE));
    expect(pdf.numPages).toBe(1);
    expect(pdf.loadingTask.destroyed).toBe(false);
    await closePdf(pdf);
    expect(pdf.loadingTask.destroyed).toBe(true);
  });
});
