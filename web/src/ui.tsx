import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { formatCombo } from "./shortcuts";

/** 아이콘 버튼. 툴팁에 단축키를 붙인다 */
export function IconButton({
  icon: Icon,
  label,
  keys,
  onClick,
  active,
  disabled,
  badge,
  className,
  size = 18,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  badge?: number | string;
  className?: string;
  size?: number;
}) {
  const tip = keys ? `${label} (${formatCombo(keys)})` : label;
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      title={tip}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={size} strokeWidth={1.75} aria-hidden />
      {badge !== undefined && badge !== 0 && badge !== "" && <span className="icon-badge">{badge}</span>}
    </button>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  keys?: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}
export type MenuEntry = MenuItem | "-";

/**
 * 띄우는 메뉴(⋯ 메뉴·오른쪽 클릭 메뉴). at: 화면 좌표. ↑↓ Enter Esc로 다룬다.
 */
export function Menu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [sel, setSel] = useState(-1);
  const actions = items.map((it, i) => ({ it, i })).filter((x): x is { it: MenuItem; i: number } => x.it !== "-" && !x.it.disabled);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
    el.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const blur = () => onClose();
    window.addEventListener("mousedown", down, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [onClose]);

  const run = (it: MenuItem) => {
    onClose();
    it.run();
  };

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        const at = actions.findIndex((a) => a.i === sel);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSel(actions[(at + 1) % actions.length]?.i ?? -1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSel(actions[(at - 1 + actions.length) % actions.length]?.i ?? -1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const a = actions[at];
          if (a) run(a.it);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {items.map((it, i) =>
        it === "-" ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item${it.danger ? " danger" : ""}${sel === i ? " on" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => setSel(i)}
            onClick={() => run(it)}
          >
            <span className="menu-icon">{it.icon && <it.icon size={15} strokeWidth={1.75} aria-hidden />}</span>
            <span className="menu-label">{it.label}</span>
            {it.keys && <kbd className="menu-keys">{formatCombo(it.keys)}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/**
 * 끌어서 폭을 바꾸는 경계. side: 패널이 경계의 어느 쪽에 있는지(left면 오른쪽으로 끌수록 넓어진다).
 * 두 번 누르면 기본 폭.
 */
export function Resizer({ side, width, min, max, onChange, onReset, label }: { side: "left" | "right"; width: number; min: number; max: number; onChange: (w: number) => void; onReset: () => void; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className={`resizer resizer-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const dir = side === "left" ? 1 : -1;
        if (e.key === "ArrowRight") onChange(Math.min(max, Math.max(min, width + step * dir)));
        else if (e.key === "ArrowLeft") onChange(Math.min(max, Math.max(min, width - step * dir)));
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onChange(Math.round(Math.min(max, Math.max(min, start.current.w + (side === "left" ? dx : -dx)))));
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove("resizing");
      }}
    />
  );
}

/** 오른쪽 패널 등에서 쓰는 작은 탭 줄 */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} title={o.title} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
