import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

/**
 * 토스트: 금방 끝나는 결과(저장 실패·이동 완료·링크 N곳 고침)를 잠깐 보인다.
 * 오래 가는 상태는 상태 표시줄, 문서 자체 상태(충돌·과거 버전)는 배너로.
 */
export type ToastKind = "info" | "success" | "error" | "warn";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run: () => void };
  /** ms. 0이면 닫을 때까지 */
  duration: number;
}

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<(t: ToastItem[]) => void>();
const emit = () => {
  for (const l of listeners) l(items);
};

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, opts: { kind?: ToastKind; action?: ToastItem["action"]; duration?: number } = {}): number {
  const kind = opts.kind ?? "info";
  // 같은 글이 이미 떠 있으면 하나만 둔다
  items = items.filter((t) => t.message !== message);
  const id = ++seq;
  const duration = opts.duration ?? (kind === "error" ? 8000 : opts.action ? 7000 : 4000);
  items = [...items.slice(-4), { id, kind, message, action: opts.action, duration }];
  emit();
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

/** 오류를 토스트로 */
export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), { kind: "error" });
}

const ICON = { info: Info, success: CircleCheck, error: CircleAlert, warn: CircleAlert };

export function Toasts() {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : undefined}>
            <Icon size={16} aria-hidden className="toast-icon" />
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  dismissToast(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn toast-close" aria-label="닫기" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
