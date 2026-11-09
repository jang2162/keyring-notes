import { eventCombo, inEditable } from "./shortcuts";

/**
 * 미리보기에서 전체 선택(Mod+A)을 가져올지. 브라우저 기본 전체 선택은 트리·제목·오른쪽 속성 패널·상태 줄까지 페이지 전체를 잡는다.
 * 미리보기는 포커스를 받지 않아 본문을 눌러도 포커스는 칸(section.split-pane)이나 body 에 있고, 트리·노트 탭·보기 탭 단추로 노트를 연
 * 직후에는 그 단추에 있다 — 어느 쪽이든 지금 칸(DocPane 이 활성 칸에서만 듣는다)의 미리보기 본문을 고른다.
 * 그 자리의 것으로 남기는 것: 입력칸·contenteditable·편집기(제목·속성 칸·위젯 입력·검색·찾기 칸, 다른 칸의 편집기 포함),
 * 대화상자·메뉴 안(설정·팔레트 등 — 미리보기는 그 뒤에 가려 있다), 열린 모달이 있을 때
 */
export function takesPreviewSelectAll(
  e: Pick<KeyboardEvent, "key" | "code" | "keyCode" | "isComposing" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">,
  pane: Node | null,
): boolean {
  if (!pane || eventCombo(e as KeyboardEvent) !== "Mod+A" || inEditable(e.target)) return false;
  const target = e.target as Element | null;
  if (!target || target.closest?.('[role="dialog"], [role="menu"], dialog')) return false;
  return !target.ownerDocument?.querySelector('[aria-modal="true"]');
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
