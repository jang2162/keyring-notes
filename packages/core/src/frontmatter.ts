import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { PathError } from "./errors.js";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const EMPTY_FM_RE = /^---\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** 내장 필드(위젯이 계산하는 값)는 프런트매터로 고치지 않는다 */
export const BUILTIN_FIELDS = new Set(["path", "title", "folder", "name", "tags", "modified"]);

/**
 * 프런트매터 필드 하나를 바꾼다(value가 null이면 지운다). 다른 필드·주석·순서는 그대로 둔다.
 * 프런트매터가 없으면 새로 만든다. YAML이 깨져 있으면 고치지 않고 오류.
 */
export function setFrontmatterField(content: string, key: string, value: unknown, opts: { keepEmpty?: boolean } = {}): string {
  checkKey(key);
  return editFrontmatter(content, (doc) => {
    if (value === null || value === undefined) {
      if (opts.keepEmpty) doc.set(key, null);
      else doc.delete(key);
    } else {
      // 원래 값의 모양을 잇는다: 글자 값은 그 자리만 바꿔 뒤 주석을 지키고, [a, b] 목록은 한 줄 목록으로
      const prev = doc.get(key, true);
      const node = doc.createNode(value);
      if (isScalar(prev) && isScalar(node) && prev.value !== null) {
        // 따옴표 모양은 같은 종류(글자→글자)일 때만 잇는다
        if (typeof prev.value !== typeof node.value) prev.type = undefined;
        prev.value = node.value;
      } else {
        if (isSeq(prev) && prev.flow && isSeq(node)) node.flow = true;
        doc.set(key, node);
      }
    }
  }, opts.keepEmpty && (value === null || value === undefined) ? key : null);
}

/** 필드 이름을 바꾼다(자리·값·주석은 그대로). 새 이름이 이미 있으면 오류. */
export function renameFrontmatterField(content: string, from: string, to: string): string {
  checkKey(to);
  if (from === to) return content;
  return editFrontmatter(content, (doc) => {
    if (doc.has(to)) throw new PathError("field_exists", { field: to });
    const map = doc.contents;
    const pair = isMap(map) ? map.items.find((p) => isScalar(p.key) && p.key.value === from) : undefined;
    if (!pair) throw new PathError("field_missing", { field: from });
    pair.key = doc.createNode(to);
  }, null);
}

function checkKey(key: string) {
  if (!/^[^\s:#][^:#]*$/.test(key) || key !== key.trim()) throw new PathError(`필드 이름이 잘못되었습니다: ${key}`);
}

/** 프런트매터 YAML을 문서 객체로 고친다. emptyKey: 값이 빈 그 필드는 `key: null` 대신 `key:`로 쓴다 */
function editFrontmatter(content: string, edit: (doc: ReturnType<typeof parseDocument>) => void, emptyKey: string | null): string {
  const m = FM_RE.exec(content) ?? EMPTY_FM_RE.exec(content);
  const yamlText = m && m[1] !== undefined ? m[1] : "";
  const body = m ? content.slice(m[0].length) : content;
  const doc = parseDocument(yamlText);
  if (doc.errors.length) throw new PathError("frontmatter_yaml", { message: doc.errors[0].message.split("\n")[0] });
  if (doc.contents === null || doc.contents === undefined) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  if (!isMap(doc.contents)) throw new PathError("frontmatter_not_object");
  edit(doc);
  // 다른 필드의 모양이 바뀌지 않게([a, b]를 [ a, b ]로 바꾸지 않는 등)
  let out = doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).replace(/\n+$/, "");
  if (emptyKey !== null) out = out.split("\n").map((l) => (l === `${emptyKey}: null` ? `${emptyKey}:` : l)).join("\n");
  if (!out || out === "{}") return body;
  return `---\n${out}\n---\n${body}`;
}

/** 속성 입력 화면의 값 종류 */
export type PropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "list" | "object";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

/** 값의 종류. 빈 값(null)은 알 수 없음(null) */
export function propertyType(value: unknown): PropertyType | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "object";
  const s = String(value);
  if (DATE_RE.test(s)) return "date";
  if (DATETIME_RE.test(s)) return "datetime";
  return "text";
}

/** 볼트 전체 속성 통계: 이름마다 가장 많이 쓴 종류, 쓴 문서 수, 자주 쓴 값(자동완성용) */
export interface PropertyStat {
  key: string;
  type: PropertyType;
  count: number;
  values: string[];
}

export function propertyStats(docs: { frontmatter: Record<string, unknown> | null }[]): PropertyStat[] {
  const acc = new Map<string, { count: number; types: Map<PropertyType, number>; values: Map<string, number> }>();
  for (const d of docs) {
    for (const [key, value] of Object.entries(d.frontmatter ?? {})) {
      const a = acc.get(key) ?? { count: 0, types: new Map(), values: new Map() };
      acc.set(key, a);
      a.count++;
      const t = propertyType(value);
      if (t) a.types.set(t, (a.types.get(t) ?? 0) + 1);
      const scalars = Array.isArray(value) ? value : [value];
      for (const v of scalars) {
        if (typeof v === "string" && v.length <= 80 && t !== "date" && t !== "datetime") a.values.set(v, (a.values.get(v) ?? 0) + 1);
      }
    }
  }
  const top = <T,>(m: Map<T, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  return [...acc.entries()]
    .map(([key, a]) => ({ key, type: top(a.types)[0] ?? "text", count: a.count, values: top(a.values).slice(0, 30) }))
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));
}

/** 종류를 바꿀 때 값을 옮긴다(옮길 수 없으면 빈 값) */
export function convertProperty(value: unknown, to: PropertyType, today = new Date()): unknown {
  const asText = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : typeof value === "object" ? "" : String(value);
  switch (to) {
    case "text":
      return asText || null;
    case "number": {
      const n = Number(asText);
      return asText !== "" && Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return typeof value === "boolean" ? value : asText === "true";
    case "list":
      return Array.isArray(value) ? value : asText ? asText.split(/\s*,\s*/).filter(Boolean) : [];
    case "date":
      return DATE_RE.test(asText) ? asText : DATETIME_RE.test(asText) ? asText.slice(0, 10) : ymd(today);
    case "datetime":
      return DATETIME_RE.test(asText) ? asText : DATE_RE.test(asText) ? `${asText}T09:00` : `${ymd(today)}T09:00`;
    case "object":
      return value;
  }
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
