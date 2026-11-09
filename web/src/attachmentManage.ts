import { t } from "./i18n";

/** 확인창에 이름을 늘어놓는 노트 수(나머지는 「외 N개」) */
export const REF_LIST_MAX = 10;

/** 파일 이름의 확장자(소문자, 점 없이). 없으면 "" */
export function extOf(name: string): string {
  const base = name.split("/").pop()!;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** 교체할 파일이 그 첨부와 같은 형식인지(확장자가 같은지, 대소문자는 가리지 않는다) */
export const sameKind = (path: string, fileName: string) => extOf(path) === extOf(fileName);

/**
 * 첨부 삭제 확인 글: 묻는 말, 그 첨부를 가리키는 노트 수와 이름(위키링크·마크다운 링크·임베드 — 백링크),
 * 되살리는 길(서버는 휴지통, 기기 볼트는 알림의 되돌리기)
 */
export function attachmentDeleteText(name: string, refs: { path: string; title: string }[], local: boolean): string {
  const lines = [t("file.deleteAsk", { name }), ""];
  if (refs.length === 0) lines.push(t("file.deleteNoRefs"));
  else {
    lines.push(t("file.deleteRefs", { count: refs.length }));
    for (const r of refs.slice(0, REF_LIST_MAX)) lines.push(`• ${r.title}`);
    if (refs.length > REF_LIST_MAX) lines.push(t("trash.others", { count: refs.length - REF_LIST_MAX }));
  }
  lines.push("", local ? t("file.deleteLocal") : t("file.deleteTrash"));
  return lines.join("\n");
}
