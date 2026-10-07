import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import { confirmDialog } from "./dialog";
import { keyCapture } from "./shortcuts";
import { toast } from "./toast";
import { t } from "./i18n";
import { tipProps } from "./Tooltip";

/**
 * 모달 틀 하나: 설정·그래프·변경 검토·정리 점검·원본 수집·명령 팔레트·단축키가 같이 쓴다.
 *
 * - 닫기 세 가지: 오른쪽 위 X, Esc, 배경 누르기. 닫으면 열기 전 포커스로 돌아간다.
 * - Tab은 모달 밖으로 나가지 않는다. role="dialog"·aria-modal.
 * - 처음 열 때 포커스는 모달 상자에 둔다. 바로 입력해야 하는 창(명령 팔레트·빠른 열기·원본 수집 URL)만
 *   안의 [autofocus] 입력칸에 둔다. 그래서 Esc 한 번에 닫힌다(3차 확인: 그래프 모달이 Esc 두 번에 닫히던 것).
 * - 사람이 직접 들어간 입력칸 안의 Esc는 그 칸이 먼저 쓴다(첫 Esc는 칸에서 나오기, 검색칸은 지우기).
 *   처음 열 때 자동으로 포커스한 칸은 직접 들어간 것이 아니므로 바로 닫는다. 단축키 바꾸는 중(keyCapture)에는 무시.
 *   모달 위에 다른 창(확인 창·메뉴·다른 모달)이 뜨면 Esc는 맨 위 창만 닫는다.
 * - 닫으면 안 되는 상태는 안의 화면이 useCloseGuard로 알린다:
 *   confirm(토큰을 한 번만 보여 줌·저장 안 한 입력) → "닫을까요?"를 묻고, block(복원·업로드 진행 중) → 닫지 않는다.
 * - 좁은 화면에서는 화면 전체 시트(위쪽 머리와 닫기는 늘 보임).
 */
export interface CloseGuard {
  kind: "confirm" | "block";
  reason: string;
}

interface Entry {
  guards: Map<string, CloseGuard>;
  attempt: () => Promise<boolean>;
}

const stack: Entry[] = [];

/** 맨 위 모달을 닫으려 한다(뒤로 가기 등). 지킬 것이 있으면 묻고, 닫았으면 true. 모달이 없으면 true */
export function attemptCloseTopModal(): Promise<boolean> {
  const top = stack.at(-1);
  return top ? top.attempt() : Promise.resolve(true);
}

export function modalOpen(): boolean {
  return stack.length > 0;
}

async function passGuards(guards: Iterable<CloseGuard>): Promise<boolean> {
  const list = [...guards];
  const block = list.find((g) => g.kind === "block");
  if (block) {
    toast(t("modal.blocked", { reason: block.reason }), { kind: "warn" });
    return false;
  }
  const ask = list.filter((g) => g.kind === "confirm");
  if (ask.length === 0) return true;
  return confirmDialog(`${ask.map((g) => g.reason).join("\n")}\n\n${t("modal.confirmClose")}`, t("common.close"));
}

interface ModalControl {
  setGuard: (id: string, guard: CloseGuard | null) => void;
  /** 안의 화면을 바꾸기 전(설정 묶음 바꾸기 등): 지킬 것이 있으면 묻는다 */
  confirmLeave: () => Promise<boolean>;
}

const ModalContext = createContext<ModalControl | null>(null);

