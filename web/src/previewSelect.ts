import { eventCombo, inEditable } from "./shortcuts";

/**
 * 미리보기에서 전체 선택(Mod+A)을 가져올지. 미리보기는 포커스를 받지 않아, 본문을 누르면 포커스가 칸(section.split-pane, tabIndex -1)에,
 * 아무것도 누르지 않았으면 body 에 있다. 둘 다 미리보기 칸의 조상이고, 브라우저 기본 전체 선택은 트리·제목·오른쪽 속성 패널·상태 줄까지
 * 페이지 전체를 잡는다. 입력칸(속성 편집 칸·위젯 입력·제목·검색)과 편집기의 Mod+A 는 그 칸의 것이다.
 * 포커스가 미리보기 바깥의 다른 요소(사이드바·탭 줄 단추 등)에 있으면 그 자리의 기본 동작을 지킨다
 */
export function takesPreviewSelectAll(
  e: Pick<KeyboardEvent, "key" | "code" | "keyCode" | "isComposing" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">,
  pane: Node | null,
): boolean {
  if (!pane || eventCombo(e as KeyboardEvent) !== "Mod+A" || inEditable(e.target)) return false;
  const target = e.target as Node | null;
  return !!target && (target.contains(pane) || pane.contains(target));
}

/** 미리보기 본문만 고른다. 「문서 위에 속성 보기」 로 그린 프런트매터(pre.frontmatter)는 뺀다 */
export function selectPreviewBody(root: HTMLElement): void {
  const sel = root.ownerDocument.getSelection();
  if (!sel) return;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  const fm = root.querySelector(":scope > pre.frontmatter");
  if (fm) range.setStartAfter(fm);
  sel.removeAllRanges();
  sel.addRange(range);
}
