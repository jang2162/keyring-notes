// PDF 렌더러(pdf.js). 크기가 커서 PDF를 열 때만 불러온다.
// legacy 빌드: 기본 빌드는 아주 최근 브라우저 기능(Map.getOrInsertComputed 등)을 써서 모바일·앱 WebView에서 멈춘다.
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
// 워커는 같은 출처의 파일로(CSP script-src 'self' 안에서 돈다)
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  // useWasm: false — 이미지 디코더를 WebAssembly 대신 JS로(CSP에 wasm-unsafe-eval을 넣지 않는다)
  return getDocument({ data, useWasm: false, enableXfa: false }).promise;
}

/** 한 쪽을 그린다: 캔버스와 고를 수 있는 글자 층(host 안을 바꾼다) */
export async function renderPage(pdf: PDFDocumentProxy, pageNo: number, host: HTMLElement, scale: number): Promise<void> {
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  host.style.setProperty("--scale-factor", String(scale));
  host.style.width = `${Math.floor(viewport.width)}px`;
  host.style.height = `${Math.floor(viewport.height)}px`;
  host.replaceChildren();
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const text = document.createElement("div");
  text.className = "textLayer";
  host.append(canvas, text);
  await page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
  await new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
}

export async function pageSize(pdf: PDFDocumentProxy, pageNo: number, scale: number): Promise<{ width: number; height: number }> {
  const vp = (await pdf.getPage(pageNo)).getViewport({ scale });
  return { width: Math.floor(vp.width), height: Math.floor(vp.height) };
}
