/**
 * 노트 행을 눌렀을 때 할 일. 터치에서는 하위가 있는 노트의 행이 펴고 접고(여는 것은 오른쪽 열기 단추),
 * 마우스에서는 화살표 = 펴고 접기, 이름 = 열기 그대로. 노트가 없는 행(워크스페이스 최상위)에는 쓰지 않는다
 */
export function nodeTap(o: { touch: boolean; canExpand: boolean; hasNote: boolean; onChevron: boolean }): "toggle" | "open" {
  if (o.onChevron) return "toggle";
  return o.touch && o.canExpand && o.hasNote ? "toggle" : "open";
}

/** 행 오른쪽 끝의 열기 단추 — 터치에서 하위가 있는 노트에만 */
export function showOpenButton(o: { touch: boolean; canExpand: boolean; hasNote: boolean }): boolean {
  return o.touch && o.canExpand && o.hasNote;
}
