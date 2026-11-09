import { render } from "../inline/dday";

/** 개발 빌드에서만 싣는 `keyring/dday-frame` — 같은 D-day 를 iframe 연결로 돌려 두 연결의 동작을 화면에서 견준다(모양은 앱 CSS 가 없어 다르다) */
window.keyringWidgetRegister?.(render);
