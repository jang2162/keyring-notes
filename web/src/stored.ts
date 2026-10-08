/**
 * 이 기기 저장값(localStorage JSON) 읽기. 저장 형식이 버전 사이에 바뀌어도(예: 탭 목록 배열 → 워크스페이스별 묶음)
 * 모양이 맞지 않는 값은 버리고 기본값으로 시작해, 남은 예전 값 때문에 화면 전체가 멈추지 않게 한다.
 */
export function readStored<T>(raw: string | null, initial: T, valid: (v: unknown) => v is T): T {
  if (raw === null) return initial;
  try {
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : initial;
  } catch {
    return initial;
  }
}

export const isString = (v: unknown): v is string => typeof v === "string";

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

/** 값이 모두 check를 통과하는 일반 객체(배열·null 아님) */
export const isRecordOf =
  <T>(check: (v: unknown) => v is T) =>
  (v: unknown): v is Record<string, T> =>
    typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(check);
