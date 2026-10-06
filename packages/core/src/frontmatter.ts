import { parseDocument } from "yaml";
import { PathError } from "./paths.js";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const EMPTY_FM_RE = /^---\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** 내장 필드(위젯이 계산하는 값)는 프런트매터로 고치지 않는다 */
export const BUILTIN_FIELDS = new Set(["path", "title", "folder", "name", "tags", "modified"]);

/**
 * 프런트매터 필드 하나를 바꾼다(value가 null이면 지운다). 다른 필드·주석·순서는 그대로 둔다.
 * 프런트매터가 없으면 새로 만든다. YAML이 깨져 있으면 고치지 않고 오류.
 */
export function setFrontmatterField(content: string, key: string, value: unknown): string {
  if (!/^[^\s:#][^:#]*$/.test(key)) throw new PathError(`필드 이름이 잘못되었습니다: ${key}`);
  const m = FM_RE.exec(content) ?? EMPTY_FM_RE.exec(content);
  const yamlText = m && m[1] !== undefined ? m[1] : "";
  const body = m ? content.slice(m[0].length) : content;
  const doc = parseDocument(yamlText);
  if (doc.errors.length) throw new PathError(`프런트매터 YAML 오류: ${doc.errors[0].message.split("\n")[0]}`);
  if (doc.contents === null || doc.contents === undefined) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  if (value === null || value === undefined) doc.delete(key);
  else doc.set(key, value);
  // 다른 필드의 모양이 바뀌지 않게([a, b]를 [ a, b ]로 바꾸지 않는 등)
  const out = doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).replace(/\n+$/, "");
  if (!out || out === "{}") return body;
  return `---\n${out}\n---\n${body}`;
}

/**
 * 표에서 입력한 글자를 필드 값으로: 빈 칸은 지움(null), 원래 값의 형태(숫자·참거짓·목록)를 따른다.
 * 원래 값이 없으면 숫자·true/false는 그 형태로, 나머지는 글자로.
 */
export function parseFieldInput(raw: string, previous: unknown): unknown {
  const s = raw.trim();
  if (s === "") return null;
  if (Array.isArray(previous)) return s.split(/\s*,\s*/).filter(Boolean);
  if (typeof previous === "number" || previous === undefined || previous === null) {
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  if (typeof previous === "boolean" || previous === undefined || previous === null) {
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return s;
}
