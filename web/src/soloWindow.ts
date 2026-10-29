/**
 * 탭의 「새 창으로 열기」: 그 노트 하나만 띄운 창(`?solo`). 칸 배치를 기억하지도 읽지도 않아 원래 창의 배치를 건드리지 않는다.
 * 웹은 브라우저 팝업 창, 데스크톱 앱은 Tauri 창을 하나 더 만든다(모바일 앱은 창이 하나라 열지 않는다).
 */
import { isTauri } from "@tauri-apps/api/core";
import { appMode } from "./api";
import { soloHref } from "./local/mode";

/** 이 창이 새 창(노트 하나만)인가 */
export const SOLO = new URLSearchParams(location.search).has("solo");

/** 새 창을 열 수 있는가: 웹, 또는 데스크톱 앱 */
export const canOpenSolo = () => !isTauri() || !/Android|iPhone|iPad/.test(navigator.userAgent);

/**
 * 탭을 창 밖으로 끌어 새 창으로 떼어 낼 수 있는가: 데스크톱 앱만. 웹은 dragend 좌표가 브라우저마다 달라 창 밖을 믿을 수 없고,
 * 끌기가 끝난 뒤 여는 창은 사용자 동작이 아니라 팝업 차단에 걸린다
 */
export const canTearOut = () => isTauri() && !/Android|iPhone|iPad/.test(navigator.userAgent);

/** 그 노트 하나를 보여 줄 새 창 주소(같은 앱·같은 볼트) */
export function soloUrl(path: string): string {
  return soloHref(location.href, path, appMode.local);
}

/**
 * 새 창을 연다. 앱은 창 라벨이 `solo-*` 여야 볼트 폴더 권한이 붙는다(app/src-tauri/capabilities 의 windows).
 * 주소는 앱 안 상대 경로로 넘긴다 — Tauri 가 앱 주소(배포는 tauri://localhost, 개발은 devUrl)에 이어 붙인다.
 * 전체 주소로 넘기면 http(s) 가 아닌 배포 주소는 사용자 정의 프로토콜로, 개발 주소는 외부 주소로 갈라져 다룬다.
 * `at`(화면 논리 좌표, 앱만)을 주면 그 자리가 새 창 제목 줄에 오게 둔다 — 탭을 끌어 놓은 자리
 */
export async function openSolo(path: string, title: string, at?: { x: number; y: number }): Promise<void> {
  if (!isTauri()) {
    window.open(soloUrl(path), "_blank", "popup,width=960,height=720");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const w = new WebviewWindow(`solo-${Date.now()}`, {
    url: `index.html?solo=1#/${encodeURIComponent(path)}`,
    title,
    width: 960,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    ...(at && { x: Math.round(at.x - 160), y: Math.round(at.y - 12) }),
    // 켜 두면 Tauri 가 끌기를 가로채 탭 끌기 같은 HTML 끌어 놓기가 동작하지 않는다(메인 창은 tauri.conf.json)
    dragDropEnabled: false,
  });
  await new Promise<void>((resolve, reject) => {
    void w.once("tauri://created", () => resolve());
    void w.once<unknown>("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
}
