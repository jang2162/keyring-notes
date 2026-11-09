import type { TrashItem } from "@keyring-notes/core";

/**
 * 휴지통 줄의 머리 이름: 노드, 없으면 첫 노트(.md 없이). 첨부만 지운 줄(첨부 하나 삭제 등)은 노드가 있어도 첫 첨부 —
 * 노드 폴더 안의 첨부만 지웠는데 노드 이름을 보이면 노트를 지운 것처럼 읽힌다
 */
export function trashHeadName(item: TrashItem): string {
  if (item.notes.length === 0) return item.attachments[0] ?? item.node ?? "";
  return item.node ?? item.notes[0].replace(/\.md$/i, "");
}

/** 머리 말고 더 있는 것(「외 N개」 로 보인다). 노드 줄은 하위 수를 따로 보이므로 0 */
export function trashOthers(item: TrashItem): number {
  if (item.notes.length === 0) return Math.max(item.attachments.length - 1, 0);
  return item.node ? 0 : item.notes.length - 1;
}
