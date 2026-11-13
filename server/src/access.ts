import { normalizeVaultPath } from "./paths.js";

/**
 * 권한 단계. 위 단계는 아래 단계를 모두 포함한다.
 * - hidden: 목록·검색·링크 해석에서도 보이지 않음
 * - read: 읽기
 * - append: 새 문서 만들기, 기존 문서 끝에 덧붙이기
 * - write: 기존 내용 수정
 * - delete: 삭제·다른 곳으로 이동
 */
export const LEVELS = ["hidden", "read", "append", "write", "delete"] as const;
export type Level = (typeof LEVELS)[number];

export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

export function atLeast(level: Level, required: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(required);
}

/** 규칙 키를 정규화한다. 볼트 전체는 "/" 로 쓰고 내부적으로 "" 로 둔다. 유니코드는 NFC 로 맞춘다(AccessPolicy.level). */
export function normalizeRulePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "/" || trimmed === "" || trimmed === "*") return "";
  return normalizeVaultPath(trimmed.replace(/\/+$/, "")).normalize("NFC");
}

/**
 * 대소문자·정규화를 접은 꼴. 대문자로 올렸다 내린다 — ſ(U+017F)·K(U+212A)는 소문자로만 내려서는 s·k 가 되지 않는데 APFS 에서는
 * 같은 이름이다
 */
export const foldPath = (rel: string) => rel.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");

/**
 * 접두(규칙 키·검토 대상) `X` 가 경로를 덮는가: 볼트 전체(""), 그 경로 자체, 하위 `X/…`, 노드 노트 `X.md`.
 * 노드 모델(형제 방식 `X.md` + `X/`)이라 `X` 는 노드 노트도 덮는다(숨김 노드의 노트가 상위 규칙으로 보이지 않게).
 * 둘은 같은 꼴(NFC 끼리, 또는 foldPath 끼리)로 맞춰서 넘긴다
 */
export function covers(prefix: string, relPath: string): boolean {
  return prefix === "" || relPath === prefix || relPath.startsWith(prefix + "/") || relPath === prefix + ".md";
}

/** 둘 가운데 엄한 단계 */
const stricter = (a: Level, b: Level): Level => (atLeast(a, b) ? b : a);

/**
 * 토큰 하나의 "노드 → 권한" 표. 가장 구체적인(가장 긴) 경로 규칙이 이긴다. 규칙이 없으면 숨김.
 *
 * 단계는 두 번 고른 것 가운데 엄한 쪽이다: 규칙과 경로를 NFC 로 맞춰 글자로 견준 단계, 둘을 대소문자까지 접어(foldPath) 견준 단계.
 * 그래서 제한하는 규칙은 철자가 달라도 적용되고, 대소문자만 다른 철자로는 어떤 규칙도 더 넓게 적용되지 않는다(허용 규칙은 글자로
 * 맞아야 넓어진다). 읽기·목록·쓰기·만들기가 모두 이 한 판정을 쓴다.
 *
 * 글자로만 견주면 안 되는 이유: 대소문자를 가리지 않는 볼륨에는 두 철자가 함께 있을 수 없어 먼저 생긴 철자가 그 이름을 차지한다.
 * 숨김 규칙 `Secret` 의 폴더가 `secret/` 으로 먼저 생기면(다른 에이전트, 사람의 오타, 옮겨 온 볼트) 그 폴더는 규칙에 걸리지 않고,
 * 규칙의 철자로는 다시 만들 수도 없다(Vault.spelledAsOnDisk). 정규화도 같다 — 디스크의 이름은 NFD, 규칙은 NFC 일 수 있다.
 * 볼륨이 대소문자를 가리는지는 재지 않는다: 가리는 볼륨에서 `secret/` 과 `Secret/` 을 따로 둔 볼트는 숨김 규칙 `Secret` 이 둘 다
 * 가린다(과하게 막는 쪽으로만 틀린다)
 */
export class AccessPolicy {
  /** NFC 로 맞춘 규칙(긴 것부터) */
  private rules: [string, Level][];
  /** 대소문자까지 접은 규칙(긴 것부터). 접은 꼴이 같은 규칙들은 엄한 쪽 하나로 모은다 */
  private folded: [string, Level][];

  constructor(rules: Record<string, Level>) {
    const longestFirst = (a: [string, Level], b: [string, Level]) => b[0].length - a[0].length;
    this.rules = Object.entries(rules)
      .map(([k, v]) => [normalizeRulePath(k), v] as [string, Level])
      .sort(longestFirst);
    const byFold = new Map<string, Level>();
    for (const [prefix, level] of this.rules) {
      const key = foldPath(prefix);
      const seen = byFold.get(key);
      byFold.set(key, seen === undefined ? level : stricter(seen, level));
    }
    this.folded = [...byFold].sort(longestFirst);
  }

  level(relPath: string): Level {
    const exact = AccessPolicy.pick(this.rules, relPath.normalize("NFC"));
    // 이미 숨김이면 접어 견줄 것이 없다(엄한 쪽을 고르므로)
    if (exact === "hidden") return exact;
    return stricter(exact, AccessPolicy.pick(this.folded, foldPath(relPath)));
  }

  private static pick(rules: [string, Level][], relPath: string): Level {
    for (const [prefix, level] of rules) if (covers(prefix, relPath)) return level;
    return "hidden";
  }

  /**
   * 이 폴더 아래 어딘가에 보이는 경로가 있을 수 있는지(폴더 자체는 숨김이어도 하위 규칙이 열어 줄 때). 접은 꼴로 찾는다 —
   * 넉넉히 참이어도 된다(안의 항목은 하나씩 level 로 다시 거른다)
   */
  mayContainVisible(dirPath: string): boolean {
    if (atLeast(this.level(dirPath), "read")) return true;
    const dir = foldPath(dirPath);
    return this.folded.some(([prefix, level]) => prefix.startsWith(dir + "/") && atLeast(level, "read"));
  }

  toJSON(): Record<string, Level> {
    return Object.fromEntries(this.rules.map(([k, v]) => [k === "" ? "/" : k, v]));
  }
}

export type Principal =
  /** device: 앱(기기 토큰)으로 들어온 소유자. 문서는 소유자 권한, 관리 콘솔은 못 쓴다 */
  { kind: "owner"; name: string; email: string; device?: string } | { kind: "agent"; name: string; email: string; policy: AccessPolicy };

export function levelOf(principal: Principal, relPath: string): Level {
  return principal.kind === "owner" ? "delete" : principal.policy.level(relPath);
}
