/**
 * 창 닫기(데스크톱 앱). 닫는 길은 모두 Tauri 의 닫기 요청(CloseRequested) 하나로 모인다: 창 닫기 단추, OS 의 창 닫기(Alt+F4),
 * 「창 닫기」 명령(Mod+Shift+W)과 메뉴의 Close Window, 메뉴의 Quit(Cmd+Q. 앱이 창마다 차례로 닫기를 요청한다 — app/src-tauri/src/lib.rs).
 * 저장 안 한 변경이 있으면 그 요청을 막고 묻는다. 앱(WKWebView)에서는 beforeunload 가 돌지 않으므로 이 물음이 유일한 안전장치다.
 * 「창 닫기」 명령은 웹에 두지 않는다: 브라우저가 Mod+Shift+W 를 먼저 가져가고, window.close() 도 스크립트로 연 창에만 먹는다.
 * 모바일 앱은 창이 하나다
 */
import { isTauri } from "@tauri-apps/api/core";
import type { Command } from "./shortcuts";

/** 이 창에 「창 닫기」를 둘 수 있는가: 데스크톱 앱(주 창·새 창 모두) */
export const canCloseWindow = (app = isTauri(), ua = navigator.userAgent): boolean => app && !/Android|iPhone|iPad/.test(ua);

/** 명령 목록에 넣을 「창 닫기」. 둘 수 없는 곳이면 빈 목록(팔레트·단축키 설정에도 안 나온다) */
export function closeWindowCommands(desktop: boolean, c: Pick<Command, "group" | "label" | "run">): Command[] {
  return desktop ? [{ id: "close-window", keys: "Mod+Shift+W", ...c }] : [];
}

/** 저장 안 한 변경이 있을 때의 답: 저장하고 닫기 / 저장하지 않고 닫기 (취소는 null) */
export type CloseChoice = "save" | "discard";

export interface CloseWindowSteps {
  /** 저장 안 한 문서 경로 */
  dirty: () => string[];
  /** 저장 안 한 문서를 들어 묻는다. 취소면 null */
  ask: (paths: string[]) => Promise<CloseChoice | null>;
  /** 자동 저장 설정과 상관없이 모두 저장해 본다 */
  save: () => Promise<unknown>;
  /** 저장하지 못한 것이 남아 닫지 않을 때 알린다 */
  unsaved: (paths: string[]) => void;
  /** 닫기 요청을 다시 거치지 않고 닫는다(destroy) */
  close: () => Promise<void>;
}

/**
 * 저장 안 한 변경이 있으면 자동 저장이 켜져 있어도 먼저 묻는다(묻지 않고 버리지도, 몰래 저장하지도 않는다).
 * 저장하고 닫기는 다 저장됐을 때만 닫는다. 닫았으면 true
 */
export async function closeWindowSafely(s: CloseWindowSteps): Promise<boolean> {
  const dirty = s.dirty();
  if (dirty.length) {
    const choice = await s.ask(dirty);
    if (!choice) return false;
    if (choice === "save") {
      await s.save();
      const left = s.dirty();
      if (left.length) {
        s.unsaved(left);
        return false;
      }
    }
  }
  await s.close();
  return true;
}

/**
 * 닫기 요청 처리기(getCurrentWindow().onCloseRequested 에 건다). 저장 안 한 변경이 없으면 막지 않는다(그대로 닫힌다).
 * 있으면 막고 closeWindowSafely 로 묻는다 — 닫기로 정해지면 close(destroy)가 이 처리기를 다시 거치지 않으므로 또 묻지 않는다.
 * 묻는 동안 또 온 요청(닫기 단추를 다시 누르기, Cmd+Q)은 막기만 해 물음이 겹쳐 뜨지 않는다.
 * 닫지 않았으면(취소·저장 실패·오류) cancelled 를 불러 앱 끝내기가 나머지 창으로 넘어가지 않게 한다
 */
export function closeRequestHandler(s: CloseWindowSteps & { cancelled: () => void; failed: (err: unknown) => void }) {
  let busy = false;
  return (e: { preventDefault: () => void }): void => {
    if (busy) return e.preventDefault();
    if (!s.dirty().length) return;
    e.preventDefault();
    busy = true;
    void closeWindowSafely(s)
      .then(
        (closed) => closed || s.cancelled(),
        (err) => {
          s.cancelled();
          s.failed(err);
        },
      )
      .finally(() => (busy = false));
  };
}

/** 물음·알림에 들 문서 이름: 셋까지는 모두 들고, 넘으면 앞의 셋만 들고 more 로 표시한다(몇 개인지는 count) */
export function unsavedSummary(paths: string[], name: (p: string) => string, shown = 3): { names: string; count: number; more: boolean } {
  return {
    names: paths
      .slice(0, shown)
      .map((p) => `"${name(p)}"`)
      .join(", "),
    count: paths.length,
    more: paths.length > shown,
  };
}

/** 이 창의 닫기 요청에 처리기를 건다. 떼어 낼 함수를 돌려준다 */
export async function listenCloseRequests(handler: (e: { preventDefault: () => void }) => void): Promise<() => void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onCloseRequested(handler);
}

/** 닫기 요청을 다시 거치지 않고 지금 창을 닫는다(capabilities 의 core:window:allow-destroy. onCloseRequested 도 막지 않은 요청을 이것으로 닫는다) */
export async function destroyCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().destroy();
}

/** 이 창이 닫지 않기로 했다고 앱에 알린다. 앱 끝내기(Cmd+Q)가 진행 중이면 나머지 창을 닫지 않고 멈춘다(app/src-tauri/src/lib.rs) */
export async function cancelQuit(): Promise<void> {
  const { emit } = await import("@tauri-apps/api/event");
  await emit("close-cancelled");
}

/** 지금 창에 닫기를 요청한다(창 닫기 단추와 같은 길: 위 처리기가 받는다. capabilities 의 core:window:allow-close) */
export async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
