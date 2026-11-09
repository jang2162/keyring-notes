/**
 * 「폴더로 쓰기」: 노트 프런트매터 `folder: true` 면 트리에서 그 노트 이름을 눌렀을 때 열지 않고 펴고 접는다.
 * 하위 노트 정렬(sort)처럼 그 노트 자신의 프런트매터에 두어 볼트를 따라 모든 기기가 같게 본다.
 * 끄면 필드를 지운다(false 를 적지 않는다).
 */
export const FOLDER_FIELD = "folder";

/** 프런트매터 folder 값 → 폴더로 쓰는지. YAML 불 true 만 켠 것으로 본다(문자열 "true"·1 은 아니다) */
export const parseFolder = (v: unknown): boolean => v === true;
