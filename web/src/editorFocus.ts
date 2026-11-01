/** 노트를 열 때 편집기에 포커스를 줄지. 터치에서는 주지 않는다(화면 키보드가 올라오지 않게) — 새 노트는 제목 칸 포커스가 따로 맡는다 */
export function editorAutoFocus(o: { touch: boolean; focused: boolean }): boolean {
  return o.focused && !o.touch;
}
