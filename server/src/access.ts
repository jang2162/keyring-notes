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

/** 규칙 키를 정규화한다. 볼트 전체는 "/" 로 쓰고 내부적으로 "" 로 둔다. */
export function normalizeRulePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "/" || trimmed === "" || trimmed === "*") return "";
  return normalizeVaultPath(trimmed.replace(/\/+$/, ""));
}

/**
 * 토큰 하나의 "노드 → 권한" 표. 가장 구체적인(가장 긴) 경로 규칙이 이긴다. 규칙이 없으면 숨김.
 * 노드 모델(형제 방식 `X.md` + `X/`)이라 규칙 `X`는 하위 `X/…`와 함께 노드 노트 `X.md`도 덮는다
 * (숨김 노드의 노트가 상위 규칙으로 보이지 않게).
 */
export class AccessPolicy {
  private rules: [string, Level][];

  constructor(rules: Record<string, Level>) {
    this.rules = Object.entries(rules)
      .map(([k, v]) => [normalizeRulePath(k), v] as [string, Level])
      .sort((a, b) => b[0].length - a[0].length);
  }

  level(relPath: string): Level {
    for (const [prefix, level] of this.rules) {
      if (prefix === "" || relPath === prefix || relPath.startsWith(prefix + "/") || relPath === prefix + ".md") return level;
    }
    return "hidden";
  }

  /** 이 폴더 아래 어딘가에 보이는 경로가 있을 수 있는지(폴더 자체는 숨김이어도 하위 규칙이 열어 줄 때). */
  mayContainVisible(dirPath: string): boolean {
    if (atLeast(this.level(dirPath), "read")) return true;
    return this.rules.some(([prefix, level]) => prefix.startsWith(dirPath + "/") && atLeast(level, "read"));
  }

  toJSON(): Record<string, Level> {
    return Object.fromEntries(this.rules.map(([k, v]) => [k === "" ? "/" : k, v]));
  }
}

export type Principal =
  /** device: 앱(기기 토큰)으로 들어온 소유자. 문서는 소유자 권한, 관리 콘솔은 못 쓴다 */
  | { kind: "owner"; name: string; email: string; device?: string }
  | { kind: "agent"; name: string; email: string; policy: AccessPolicy };

export function levelOf(principal: Principal, relPath: string): Level {
  return principal.kind === "owner" ? "delete" : principal.policy.level(relPath);
}
