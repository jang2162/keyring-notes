import { eventCombo, inEditable } from "./shortcuts";

/**
 * 미리보기에서 전체 선택(Mod+A)을 가져올지. 미리보기는 포커스를 받지 않아 키가 body 로 오고, 브라우저 기본 전체 선택은
 * 트리·제목·오른쪽 속성 패널·상태 줄까지 페이지 전체를 잡는다. 입력칸(속성 편집 칸·제목·검색)과 편집기의 Mod+A 는 그 칸의 것이다.
 * 포커스가 사이드바 같은 다른 곳에 있으면 그 자리의 기본 동작을 지킨다
 */
export function takesPreviewSelectAll(
  e: Pick<KeyboardEvent, "key" | "code" | "keyCode" | "isComposing" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">,
  pane: Pick<Node, "contains"> | null,
  body: unknown,
): boolean {
  if (eventCombo(e as KeyboardEvent) !== "Mod+A" || inEditable(e.target)) return false;
  return e.target === body || !!pane?.contains(e.target as Node);
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
