import { ddayDef } from "./ddayModel";
import { findWidget, registerWidget } from "./registry";

/** 앱과 함께 빌드된 위젯. 그리는 코드는 import() 로 처음 쓸 때 불러온다(크기 기준은 widgetBudget.ts) */
export function registerBuiltins(): void {
  // 개발 모드 핫 리로드로 두 번 불려도 같은 id 등록 오류를 내지 않게
  if (findWidget(ddayDef.id)) return;
  registerWidget({ def: ddayDef, builtIn: true, messages: "kw.dday", load: () => import("./inline/dday") });
}
