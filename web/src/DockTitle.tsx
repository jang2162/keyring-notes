import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { PanelLeft } from "lucide-react";
import { IconButton } from "./ui";
import { overlayTitleBar } from "./topbar";

/** 이 창이 제목 표시줄 없이 신호등을 콘텐츠 위에 얹었는가(창마다 같다) */
export const OVERLAY_TITLE = overlayTitleBar({ tauri: isTauri(), userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints });

/**
 * 창 끌기 영역 표시. 「deep」 은 그 아래 어디를 눌러도 창을 끈다 — 단추·탭(role="tab")처럼 누르는 것은 Tauri 가 알아서 뺀다.
 * 끌기·두 번 눌러 확대에는 capabilities 의 core:window:allow-start-dragging·allow-internal-toggle-maximize 가 있어야 한다
 */
export const DRAG_REGION = OVERLAY_TITLE ? ({ "data-tauri-drag-region": "deep" } as const) : {};

/** 전체 화면에서는 신호등이 사라지므로 그 자리를 비우지 않는다 */
function useFullscreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!OVERLAY_TITLE) return;
    let alive = true;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      const check = () =>
        void w
          .isFullscreen()
          .then((f) => alive && setFull(f))
          .catch(() => {});
      check();
      const un = await w.onResized(check);
      if (alive) off = un;
      else un();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return full;
}

/**
 * 창 맨 위 첫 줄의 왼쪽 칸: 신호등 자리 · 앱 이름 · 사이드바 토글. 오른쪽은 탭 줄이 잇는다.
 * 사이드바를 접으면 내용 너비로 줄어 레일보다 넓으므로 맨 위 왼쪽 칸의 탭 줄 위에 걸친다 — 걸친 폭을 onOverhang 으로 알려
 * 그 탭 줄이 그만큼 비켜 앉게 한다(styles.css 의 .left-closed)
 */
export function DockTitle({
  open,
  label,
  keys,
  onToggle,
  onOverhang,
}: {
  open: boolean;
  label: string;
  keys?: string;
  onToggle: () => void;
  onOverhang: (px: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const full = useFullscreen();
  const lights = OVERLAY_TITLE && !full;

  useLayoutEffect(() => {
    const el = ref.current;
    const dock = el?.parentElement;
    if (!el || !dock) return;
    const measure = () => onOverhang(open ? 0 : Math.max(0, Math.ceil(el.offsetWidth - dock.offsetWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [open, lights, onOverhang]);

  return (
    <div ref={ref} className={`dock-title${lights ? " with-lights" : ""}`} {...DRAG_REGION}>
      <span className="dock-app">Keyring Notes</span>
      <IconButton className="dock-toggle" icon={PanelLeft} label={label} keys={keys} active={open} side="bottom" size={16} onClick={onToggle} />
    </div>
  );
}
