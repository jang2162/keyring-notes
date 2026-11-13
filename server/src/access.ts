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
 * 경로가 접두(규칙 키·검토 대상)나 그 조상 폴더를 대소문자만 다르게 적었는지. 앞에서부터 접은 꼴이 같은 세그먼트만 보고, 그중
 * 하나라도 글자가 다르면 참이다: 접두 `Work/Secret` 에 `Work/secret/x.md`·`work/x.md` 는 참, `Work/x.md`·`Secretary/x.md` 는 거짓.
 * 노드 노트(`secret.md`)도 노드 이름으로 견준다.
 *
 * 대소문자를 가리지 않는 볼륨에는 두 철자가 함께 있을 수 없어, 먼저 생긴 철자가 그 이름을 차지한다. 규칙의 폴더가 아직 없을 때
 * 다른 철자로 먼저 만들면 규칙의 철자로는 영영 만들 수 없고(Vault.spelledAsOnDisk), 그 뒤 그 폴더에 들어가는 것은 규칙에 걸리지
 * 않는다. 조상도 같다 — `work/` 가 먼저 생기면 `Work/Secret/` 은 만들 수 없다
 */
export function respells(relPath: string, prefix: string): boolean {
  if (prefix === "") return false;
  const want = prefix.normalize("NFC").split("/");
  const differs = (segs: string[]) => {
    let found = false;
    for (let i = 0; i < Math.min(segs.length, want.length); i++) {
      if (segs[i] === want[i]) continue;
      if (foldPath(segs[i]) !== foldPath(want[i])) break;
      found = true;
    }
    return found;
  };
  const segs = relPath.normalize("NFC").split("/");
  const last = segs[segs.length - 1];
  return differs(segs) || (/\.md$/i.test(last) && differs([...segs.slice(0, -1), last.replace(/\.md$/i, "")]));
}

/**
 * 토큰 하나의 "노드 → 권한" 표. 가장 구체적인(가장 긴) 경로 규칙이 이긴다. 규칙이 없으면 숨김.
 * 노드 모델(형제 방식 `X.md` + `X/`)이라 규칙 `X`는 하위 `X/…`와 함께 노드 노트 `X.md`도 덮는다
 * (숨김 노드의 노트가 상위 규칙으로 보이지 않게).
 *
 * 규칙과 경로는 둘 다 NFC 로 맞춘 뒤 견준다. 같은 이름이 디스크에는 NFD 로(macOS 에서 만든 볼트), 규칙에는 NFC 로 적혀 있을 수
 * 있고, 정규화를 가리지 않는 볼륨은 어느 형태로 온 요청이든 같은 파일을 연다 — 글자 그대로 견주면 숨김 규칙을 비켜 간다.
 * 대소문자는 여기서 접지 않는다: 디스크의 철자와 다른 경로는 Vault 가 없는 경로로 다룬다(Vault.spelledAsOnDisk).
 */
export class AccessPolicy {
  private rules: [string, Level][];

  constructor(rules: Record<string, Level>) {
    this.rules = Object.entries(rules)
      .map(([k, v]) => [normalizeRulePath(k), v] as [string, Level])
      .sort((a, b) => b[0].length - a[0].length);
  }

  level(relPath: string): Level {
    const p = relPath.normalize("NFC");
    for (const [prefix, level] of this.rules) {
      if (prefix === "" || p === prefix || p.startsWith(prefix + "/") || p === prefix + ".md") return level;
    }
    return "hidden";
  }

  /** 이 경로가 대소문자만 다르게 적은(respells) 규칙들 가운데 가장 엄한 단계. 그런 규칙이 없으면 null */
  respelledLevel(relPath: string): Level | null {
    let strictest: Level | null = null;
    for (const [prefix, level] of this.rules) {
      if ((strictest === null || !atLeast(level, strictest)) && respells(relPath, prefix)) strictest = level;
    }
    return strictest;
  }

  /**
   * 아직 없는 경로를 만들 때의 단계: 글자로 맞는 규칙(level)과, 대소문자만 다르게 적은 규칙들 가운데 가장 엄한 쪽.
   * 숨김 규칙 `Secret` 이 있으면 `secret/a.md` 를 만드는 것은 숨김으로 판정한다(이름 선점 — respells). 볼륨이 대소문자를 가리는지는
   * 재지 않는다: 가리는 볼륨에서는 다른 폴더인데도 함께 막힌다. 읽기와 이미 있는 문서의 수정은 level 그대로다
   */
  createLevel(relPath: string): Level {
    const level = this.level(relPath);
    const respelled = this.respelledLevel(relPath);
    return respelled !== null && !atLeast(respelled, level) ? respelled : level;
  }

  /** 이 폴더 아래 어딘가에 보이는 경로가 있을 수 있는지(폴더 자체는 숨김이어도 하위 규칙이 열어 줄 때). */
  mayContainVisible(dirPath: string): boolean {
    if (atLeast(this.level(dirPath), "read")) return true;
    const dir = dirPath.normalize("NFC");
    return this.rules.some(([prefix, level]) => prefix.startsWith(dir + "/") && atLeast(level, "read"));
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
