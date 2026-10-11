import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCombo } from "./shortcuts";

/**
 * 앱 공통 툴팁(아이콘만 있는 단추의 이름·단축키·못 쓰는 이유). 브라우저 기본 title 툴팁 대신 쓴다.
 *
 * 단추에 data 속성을 단다(tipProps): data-tip(이름), data-tip-keys(단축키), data-tip-why(비활성 이유), data-tip-side(right·bottom·top).
 * - 마우스를 올리고 약 300ms 뒤, 키보드로 포커스하면 바로 뜬다. 다른 단추로 옮겨 가면 기다리지 않고 바로 바뀐다(훑어보기).
 * - 화면 가장자리에서는 반대쪽으로 뒤집는다.
 * - 터치: 길게 누르면 뜨고, 손을 떼도 동작은 실행하지 않는다.
 * - 접근성: 이름은 단추의 aria-label, 툴팁은 aria-describedby(보이는 동안)로 잇는다.
 */
export interface TipOptions {
  label: string;
  keys?: string;
  /** 비활성일 때 못 쓰는 이유 */
  why?: string;
  side?: "right" | "bottom" | "top" | "left";
}

export function tipProps(o: TipOptions): Record<string, string> {
  const out: Record<string, string> = { "data-tip": o.label };
  if (o.keys) out["data-tip-keys"] = o.keys;
  if (o.why) out["data-tip-why"] = o.why;
  if (o.side) out["data-tip-side"] = o.side;
  return out;
}

const SHOW_DELAY = 300;
/** 이 시간 안에 다른 단추로 옮기면 바로 보인다 */
const WARM_MS = 600;
const LONG_PRESS = 500;
const TIP_ID = "app-tooltip";

interface Shown {
  el: HTMLElement;
  label: string;
  keys?: string;
  why?: string;
  side: "right" | "bottom" | "top" | "left";
}

function read(el: HTMLElement): Shown | null {
  const label = el.dataset.tip;
  if (!label) return null;
  return { el, label, keys: el.dataset.tipKeys, why: el.dataset.tipWhy, side: (el.dataset.tipSide as Shown["side"]) ?? "bottom" };
}

/** 앱 맨 위에 하나만 둔다 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHidden = useRef(0);
  const longPress = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const show = (s: Shown) => {
      clear();
      setShown(s);
    };
    const hide = () => {
      clear();
      if (shownRef.current) lastHidden.current = Date.now();
      setShown(null);
    };
    const target = (e: Event) => (e.target instanceof Element ? (e.target.closest<HTMLElement>("[data-tip]") ?? null) : null);

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = target(e);
      if (!el) return;
      if (shownRef.current?.el === el) return;
      const s = read(el);
      if (!s) return;
      const warm = !!shownRef.current || Date.now() - lastHidden.current < WARM_MS;
      clear();
      if (warm) show(s);
      else timer.current = setTimeout(() => show(read(el) ?? s), SHOW_DELAY);
    };
    const out = (e: PointerEvent) => {
      const el = target(e);
      if (!el) return;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest("[data-tip]") : null;
      if (to === el) return;
      if (shownRef.current?.el === el || timer.current) hide();
    };
    const focusIn = (e: FocusEvent) => {
      const el = target(e);
      // 키보드로 온 포커스만(마우스로 누른 단추에는 띄우지 않는다)
      if (!el || !el.matches(":focus-visible")) return;
      const s = read(el);
      if (s) show(s);
    };
    const focusOut = (e: FocusEvent) => {
      if (shownRef.current && shownRef.current.el === target(e)) hide();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") {
        hide();
        return;
      }
      const el = target(e);
      if (!el) return;
      const t = setTimeout(() => {
        if (longPress.current) longPress.current.fired = true;
        const s = read(el);
        if (s) show(s);
      }, LONG_PRESS);
      longPress.current = { el, timer: t, fired: false };
    };
    const up = () => {
      const lp = longPress.current;
      if (!lp) return;
      clearTimeout(lp.timer);
      if (lp.fired) setTimeout(() => setShown((s) => (s?.el === lp.el ? null : s)), 1500);
      // fired면 click을 막도록 잠시 남겨 둔다
      if (!lp.fired) longPress.current = null;
    };
    // 길게 눌러 툴팁을 띄웠으면 손을 뗄 때의 동작(click)은 실행하지 않는다
    const click = (e: MouseEvent) => {
      const lp = longPress.current;
      if (lp?.fired && e.target instanceof Node && lp.el.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      longPress.current = null;
    };
    const ctx = (e: MouseEvent) => {
      // 길게 누르면 뜨는 기본 메뉴가 툴팁을 가리지 않게
      if (longPress.current) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shownRef.current) hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("click", click, true);
    document.addEventListener("contextmenu", ctx, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clear();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("contextmenu", ctx, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 보이는 동안 aria-describedby로 잇는다. 단추가 사라지면 같이 숨긴다
  useEffect(() => {
    if (!shown) return;
    const el = shown.el;
    const prev = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", prev ? `${prev} ${TIP_ID}` : TIP_ID);
    const watch = setInterval(() => {
      if (!el.isConnected) setShown(null);
    }, 400);
    return () => {
      clearInterval(watch);
      if (prev) el.setAttribute("aria-describedby", prev);
      else el.removeAttribute("aria-describedby");
    };
  }, [shown]);

  return shown ? createPortal(<TipBox shown={shown} />, document.body) : null;
}

function TipBox({ shown }: { shown: Shown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: Shown["side"] } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const r = shown.el.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const place = (side: Shown["side"]) => {
      switch (side) {
        case "right":
          return { left: r.right + gap, top: r.top + r.height / 2 - h / 2 };
        case "left":
          return { left: r.left - gap - w, top: r.top + r.height / 2 - h / 2 };
        case "top":
          return { left: r.left + r.width / 2 - w / 2, top: r.top - gap - h };
        default:
          return { left: r.left + r.width / 2 - w / 2, top: r.bottom + gap };
      }
    };
    const fits = (p: { left: number; top: number }) => p.left >= 4 && p.top >= 4 && p.left + w <= vw - 4 && p.top + h <= vh - 4;
    const flip: Record<Shown["side"], Shown["side"]> = { right: "left", left: "right", top: "bottom", bottom: "top" };
    let side = shown.side;
    let p = place(side);
    // 가장자리에서는 반대쪽으로
    if (!fits(p) && fits(place(flip[side]))) {
      side = flip[side];
      p = place(side);
    }
    setPos({ left: Math.max(4, Math.min(p.left, vw - w - 4)), top: Math.max(4, Math.min(p.top, vh - h - 4)), side });
  }, [shown]);
  return (
    <div
      ref={ref}
      id={TIP_ID}
      role="tooltip"
      className={`tooltip tip-${pos?.side ?? shown.side}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      <span className="tip-label">{shown.label}</span>
      {shown.keys && <kbd className="tip-keys">{formatCombo(shown.keys)}</kbd>}
      {shown.why && <span className="tip-why">{shown.why}</span>}
    </div>
  );
}
