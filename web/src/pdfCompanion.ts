import { translate } from "@keyring-notes/core";
import { api } from "./api";
import { vaultLang } from "./vaultSettings";

/** PDF 의 짝 노트: 경로와 (열린 문서가 아니면) 마지막으로 읽은 내용 */
export interface Companion {
  path: string;
  content: string | null;
  hash: string | null;
}

export interface CompanionTarget {
  /** PDF 경로 */
  pdf: string;
  companion: Companion | null;
  /** 짝 노트가 열려 있으면 그 초안 */
  openDraft: string | null;
  /** 열린 짝 노트의 초안을 바꾼다(저장은 사람이) */
  onEditOpenDoc: (next: string) => void;
  /** 닫힌 짝 노트를 저장했을 때 */
  onWritten: (saved: Companion) => void;
}

const title = (pdf: string) =>
  pdf
    .split("/")
    .pop()!
    .replace(/\.pdf$/i, "");

/** 짝 노트를 고친다: 열린 문서면 초안을, 아니면 읽었던 버전 기준으로 저장한다 */
export async function editCompanion(to: CompanionTarget, fn: (content: string) => string) {
  const { companion, pdf } = to;
  if (!companion) return;
  if (to.openDraft !== null) {
    to.onEditOpenDoc(fn(to.openDraft));
    return;
  }
  let { content, hash } = companion;
  if (content === null) {
    content = `---\ntitle: ${JSON.stringify(title(pdf))}\noriginal: '[[${pdf}]]'\n---\n# ${title(pdf)}\n\n> ${translate(vaultLang(), "pdf.companionSource")}: [[${pdf}]]\n`;
    hash = null;
  }
  const next = fn(content);
  const saved = await api.write(companion.path, next, hash);
  to.onWritten({ path: companion.path, content: next, hash: saved.hash });
}
