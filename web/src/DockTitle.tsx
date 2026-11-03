import { useLayoutEffect, useRef } from "react";
import { PanelLeft } from "lucide-react";
import { IconButton } from "./ui";
import { DRAG_REGION, useTrafficLights } from "./windowChrome";

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
  // 여백은 CSS(--lights-w)가 바꾸지만 폭이 바뀌므로 걸친 폭을 다시 잰다
  const lights = useTrafficLights();

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
    <div ref={ref} className="dock-title" {...DRAG_REGION}>
      <span className="dock-app">Keyring Notes</span>
      <IconButton className="dock-toggle" icon={PanelLeft} label={label} keys={keys} active={open} side="bottom" size={16} onClick={onToggle} />
    </div>
  );
}
