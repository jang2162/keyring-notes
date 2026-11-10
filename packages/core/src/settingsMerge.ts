import { compareSemver } from "./marketFormat.js";

/**
 * 공통 설정 파일(keyring-settings.md)의 키 단위 3방향 합치기. 동기화가 이 파일만은 줄 단위 병합·충돌 사본 대신 이것을 쓴다.
 *
 * 값(잎) 하나씩 기준점 B·기기 L·서버 S를 비교한다. 객체는 키로 내려가고(빈 객체는 값이 없는 것), 목록·글자·숫자는 잎이다.
 *   L = S          → 그 값
 *   한쪽만 바뀜     → 바뀐 쪽
 *   둘 다 다르게    → 서버 값. 기기 값이 있었으면 conflicts에 남겨 화면이 "이 기기에서만 다르게"로 남길지 묻는다
 * 기준점이 없으면(처음 연결) 모든 키가 "둘 다 바뀜"으로 간주된다(한쪽에만 있는 키는 그쪽 값).
 *
 * 원자 키(isAtomicSettingsKey — 마켓 잠금 항목 하나)는 통째로 잎 하나다. 값마다 합치면 두 기기의 동시 업데이트에서
 * 한쪽 version 과 다른 쪽 sha256 이 섞인다. 둘 다 바뀌면 정해진 규칙으로 풀고 conflicts 에 넣지 않는다:
 *   둘 다 있음 → 판이 높은 쪽(같으면 서버)   한쪽이 지움 → 바꾼 쪽(업데이트가 이긴다 — 사용자 결정, 마켓 설계 「설정과 잠금」)
 */
export interface SettingsKeyConflict {
  key: string[];
  local: unknown;
  server: unknown;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** ["marketplace", "packages", <id>] — 통째로 합치는 잎 */
export function isAtomicSettingsKey(key: string[]): boolean {
  return key.length === 3 && key[0] === "marketplace" && key[1] === "packages";
}

/** 키를 정렬해 직렬화 — 사람이 항목 안 키 순서만 바꾼 것을 「바꿈」 으로 읽어 다른 쪽의 제거를 되살리지 않게(원자 키에만 쓴다) */
function canonical(v: unknown): string | undefined {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : isObj(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, sort(x[k])]),
          )
        : x;
  return JSON.stringify(sort(v));
}

const versionOf = (v: unknown) => (isObj(v) && typeof v.version === "string" ? v.version : "");

/** 잎 값들: "a\0b\0c" → 값 */
function leaves(o: Obj | null | undefined, prefix: string[] = [], out = new Map<string, { key: string[]; value: unknown }>()) {
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    const key = [...prefix, k];
    if (isAtomicSettingsKey(key) || !isObj(v)) out.set(key.join("\0"), { key, value: v });
    // 빈 묶음은 값이 아니다 — 잎으로 두면 `packages: {}` 를 쓴 쪽이 다른 쪽의 그 아래 키를 통째로 덮는다
    else leaves(v, key, out);
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function setIn(o: Obj, key: string[], value: unknown) {
  let cur = o;
  for (const k of key.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Obj;
  }
  cur[key[key.length - 1]] = value;
}

function deleteIn(o: Obj, key: string[]) {
  const stack: Obj[] = [o];
  let cur = o;
  for (const k of key.slice(0, -1)) {
    if (!isObj(cur[k])) return;
    cur = cur[k] as Obj;
    stack.push(cur);
  }
  delete cur[key[key.length - 1]];
  // 비게 된 묶음도 지운다
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]).length > 0) break;
    delete stack[i - 1][key[i - 1]];
  }
}

export function mergeSettingsObjects(base: Obj | null, local: Obj, server: Obj): { merged: Obj; conflicts: SettingsKeyConflict[] } {
  const B = leaves(base);
  const L = leaves(local);
  const S = leaves(server);
  const merged: Obj = JSON.parse(JSON.stringify(server));
  const conflicts: SettingsKeyConflict[] = [];
  const keys = new Set([...L.keys(), ...S.keys(), ...B.keys()]);
  for (const id of keys) {
    const key = (L.get(id) ?? S.get(id) ?? B.get(id))!.key;
    const b = B.get(id)?.value;
    const l = L.get(id)?.value;
    const s = S.get(id)?.value;
    const eq = isAtomicSettingsKey(key) ? (x: unknown, y: unknown) => canonical(x) === canonical(y) : same;
    if (eq(l, s)) continue;
    const localChanged = !eq(l, b) || !base;
    const serverChanged = !eq(s, b) || !base;
    if (base && !serverChanged) {
      // 기기만 바꿨다
      if (l === undefined) deleteIn(merged, key);
      else setIn(merged, key, l);
      continue;
    }
    if (!base && s === undefined) {
      // 처음 연결: 기기에만 있는 값
      setIn(merged, key, l);
      continue;
    }
    if (isAtomicSettingsKey(key)) {
      if (!localChanged) continue;
      // 둘 다 바뀜(또는 기준 없음): 한쪽이 지웠으면 남은 쪽, 둘 다 있으면 판이 높은 쪽(같으면 서버 — merged 가 이미 서버 값)
      if (s === undefined || (l !== undefined && compareSemver(versionOf(l), versionOf(s)) > 0)) setIn(merged, key, l);
      continue;
    }
    if (localChanged && l !== undefined) conflicts.push({ key, local: l, server: s });
  }
  return { merged, conflicts };
}
