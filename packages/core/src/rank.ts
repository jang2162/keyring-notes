import { PathError } from "./errors.js";

/**
 * 커스텀 순서의 rank 키(fractional indexing). 키는 62진 소수(0.d₁d₂…)로 읽고, 글자 집합이 코드 순서와 같아
 * 글자 비교(`<`)가 곧 수의 비교다. 만드는 키는 "0" 으로 끝나지 않는다 — 그래야 어느 키 앞에도 넣을 자리가 남는다.
 * 넣을 때 다른 키를 다시 매기지 않으므로 순서를 바꿀 때 옮긴 노트 하나만 바뀐다.
 * 손으로 쓴 키("a0" 처럼 0 으로 끝나는 것)도 순서로는 그대로 쓴다. 그런 키 바로 앞에는 자리가 없을 수 있다(rankFits).
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_RE = /^[0-9A-Za-z]+$/;

/** 프런트매터 rank 값 → 키. 키 모양이 아니면(숫자·목록·다른 글자) rank 없는 것으로 친다 */
export function parseRank(v: unknown): string | null {
  return typeof v === "string" && KEY_RE.test(v) ? v : null;
}

/** 끝의 0 은 수로는 값이 없다("a0" = "a") */
const trimZeros = (k: string) => k.replace(/0+$/, "");

/** a < r < b 인 키를 만들 수 있는지. b 가 a 뒤에 0 만 붙인 것("a" 와 "a0")이면 사이에 글자가 없다 */
export function rankFits(a: string | null, b: string | null): boolean {
  if (b === null) return true;
  const hi = trimZeros(b);
  return a === null ? hi !== "" : a < b && trimZeros(a) < hi;
}

/** a < r < b(글자 코드 비교)인 가장 짧은 키. null 은 열린 끝 */
export function rankBetween(a: string | null, b: string | null): string {
  for (const k of [a, b]) if (k !== null && !KEY_RE.test(k)) throw new PathError("rank_invalid", { rank: k });
  if (!rankFits(a, b)) throw new PathError("rank_order", { a: a ?? "", b: b ?? "" });
  // 끝의 0 을 떼고 고른다: 떼어 낸 b 보다 작으면 b 보다도 작고, 0 으로 끝나지 않는 키는 a 와 a0… 사이에 들 수 없다
  const lo = trimZeros(a ?? "");
  const hi = b === null ? null : trimZeros(b);
  // 열린 끝(맨 앞·맨 뒤)은 반으로 가르지 않는다 — 반씩 가르면 같은 쪽에 거듭 넣을 때 키가 넣은 횟수만큼 길어진다(맨 위에
  // 2000번이면 300자 넘게). 끝까지의 거리 d 를 d − d² 로만 줄이면 거리가 1/k 꼴로 줄어 키는 로그로만 길어진다.
  // 값은 그대로 62진 소수라 이미 저장된 키와 순서가 섞여도 맞다
  if (a === null && hi !== null) {
    const width = hi.length;
    const B = toInt(hi);
    return midpoint(toKey(B * 62n ** BigInt(width) - B * B, 2 * width), hi);
  }
  if (hi === null && lo !== "") {
    const width = lo.length;
    const scale = 62n ** BigInt(width);
    const A = toInt(lo);
    return midpoint(lo, toKey(A * scale + (scale - A) * (scale - A), 2 * width));
  }
  return midpoint(lo, hi);
}

/** 키 → 62진 정수(자릿수는 키 길이) */
const toInt = (k: string) => [...k].reduce((n, c) => n * 62n + BigInt(DIGITS.indexOf(c)), 0n);

/** 62진 정수 → width 자리 키(끝의 0 은 뗀다) */
function toKey(n: bigint, width: number): string {
  let out = "";
  for (let i = 0; i < width; i++) {
    out = DIGITS[Number(n % 62n)] + out;
    n /= 62n;
  }
  return trimZeros(out);
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
