import { removePdfAnnotation, setFrontmatterField, type PdfAnnotation } from "@keyring-notes/core";
import { confirmDialog } from "./dialog";
import { t } from "./i18n";
import { editCompanion, type CompanionTarget } from "./pdfCompanion";
import { resetDevicePrefs } from "./prefs";

/**
 * 한 번에 되돌릴 수 없게 지우는 단추는 먼저 묻는다. 데스크톱 앱(macOS)은 뒤에 있는 창을 누른 첫 클릭도
 * 단추에 닿으므로(`soloWindow.ts` 의 acceptFirstMouse), 다른 앱에서 돌아오며 무심코 누른 클릭이 곧바로 지우지 않게 한다.
 * 취소하면 아무것도 고치지 않는다 — `firstMouse.test.ts` 가 확인·취소 두 길을 본다.
 */

/** PDF 주석 목록의 「삭제」: 짝 노트에서 그 주석을 뺀다 */
export async function removeAnnotation(to: CompanionTarget, a: PdfAnnotation) {
  if (!(await confirmDialog(t("pdf.removeAsk", { page: a.page }), t("common.delete")))) return;
  await editCompanion(to, (c) => removePdfAnnotation(c, a.id));
}

/** 속성 행의 「×」: 프런트매터에서 그 필드를 지운다. apply 는 Properties 의 고치기(오류는 거기서 보인다) */
export async function removeProperty(key: string, apply: (fn: (content: string) => string) => void) {
  if (await confirmDialog(t("props.removeAsk", { key }), t("common.delete"))) apply((c) => setFrontmatterField(c, key, null));
}

/** 설정의 「이 기기 설정 초기화」: 패널 폭·트리 상태·이 기기만 덮어쓴 값을 지운다(localStorage 라 되살릴 수 없다) */
export async function resetDevice() {
  if (await confirmDialog(t("settings.resetDeviceAsk"), t("common.reset"))) resetDevicePrefs();
}
