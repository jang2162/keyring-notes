/**
 * PDF 주석: PDF에서 고른 글을 그 PDF의 짝 노트(마크다운)에 한 줄씩 남긴다. 원본은 늘 마크다운이고,
 * 줄 끝 블록 ID로 위키 페이지가 `sources: ['[[짝 노트#^pdf-3-k2x9]]']`처럼 그 부분을 출처로 가리킨다.
 *
 *   ## PDF 주석
 *
 *   - [[raw/assets/보고서.pdf#page=3|3쪽]] “고른 글” — 메모 ^pdf-3-k2x9
 */
import { isLineEndCode, isSpaceCode } from "./linkScan.js";
import { vaultText, type VaultLang } from "./vaultText.js";

/** 주석 절 제목(볼트 언어) */
export const pdfNotesHeading = (lang?: VaultLang | string | null) => vaultText(lang).ingest.pdfNotes;

export interface PdfAnnotation {
  /** 블록 ID(^ 없이) */
  id: string;
  /** 링크에 쓴 PDF 대상(경로 또는 이름) */
  pdf: string;
  page: number;
  quote: string;
  note?: string;
  /** 1부터 시작하는 줄 */
  line: number;
}

const LINE_HEAD_RE = /^\s*[-*]\s+\[\[([^\]|#]+\.pdf)#page=(\d+)(?:\|[^\]]*)?\]\]/i;
const LINE_ID_RE = /^\^([A-Za-z0-9-]+)\s*$/;

interface PdfLine {
  pdf: string;
  page: string;
  quote: string;
  /** ` — 메모` 가 없으면 undefined */
  note: string | undefined;
  id: string;
}

/**
 * 주석 한 줄을 읽는다. 주석 줄이 아니면 null. 읽는 규칙은 정규식
 * `/^\s*[-*]\s+\[\[([^\]|#]+\.pdf)#page=(\d+)(?:\|[^\]]*)?\]\]\s+“(.*)”(?:\s+—\s+(.*?))?\s+\^([A-Za-z0-9-]+)\s*$/i` 와 같다
 * (`packages/core/test/pdfnotes.test.ts` 가 그 정규식과 견준다).
 *
 * 그 정규식을 그대로 쓰지 않는 이유: 인용·메모·공백 조각이 같은 글자를 나눠 가져, 블록 ID 없이 ` — ` 뒤에 공백이 긴 줄에서
 * 공백 수의 세제곱으로 느리다(2,000칸에 10초). 여기서는 앞머리와 줄 끝 블록 ID 를 먼저 정하고 그 사이만 한 번 훑는다:
 * 블록 ID 는 마지막 `^` 뒤이고, 인용은 뒤가 맞는 `”` 중 가장 뒤의 것까지, 메모는 ` — ` 뒤부터 블록 ID 앞 공백 전까지다.
 */
function parsePdfLine(line: string): PdfLine | null {
  const head = LINE_HEAD_RE.exec(line);
  if (!head) return null;
  const caret = line.lastIndexOf("^");
  const id = caret < 0 ? null : LINE_ID_RE.exec(line.slice(caret));
  if (!id) return null;
  // 블록 ID 앞 공백 구간 [gap, caret) — 하나는 있어야 한다
  let gap = caret;
  while (gap > 0 && isSpaceCode(line.charCodeAt(gap - 1))) gap--;
  if (gap === caret) return null;
  let open = head[0].length;
  while (isSpaceCode(line.charCodeAt(open))) open++;
  if (open === head[0].length || line[open] !== "“") return null;
  const quoteStart = open + 1;
  // 인용과 메모는 줄 끝 글자(CR 등)를 건너지 못한다
  let quoteLimit = quoteStart;
  while (quoteLimit < caret && !isLineEndCode(line.charCodeAt(quoteLimit))) quoteLimit++;
  let lastLineEnd = gap - 1;
  while (lastLineEnd >= quoteStart && !isLineEndCode(line.charCodeAt(lastLineEnd))) lastLineEnd--;
  const found = (close: number, note: string | undefined): PdfLine => ({ pdf: head[1], page: head[2], quote: line.slice(quoteStart, close), note, id: id[1] });
  for (let close = quoteLimit - 1; close >= quoteStart; close--) {
    if (line[close] !== "”") continue;
    let dash = close + 1;
    while (isSpaceCode(line.charCodeAt(dash))) dash++;
    if (dash > close + 1 && line[dash] === "—") {
      let noteStart = dash + 1;
      while (isSpaceCode(line.charCodeAt(noteStart))) noteStart++;
      // ` — ` 뒤가 블록 ID 까지 공백뿐이면 빈 메모(공백이 둘은 있어야 한다: 하나는 ` — ` 의 것, 하나는 블록 ID 앞의 것)
      if (noteStart === caret) {
        if (caret - dash > 2) return found(close, "");
      } else if (noteStart > dash + 1 && lastLineEnd < noteStart) return found(close, line.slice(noteStart, gap));
    }
    if (close + 1 >= gap) return found(close, undefined);
  }
  return null;
}

/** 짝 노트에 남긴 주석들. pdf를 주면 그 PDF를 가리키는 것만(이름 비교는 resolve로) */
export function pdfAnnotations(content: string, resolve?: (target: string) => string | null, pdfPath?: string): PdfAnnotation[] {
  const out: PdfAnnotation[] = [];
  content.split("\n").forEach((line, i) => {
    const m = parsePdfLine(line);
    if (!m) return;
    if (pdfPath && (resolve ? resolve(m.pdf) : m.pdf) !== pdfPath) return;
    out.push({ id: m.id, pdf: m.pdf, page: Number(m.page), quote: m.quote, ...(m.note ? { note: m.note } : {}), line: i + 1 });
  });
  return out;
}

/** 고른 글을 한 줄로: 줄바꿈·연속 공백을 하나로, 줄 끝 하이픈 이음(“exam-\nple”)은 붙인다 */
export function cleanPdfQuote(text: string): string {
  return text
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .trim();
}

/** 새 블록 ID: pdf-<쪽>-<임의 4글자>. 문서에 이미 있으면 다시 뽑는다 */
export function newPdfAnnotationId(content: string, page: number, random: () => number = Math.random): string {
  for (;;) {
    const id = `pdf-${page}-${Math.floor(random() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")}`;
    if (!content.includes(`^${id}`)) return id;
  }
}

/** 주석 한 줄 */
export function formatPdfAnnotation(a: { pdf: string; page: number; quote: string; note?: string; id: string }, lang?: VaultLang | string | null): string {
  const note = a.note?.replace(/\s+/g, " ").trim();
  return `- [[${a.pdf}#page=${a.page}|${vaultText(lang).ingest.page(a.page)}]] “${cleanPdfQuote(a.quote)}”${note ? ` — ${note}` : ""} ^${a.id}`;
}

/**
 * 짝 노트에 주석을 더한다. "## PDF 주석" 절이 있으면 그 절 끝(다음 같은 수준 이상 제목 앞)에, 없으면 문서 끝에 절을 만든다.
 * 같은 쪽끼리 모이도록 쪽 순서를 지켜 넣는다.
 */
/** lang: 볼트 언어(절 제목·쪽 표시) */
export function addPdfAnnotation(
  content: string,
  a: { pdf: string; page: number; quote: string; note?: string; id: string },
  lang?: VaultLang | string | null,
): string {
  const line = formatPdfAnnotation(a, lang);
  const heading = pdfNotesHeading(lang);
  const lines = content.split("\n");
  const head = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`).test(l));
  if (head < 0) {
    const base = content.replace(/\n*$/, "");
    return `${base}${base ? "\n\n" : ""}## ${heading}\n\n${line}\n`;
  }
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // 절 안에서 쪽 번호가 더 큰 첫 주석 앞, 없으면 절의 마지막 주석 뒤
  let at = -1;
  let last = -1;
  for (let i = head + 1; i < end; i++) {
    const m = parsePdfLine(lines[i]);
    if (!m) continue;
    last = i;
    if (at < 0 && Number(m.page) > a.page) at = i;
  }
  if (at < 0) at = last >= 0 ? last + 1 : head + 1;
  if (last < 0) {
    // 절에 주석이 아직 없으면 제목 바로 뒤 빈 줄 다음에
    lines.splice(head + 1, 0, "", line);
    return lines.join("\n");
  }
  lines.splice(at, 0, line);
  return lines.join("\n");
}

/** 주석 한 줄을 지운다(블록 ID로 찾는다). 없으면 그대로 */
export function removePdfAnnotation(content: string, id: string): string {
  const lines = content.split("\n");
  const i = lines.findIndex((l) => {
    const m = parsePdfLine(l);
    return m !== null && m.id === id;
  });
  if (i < 0) return content;
  lines.splice(i, 1);
  return lines.join("\n");
}

/** PDF의 짝 노트를 새로 만들 때 쓸 경로: …/assets/x.pdf → …/x.md, 그 밖에는 같은 폴더의 x.md */
export function pdfCompanionPath(pdfPath: string): string {
  const parts = pdfPath.split("/");
  const name = parts.pop()!.replace(/\.pdf$/i, "");
  if (parts[parts.length - 1] === "assets") parts.pop();
  return [...parts, `${name}.md`].join("/");
}
