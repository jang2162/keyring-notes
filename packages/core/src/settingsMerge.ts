/**
 * 공통 설정 파일(keyring-settings.md)의 키 단위 3방향 합치기. 동기화가 이 파일만은 줄 단위 병합·충돌 사본 대신 이것을 쓴다.
 *
 * 값(잎) 하나씩 기준점 B·기기 L·서버 S를 비교한다. 객체는 키로 내려가고, 목록·글자·숫자는 잎이다.
 *   L = S          → 그 값
 *   한쪽만 바뀜     → 바뀐 쪽
 *   둘 다 다르게    → 서버 값. 기기 값이 있었으면 conflicts에 남겨 화면이 "이 기기에서만 다르게"로 남길지 묻는다
 * 기준점이 없으면(처음 연결) 모든 키가 "둘 다 바뀜"으로 간주된다(한쪽에만 있는 키는 그쪽 값).
 */
export interface SettingsKeyConflict {
  key: string[];
  local: unknown;
  server: unknown;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** 잎 값들: "a\0b\0c" → 값 */
function leaves(o: Obj | null | undefined, prefix: string[] = [], out = new Map<string, { key: string[]; value: unknown }>()) {
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) {
    const key = [...prefix, k];
    if (isObj(v) && Object.keys(v).length > 0) leaves(v, key, out);
    else out.set(key.join("\0"), { key, value: v });
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
    if (same(l, s)) continue;
    const localChanged = !same(l, b) || !base;
    const serverChanged = !same(s, b) || !base;
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
    if (localChanged && l !== undefined) conflicts.push({ key, local: l, server: s });
  }
  return { merged, conflicts };
}
