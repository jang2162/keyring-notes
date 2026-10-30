import { isMap, parseDocument } from "yaml";
import { setFrontmatterField } from "./frontmatter.js";
import { parseFrontmatter } from "./markdown.js";
import { isMarkdown } from "./paths.js";
import { isVaultSettingsPath } from "./settings.js";

/**
 * 노트의 수정 시각(프런트매터 `edited`). 쓰기 계층(로컬 LocalVault.apply, 서버 Vault.batch)이 내용을 바꾸는 쓰기마다 적는다.
 * `updated` 는 위키 스키마가 「내용을 마지막으로 손본 날짜」 로 쓰고, `modified` 는 위젯의 내장 필드라 쓰지 않는다.
 */
export const EDITED_FIELD = "edited";

/** 초 단위 UTC ISO(`2026-10-30T09:12:33Z`) */
export function editedStamp(now: Date): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

/** 프런트매터의 edited → ms. 시각으로 읽을 수 없으면 null */
export function editedOf(frontmatter: Record<string, unknown> | null): number | null {
  const v = frontmatter?.[EDITED_FIELD];
  const ms = v instanceof Date ? v.getTime() : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

const BOM = "\uFEFF";
const EDITED_LINE = /^(edited[ \t]*:[ \t]*)([^#\r\n]*?)([ \t]+#[^\r\n]*)?(\r?\n)?$/;

/**
 * 프런트매터를 줄로 나눈 것. 시각은 YAML 을 다시 쓰지 않고 `edited` 한 줄만 글자로 고친다 — 다시 쓰면 사용자의 YAML 모양
 * (들여쓰지 않은 목록, `[a,b]`, 주석 앞 공백, 줄 끝)이 바뀌어 저장마다 다른 편집기에 diff 가 생기고, 시각을 뺀 내용이
 * 원래와 달라져 휴지통이 이동을 짝짓지 못한다. 맨 앞 BOM 은 떼어 두었다가 그대로 붙인다.
 * YAML 이 깨졌거나 객체가 아니면 null(손대지 않는다). 프런트매터가 없으면 close 가 -1.
 */
function frontmatterLines(content: string): { bom: string; eol: string; lines: string[]; close: number; edited: number } | null {
  const bom = content.startsWith(BOM) ? BOM : "";
  const text = content.slice(bom.length);
  const eol = /^[^\n]*\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text.split(/(?<=\n)/);
  let close = -1;
  if (/^---\r?\n$/.test(lines[0] ?? "")) {
    for (let i = 1; i < lines.length; i++) {
      if (/^(?:---|\.\.\.)[ \t]*(?:\r?\n)?$/.test(lines[i])) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return { bom, eol, lines, close, edited: -1 };
  const doc = parseDocument(lines.slice(1, close).join(""));
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) return null;
  const edited = lines.findIndex((l, i) => i > 0 && i < close && /^edited[ \t]*:/.test(l));
  return { bom, eol, lines, close, edited };
}

/** 한 줄 값(뒤에 들여쓴 이어지는 줄이 없는 것)인 edited 줄인지 */
function singleLine(f: { lines: string[]; close: number; edited: number }): boolean {
  const m = EDITED_LINE.exec(f.lines[f.edited]);
  const next = f.lines[f.edited + 1];
  return !!m && m[2].trim() !== "" && (f.edited + 1 >= f.close || !/^[ \t]/.test(next));
}

/** edited 를 stamp 로 바꾼 내용. YAML 이 깨져 적을 수 없으면 그대로 — 시각 때문에 저장이 실패하면 안 된다 */
function setEdited(content: string, stamp: string): string {
  const f = frontmatterLines(content);
  if (!f) return content;
  const { bom, eol, lines, close, edited } = f;
  let out: string;
  if (close < 0) out = `${bom}---${eol}${EDITED_FIELD}: ${stamp}${eol}---${eol}${lines.join("")}`;
  else if (edited < 0) out = bom + [...lines.slice(0, close), `${EDITED_FIELD}: ${stamp}${eol}`, ...lines.slice(close)].join("");
  else if (singleLine(f)) {
    const m = EDITED_LINE.exec(lines[edited])!;
    out = bom + [...lines.slice(0, edited), `${m[1]}${stamp}${m[3] ?? ""}${m[4] ?? ""}`, ...lines.slice(edited + 1)].join("");
  } else return yamlEdit(content, stamp);
  // 줄로 고친 결과가 그 시각으로 읽히지 않으면(따옴표 키 등 드문 모양) YAML 로 고친다
  return parseFrontmatter(out).data?.[EDITED_FIELD] === stamp ? out : yamlEdit(content, stamp);
}

/** 줄로 고칠 수 없는 드문 모양: YAML 을 다시 써서 고친다(value null 이면 지운다). 못 고치면 그대로 */
function yamlEdit(content: string, value: string | null): string {
  try {
    return setFrontmatterField(content, EDITED_FIELD, value);
  } catch {
    return content;
  }
}

/** edited 를 뺀 내용(edited 가 없거나 YAML 이 깨졌으면 그대로). 같은 노트를 다른 때 적은 두 판을 견줄 때. stampEdited 의 반대 */
export function withoutEdited(content: string): string {
  const f = frontmatterLines(content);
  if (!f || f.edited < 0) return content;
  if (!singleLine(f)) return yamlEdit(content, null);
  const { bom, lines, close, edited } = f;
  const rest = [...lines.slice(0, edited), ...lines.slice(edited + 1)];
  // edited 만 있던 프런트매터(시각을 적으며 만든 것)는 블록째 뺀다
  return bom + (close - 1 === 1 ? rest.slice(2) : rest).join("");
}

/** edited 줄만 다르거나 같은 두 내용인지 */
export function sameExceptEdited(a: string, b: string): boolean {
  return a === b || withoutEdited(a) === withoutEdited(b);
}

/** 노트에 수정 시각을 적는다. 마크다운이 아니거나 공통 설정 파일(트리의 노트가 아니다)이면 그대로 */
export function stampEdited(path: string, content: string, stamp: string): string {
  if (!isMarkdown(path) || isVaultSettingsPath(path)) return content;
  return setEdited(content, stamp);
}

/**
 * 3방향 병합 전에 세 판의 edited 를 셋 중 가장 늦은 값으로 맞춘다. 양쪽이 각자 시각 줄을 바꾸면 같은 줄을 다르게 고친
 * 것이 되어 다른 문단을 고친 동시 편집까지 충돌 사본이 되기 때문이다. 이미 그 값인 판은 글자 그대로 둔다.
 */
export function alignEdited(base: string, a: string, b: string): [string, string, string] {
  const raw = (content: string) => parseFrontmatter(content).data?.[EDITED_FIELD];
  let latest: { ms: number; value: string } | null = null;
  for (const v of [base, a, b]) {
    const value = raw(v);
    const ms = editedOf({ [EDITED_FIELD]: value });
    if (ms !== null && (latest === null || ms > latest.ms)) latest = { ms, value: typeof value === "string" ? value : editedStamp(new Date(ms)) };
  }
  if (latest === null) return [base, a, b];
  const align = (v: string) => (raw(v) === latest.value ? v : setEdited(v, latest.value));
  return [align(base), align(a), align(b)];
}
