import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { ApiError } from "./api";
import { t } from "./i18n";
import { KeyedError } from "@keyring-notes/core";

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
const listeners = new Set<(list: ToastItem[]) => void>();
const emit = () => {
  for (const l of listeners) l(items);
};

export function dismissToast(id: number) {
  items = items.filter((x) => x.id !== id);
  emit();
}

export function toast(message: string, opts: { kind?: ToastKind; action?: ToastItem["action"]; duration?: number } = {}): number {
  const kind = opts.kind ?? "info";
  // 같은 글이 이미 떠 있으면 하나만 둔다
  items = items.filter((x) => x.message !== message);
  const id = ++seq;
  const duration = opts.duration ?? (kind === "error" ? 8000 : opts.action ? 7000 : 4000);
  items = [...items.slice(-4), { id, kind, message, action: opts.action, duration }];
  emit();
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

/**
 * 오류를 사람이 읽을 글로: 서버 오류는 코드(code)와 끼워 넣을 값(params)을 보내므로 화면 언어로 번역한다.
 * 코드가 없는 오류(오래된 서버·네트워크 오류)는 받은 글을 그대로 보인다.
 */
export function errorText(e: unknown): string {
  if (e instanceof KeyedError) return t(`error.${e.code}`, e.params);
  if (e instanceof ApiError && e.key) {
    const msg = t(`error.${e.key}`, e.params);
    if (msg !== `error.${e.key}`) return msg;
  }
  if (e instanceof TypeError) return t("error.network");
  return e instanceof Error ? e.message : String(e);
}

/** 오류를 토스트로 */
export function toastError(e: unknown) {
  toast(errorText(e), { kind: "error" });
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
      {list.map((item) => {
        const Icon = ICON[item.kind];
        return (
          <div key={item.id} className={`toast toast-${item.kind}`} role={item.kind === "error" ? "alert" : undefined}>
            <Icon size={16} aria-hidden className="toast-icon" />
            <span className="toast-msg">{item.message}</span>
            {item.action && (
              <button
                className="toast-action"
                onClick={() => {
                  dismissToast(item.id);
                  item.action!.run();
                }}
              >
                {item.action.label}
              </button>
            )}
            <button className="icon-btn toast-close" aria-label={t("common.close")} onClick={() => dismissToast(item.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