/** 이 화면이 열려 있는 동안 모달을 함부로 닫지 않게 한다. null이면 풀기 */
export function useCloseGuard(guard: CloseGuard | null) {
  const ctl = useContext(ModalContext);
  const id = useId();
  const key = guard ? `${guard.kind}:${guard.reason}` : "";
  useEffect(() => {
    if (!ctl) return;
    ctl.setGuard(id, guard);
    return () => ctl.setGuard(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, id, key]);
}

export function useModalControl(): ModalControl | null {
  return useContext(ModalContext);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  label,
  onClose,
  size = "lg",
  head,
  nav,
  children,
  className,
  bodyClassName,
  maximizable = false,
  escapeFromInputs = false,
  hideHead = false,
}: {
  title: ReactNode;
  /** 스크린 리더용 이름(title이 글이 아닐 때) */
  label?: string;
  onClose: () => void;
  /** lg: 큰 창(85%, 최대 1200×860), md: 중간, sm: 작은 확인 창, palette: 위쪽 목록 */
  size?: "lg" | "md" | "sm" | "palette";
  /** 머리의 제목 옆(탭·도구) */
  head?: ReactNode;
  /** 왼쪽 목록(설정 묶음) */
  nav?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 머리에 "크게"(화면 가득) 단추 */
  maximizable?: boolean;
  /** 입력칸 안의 Esc도 바로 닫기(팔레트: 입력칸이 곧 창) */
  escapeFromInputs?: boolean;
  /** 머리 없이(팔레트). 닫기는 Esc·배경 */
  hideHead?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [max, setMax] = useState(false);
  /** 처음 열 때 자동으로 포커스한 입력칸(사람이 직접 들어간 칸이 아니다) */
  const autoFocused = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const entry = useMemo<Entry>(() => ({ guards: new Map(), attempt: async () => false }), []);
  const attempt = useCallback(async () => {
    if (!(await passGuards(entry.guards.values()))) return false;
    closeRef.current();
    return true;
  }, [entry]);
  entry.attempt = attempt;

  const control = useMemo<ModalControl>(
    () => ({
      setGuard: (id, g) => {
        if (g) entry.guards.set(id, g);
        else entry.guards.delete(id);
      },
      confirmLeave: () => passGuards(entry.guards.values()),
    }),
    [entry],
  );

  // 쌓기·포커스 되돌리기
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    stack.push(entry);
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const auto = el.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      autoFocused.current = auto;
      (auto ?? el).focus({ preventScroll: true });
    }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (prev?.isConnected) prev.focus?.({ preventScroll: true });
    };
  }, [entry]);

  // Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || keyCapture.active || e.isComposing) return;
      if (stack.at(-1) !== entry) return;
      // 모달 위에 뜬 메뉴·확인 창이 있으면 그쪽이 먼저
      if (document.querySelector(".menu") || document.querySelector(".ask-dialog")) return;
      const t = e.target as HTMLElement;
      if (!escapeFromInputs && t !== autoFocused.current && box.current?.contains(t) && t.matches?.("input, textarea, select, [contenteditable='true']")) {
        if (t instanceof HTMLInputElement && t.type === "search" && t.value) return; // 검색칸: 브라우저가 지운다
        e.preventDefault();
        t.blur();
        box.current?.focus({ preventScroll: true });
        return;
      }
      e.preventDefault();
      void attempt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, attempt, escapeFromInputs]);

  // 포커스 가두기: Tab이 모달 밖으로 나가지 않게
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // 배경 누르기: 누르고 뗀 곳이 모두 배경일 때만(글을 고르다 밖에서 놓은 것은 닫지 않는다)
  const downOnBackdrop = useRef(false);

  return createPortal(
    <ModalContext.Provider value={control}>
      <div
        className={`kmodal-backdrop kmodal-${size}${max ? " max" : ""}`}
        onMouseDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
        onClick={(e) => {
          if (e.target === e.currentTarget && downOnBackdrop.current) void attempt();
          downOnBackdrop.current = false;
        }}
      >
        <div
          ref={box}
          className={`kmodal${className ? ` ${className}` : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={label ? undefined : titleId}
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {!hideHead && (
            <div className="kmodal-head">
              <h2 id={titleId} className="kmodal-title">
                {title}
              </h2>
              <div className="kmodal-tools">{head}</div>
              {maximizable && (
                <button type="button" className="icon-btn kmodal-max" {...tipProps({ label: max ? t("modal.restoreSize") : t("modal.maximize") })} aria-label={max ? t("modal.restoreSize") : t("modal.maximize")} aria-pressed={max} onClick={() => setMax((m) => !m)}>
                  {max ? <Minimize2 size={17} strokeWidth={1.75} aria-hidden /> : <Maximize2 size={17} strokeWidth={1.75} aria-hidden />}
                </button>
              )}
              <button type="button" className="icon-btn kmodal-close" {...tipProps({ label: t("common.close"), keys: "Escape" })} aria-label={t("common.close")} onClick={() => void attempt()}>
                <X size={20} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          )}
          <div className={`kmodal-main${nav ? " with-nav" : ""}`}>
            {nav && <nav className="kmodal-nav">{nav}</nav>}
            <div className={`kmodal-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
          </div>
        </div>
      </div>
    </ModalContext.Provider>,
    document.body,
  );
}
