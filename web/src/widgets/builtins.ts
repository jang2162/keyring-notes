import { ddayDef } from "./ddayModel";
import { findWidget, registerWidget } from "./registry";

/** 앱과 함께 빌드된 위젯. 그리는 코드는 import() 로 처음 쓸 때 불러온다(크기 기준은 widgetBudget.ts) */
export function registerBuiltins(): void {
  // 개발 모드 핫 리로드로 두 번 불려도 같은 id 등록 오류를 내지 않게
  if (findWidget(ddayDef.id)) return;
  registerWidget({ def: ddayDef, builtIn: true, messages: "kw.dday", load: () => import("./inline/dday") });
  // 개발 서버에서만: 같은 D-day 를 iframe 연결로 — 두 연결의 동작을 화면에서 견준다(iframe 안에는 앱 CSS 가 없어 모양은 다르다)
  if (import.meta.env.DEV)
    registerWidget({
      def: { ...ddayDef, id: "keyring/dday-frame", isolation: "frame", title: { en: "D-day (iframe, dev)", ko: "D-day (iframe, 개발)" } },
      builtIn: true,
      messages: "kw.dday",
      frame: async () => {
        const frames = (await import("virtual:widget-frames")).default;
        return { kind: "url", js: frames.dday!.js };
      },
    });
}
