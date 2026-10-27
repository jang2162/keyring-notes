/**
 * 창 닫기(데스크톱 앱). 닫는 길은 모두 Tauri 의 닫기 요청(CloseRequested) 하나로 모인다: 창 닫기 단추, OS 의 창 닫기(Alt+F4),
 * 「창 닫기」 명령(Mod+Shift+W)과 메뉴의 Close Window, 메뉴의 Quit(Cmd+Q. 앱이 창마다 차례로 닫기를 요청한다 — app/src-tauri/src/close_guard.rs).
 * 막을지는 앱(app/src-tauri/src/close_guard.rs)이 정한다: 화면은 저장 안 한 변경이 생기고 없어질 때 「지킴」을 켜고 끄고(setCloseGuard),
 * 지킴이 켜진 창에 닫기 요청이 오면 앱이 막고 물음을 요청한다(close-ask). 화면이 답하지 않으면 앱이 OS 대화상자로 묻는다.
 * 업데이트 설치 뒤 다시 시작도 창마다 같은 물음을 거친다(restartAfterClosing).
 * 앱(WKWebView)에서는 beforeunload 가 돌지 않으므로 이 물음이 유일한 안전장치다.
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

/**
 * 창 닫기 물음 동안 자동 저장을 멈출 표시. 묻는 동안(asking)과 닫기로 정한 뒤 창이 사라질 때까지(closing) 자동 저장 타이머·창 blur·
 * 숨김·편집기 이탈 저장이 돌지 않게 한다 — 「저장하지 않고 닫기」를 고를 수 있고, 고른 뒤에 저장되면 버린 초안이 남는다
 */
export interface SaveHold {
  asking: boolean;
  closing: boolean;
}

/** 자동 저장(타이머·이탈 저장)을 지금 하지 말아야 하는가 */
export const savesHeld = (h: SaveHold): boolean => h.asking || h.closing;

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
  /** 자동 저장을 멈출 표시(위 SaveHold). closeWindowSafely 가 켜고 끈다 */
  hold: SaveHold;
  /** 걸려 있는 자동 저장 타이머를 지운다(닫기 직전) */
  dropPending: () => void;
}

/**
 * 저장 안 한 변경이 있으면 자동 저장이 켜져 있어도 먼저 묻는다(묻지 않고 버리지도, 몰래 저장하지도 않는다).
 * 저장하고 닫기는 다 저장됐을 때만 닫는다. 닫기로 정하면 창이 사라질 때까지 자동 저장을 멈추고 걸린 타이머를 지운다. 닫았으면 true
 */
export async function closeWindowSafely(s: CloseWindowSteps): Promise<boolean> {
  const dirty = s.dirty();
  if (dirty.length) {
    s.hold.asking = true;
    let choice: CloseChoice | null;
    try {
      choice = await s.ask(dirty);
    } finally {
      s.hold.asking = false;
    }
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
  s.hold.closing = true;
  s.dropPending();
  try {
    await s.close();
  } catch (err) {
    s.hold.closing = false;
    throw err;
  }
  return true;
}

/**
 * 앱의 물음 요청(close-ask) 처리기. 먼저 받았다고 답하고(ack) — 답이 늦으면 앱이 OS 대화상자로 넘어가므로 — 새로 물어야 할 때만
 * closeWindowSafely 로 묻는다(이미 묻고 있으면 앱이 false 를 준다). 그사이 저장돼 저장 안 한 변경이 없으면 묻지 않고 닫는다.
 * 닫지 않았으면(취소·저장 실패·오류) cancelled 를 불러 앱의 차례 닫기(Quit·다시 시작)를 멈춘다
 */
export function closeAskHandler(s: CloseWindowSteps & { ack: (id: number) => Promise<boolean>; cancelled: () => void; failed: (err: unknown) => void }) {
  return async (id: number): Promise<void> => {
    if (!(await s.ack(id))) return;
    try {
      if (!(await closeWindowSafely(s))) s.cancelled();
    } catch (err) {
      s.cancelled();
      s.failed(err);
    }
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

/** 응답하지 않는 창에서 앱이 띄울 OS 대화상자의 글 */
export interface GuardText {
  message: string;
  discard: string;
  cancel: string;
}

let guardSeq = 0;

/** 이 창의 지킴을 켜거나(저장 안 한 변경이 있다. text 는 그때 언어의 OS 대화상자 글) 끈다(null). 번호로 늦게 도착한 옛 요청을 앱이 버린다 */
export async function setCloseGuard(text: GuardText | null): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_close_guard", { seq: ++guardSeq, text });
}

/** 앱이 이 창에 보내는 물음 요청(close-ask)에 처리기를 건다. 떼어 낼 함수를 돌려준다 */
export async function listenCloseAsks(handler: (id: number) => void): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().listen<number>("close-ask", (e) => handler(e.payload));
}

/** 물음 요청을 받았다고 앱에 답한다. 새로 물어야 하면 true */
export async function ackCloseAsk(id: number): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("close_ask_ack", { id });
}

/** 닫기 요청을 다시 거치지 않고 지금 창을 닫는다(capabilities 의 core:window:allow-destroy) */
export async function destroyCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().destroy();
}

/** 이 창이 닫지 않기로 했다고 앱에 알린다. 앱의 차례 닫기(Quit·다시 시작)가 진행 중이면 나머지 창을 닫지 않고 멈춘다 */
export async function cancelQuit(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_ask_done");
}

export interface RestartSteps {
  /** 누가 닫지 않기로 해 다시 시작을 멈췄다는 알림(restart-cancelled)을 받는다. 떼어 낼 함수를 돌려준다 */
  listenCancelled: (on: () => void) => Promise<() => void>;
  /** 앱에 창마다 물은 뒤 다시 시작하라고 요청한다 */
  request: () => Promise<void>;
}

/**
 * 창마다 닫기 물음을 거친 뒤 다시 시작한다(앱이 Quit 과 같은 순서로 닫는다 — 저장 안 한 초안을 묻지 않고 버리지 않는다).
 * 다 닫히면 앱이 다시 시작하므로 돌아오지 않는다. 누가 취소하면 "cancelled" 로 끝난다(다시 시작하지 않는다)
 */
export async function restartAfterClosing(s: RestartSteps = tauriRestart): Promise<"cancelled"> {
  let off: (() => void) | undefined;
  try {
    return await new Promise<"cancelled">((resolve, reject) => {
      // 알림을 놓치지 않게 요청보다 먼저 듣는다
      s.listenCancelled(() => resolve("cancelled"))
        .then((u) => {
          off = u;
          return s.request();
        })
        .catch(reject);
    });
  } finally {
    off?.();
  }
}

/** 누가 닫지 않기로 해 앱이 다시 시작을 멈췄다는 알림(restart-cancelled)을 받는다. 떼어 낼 함수를 돌려준다 */
export async function listenRestartCancelled(on: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("restart-cancelled", on);
}

const tauriRestart: RestartSteps = {
  listenCancelled: listenRestartCancelled,
  request: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("restart_after_closing");
  },
};

/** 지금 창에 닫기를 요청한다(창 닫기 단추와 같은 길: 지킴이 켜져 있으면 앱이 막고 묻게 한다. capabilities 의 core:window:allow-close) */
export async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
