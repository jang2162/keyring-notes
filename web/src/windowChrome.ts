import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { overlayTitleBar, trafficLightsShown } from "./topbar";

/** 이 창이 제목 표시줄 없이 신호등을 콘텐츠 위에 얹었는가(창마다 같다) */
export const OVERLAY_TITLE = overlayTitleBar({ tauri: isTauri(), userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints });

/**
 * 창 끌기 영역 표시. 「deep」 은 그 아래 어디를 눌러도 창을 끈다 — 단추·탭(role="tab")처럼 누르는 것은 Tauri 가 알아서 뺀다.
 * 끌기·두 번 눌러 확대에는 capabilities 의 core:window:allow-start-dragging·allow-internal-toggle-maximize 가 있어야 한다
 */
export const DRAG_REGION = OVERLAY_TITLE ? ({ "data-tauri-drag-region": "deep" } as const) : {};

/**
 * 값이 빈 끌기 영역 표시: 그 요소 자체를 직접 눌렀을 때만 창을 끈다(안의 글·목록을 누르면 끌지 않는다).
 * 줄이 아니라 창을 채운 바탕(좁은 화면의 홈, 창을 채운 팔레트)의 빈 자리를 끌게 할 때 쓴다
 */
export const DRAG_SELF = OVERLAY_TITLE ? ({ "data-tauri-drag-region": "" } as const) : {};

/**
 * 신호등이 지금 떠 있으면 <html> 에 붙는 클래스. styles.css 의 `:root.traffic-lights` 가 --lights-w(신호등이 차지하는 폭)를 주고,
 * 창 맨 위 왼쪽에 닿는 줄은 모두 그 값만큼 비켜 앉는다 — 신호등 자리는 이 판정 하나로만 정한다
 */
const LIGHTS_CLASS = "traffic-lights";

let fullscreen = false;
const subscribers = new Set<() => void>();
const shown = () => trafficLightsShown(OVERLAY_TITLE, fullscreen);

/** 창마다 한 번(main.tsx). 전체 화면에서는 신호등이 사라지므로 크기가 바뀔 때마다 다시 본다 */
export function watchTrafficLights() {
  document.documentElement.classList.toggle(LIGHTS_CLASS, shown());
  if (!OVERLAY_TITLE) return;
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const w = getCurrentWindow();
    const check = () =>
      void w
        .isFullscreen()
        .then((f) => {
          if (f === fullscreen) return;
          fullscreen = f;
          document.documentElement.classList.toggle(LIGHTS_CLASS, shown());
          for (const s of subscribers) s();
        })
        .catch(() => {});
    check();
    await w.onResized(check);
  });
}

const subscribe = (s: () => void) => {
  subscribers.add(s);
  return () => void subscribers.delete(s);
};

/** 신호등이 지금 떠 있는가 — 여백은 CSS 가 맞추므로, 신호등 자리에 따라 다시 재야 하는 것(DockTitle)만 쓴다 */
export const useTrafficLights = () => useSyncExternalStore(subscribe, shown);
