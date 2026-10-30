import { PathError } from "./errors.js";

/**
 * 커스텀 순서의 rank 키(fractional indexing). 키는 62진 소수(0.d₁d₂…)로 읽고, 글자 집합이 코드 순서와 같아
 * 글자 비교(`<`)가 곧 수의 비교다. 키는 "0" 으로 끝나지 않는다 — 그래야 어느 키 앞에도 넣을 자리가 남는다.
 * 넣을 때 다른 키를 다시 매기지 않으므로 순서를 바꿀 때 옮긴 노트 하나만 바뀐다.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_RE = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

/** 프런트매터 rank 값 → 키. 키 모양이 아니면(숫자·목록·"0" 으로 끝남 등) rank 없는 것으로 친다 */
export function parseRank(v: unknown): string | null {
  return typeof v === "string" && KEY_RE.test(v) ? v : null;
}

/** a < r < b(글자 코드 비교)인 가장 짧은 키. null 은 열린 끝 */
export function rankBetween(a: string | null, b: string | null): string {
  for (const k of [a, b]) if (k !== null && !KEY_RE.test(k)) throw new PathError("rank_invalid", { rank: k });
  if (a !== null && b !== null && a >= b) throw new PathError("rank_order", { a, b });
  return midpoint(a ?? "", b);
}

/** a("" 은 0)와 b(null 은 1) 사이. 앞자리가 같으면 그 자리를 두고 뒤에서 고른다 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  // 이웃한 자릿수: b 가 더 길면 b 의 첫 자리 하나가 사이 값이고, 아니면 a 의 첫 자리 뒤에서 고른다
  if (b !== null && b.length > 1) return b[0];
  return DIGITS[da] + midpoint(a.slice(1), null);
}
