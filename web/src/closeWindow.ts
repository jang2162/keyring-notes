/**
 * 「창 닫기」(Mod+Shift+W): 데스크톱 앱에만 둔다. 웹은 브라우저가 Mod+Shift+W 를 먼저 가져가고, window.close() 도 스크립트로 연
 * 창에만 먹는다. 모바일 앱은 창이 하나다.
 * 창은 창 닫기 단추와 같은 길(Tauri 의 close — CloseRequested 를 거친다. destroy 는 건너뛴다)로 닫으므로, 마지막 창에서 앱이
 * 끝나는 것까지 단추와 같다. macOS 기본 메뉴(Tauri 가 넣는다)의 Close Window 는 Cmd+W 라 이 키와 겹치지 않는다
 */
import { isTauri } from "@tauri-apps/api/core";
import type { Command } from "./shortcuts";

/** 이 창에 「창 닫기」를 둘 수 있는가: 데스크톱 앱(주 창·새 창 모두) */
export const canCloseWindow = (app = isTauri(), ua = navigator.userAgent): boolean => app && !/Android|iPhone|iPad/.test(ua);

/** 명령 목록에 넣을 「창 닫기」. 둘 수 없는 곳이면 빈 목록(팔레트·단축키 설정에도 안 나온다) */
export function closeWindowCommands(desktop: boolean, c: Pick<Command, "group" | "label" | "run">): Command[] {
  return desktop ? [{ id: "close-window", keys: "Mod+Shift+W", ...c }] : [];
}

export interface CloseWindowSteps {
  /** 저장 안 한 문서 경로 */
  dirty: () => string[];
  /** 저장 시도(자동 저장을 껐으면 하지 않는다) */
  flush: () => Promise<unknown>;
  /** 그래도 남은 문서를 버리고 닫을지 묻는다 */
  confirm: (paths: string[]) => Promise<boolean>;
  close: () => Promise<void>;
}

/** 탭 닫기와 같은 원칙: 먼저 저장해 보고, 남은 변경이 있으면 묻는다. 취소하면 닫지 않고 false */
export async function closeWindowSafely(s: CloseWindowSteps): Promise<boolean> {
  if (s.dirty().length) {
    await s.flush();
    const left = s.dirty();
    if (left.length && !(await s.confirm(left))) return false;
  }
  await s.close();
  return true;
}

/** 지금 창을 창 닫기 단추와 같은 길로 닫는다(capabilities 의 core:window:allow-close) */
export async function closeCurrentWindow(): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
