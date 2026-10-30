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

/** edited 를 stamp 로 바꾼 내용. YAML 이 깨져 적을 수 없으면 그대로 — 시각 때문에 저장이 실패하면 안 된다 */
function setEdited(content: string, stamp: string): string {
  try {
    return setFrontmatterField(content, EDITED_FIELD, stamp);
  } catch {
    return content;
  }
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
