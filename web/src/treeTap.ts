/**
 * 노트 행을 눌렀을 때 할 일. 화살표는 늘 펴고 접기. Mod(⌘·Ctrl)를 누른 채면 늘 연다.
 * 폴더로 쓰는 노트(folder)는 펼 것이 있으면 이름을 눌러도 펴고 접는다(마우스·터치·Enter 모두). 펼 것이 없으면 연다 —
 * 아무 일도 안 하면 고장으로 보인다.
 * 그 밖에는 터치에서 하위가 있는 노트의 행이 펴고 접고(여는 것은 오른쪽 열기 단추), 마우스에서는 이름 = 열기.
 * 노트가 없는 행(워크스페이스 최상위)에는 쓰지 않는다
 */
export function nodeTap(o: { touch: boolean; canExpand: boolean; hasNote: boolean; onChevron: boolean; folder?: boolean; mod?: boolean }): "toggle" | "open" {
  if (o.onChevron) return "toggle";
  if (o.mod) return "open";
  if (o.folder && o.canExpand) return "toggle";
  return o.touch && o.canExpand && o.hasNote ? "toggle" : "open";
}

/** 행 오른쪽 끝의 열기 단추 — 터치에서 하위가 있는 노트에만(폴더로 쓰는 노트도 이 단추로 연다) */
export function showOpenButton(o: { touch: boolean; canExpand: boolean; hasNote: boolean }): boolean {
  return o.touch && o.canExpand && o.hasNote;
}
