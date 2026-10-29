/**
 * 브라우저를 서버 모드로 열지 로컬 모드(IndexedDB 볼트 + 서버 동기화)로 열지 정한다.
 * 판정(startsLocal)은 순수 함수이고, 브라우저 상태를 읽어 넘기는 것은 boot.ts 의 wantsLocal 이다.
 */

/** 사람이 고른 모드. 고른 적이 없으면 null */
export type ModeChoice = "local" | "server" | null;

export interface ModeInput {
  /** 데스크톱·모바일 앱(Tauri) */
  tauri: boolean;
  /** 홈 화면에 설치한 웹 앱으로 열렸다(display-mode: standalone) */
  installed: boolean;
  /** 이번 주소의 `?local`(local)·`?local=0`(server). 없으면 null */
  query: ModeChoice;
  /** 이 브라우저에 기억한 선택 */
  stored: ModeChoice;
  /** 서버 모드의 오프라인 대기열에 보낼 것이 남았다. 모르면(읽지 못함) true 로 준다 */
  pendingOutbox: boolean;
}

/**
 * 로컬 모드로 시작할지.
 * - 앱은 늘 로컬.
 * - 고른 것(주소 > 기억)은 설치 여부와 상관없이 이긴다.
 * - 고른 적 없는 설치한 웹 앱은 로컬. 단 서버 모드 대기열이 남아 있으면 이번에는 서버 모드 —
 *   로컬 볼트는 그 대기열을 보내지 않으므로 대기분이 먼저 서버로 가야 한다. 비면 다음 실행부터 로컬.
 */
export function startsLocal(m: ModeInput): boolean {
  if (m.tauri) return true;
  const choice = m.query ?? m.stored;
  if (choice) return choice === "local";
  return m.installed && !m.pendingOutbox;
}

/** 주소의 `?local` 을 읽는다. `?local=0` 만 서버 모드다 */
export function queryChoice(search: string): ModeChoice {
  const q = new URLSearchParams(search);
  if (!q.has("local")) return null;
  return q.get("local") === "0" ? "server" : "local";
}

/** 기억한 값을 읽는다. 모르는 값은 고른 적 없는 것으로 본다 */
export function storedChoice(v: string | null): ModeChoice {
  return v === "local" || v === "server" ? v : null;
}

/**
 * 처음 화면으로 동기화 연결(설정 「이 기기·동기화」)을 열지: 브라우저 로컬 볼트인데 서버 동기화가 없을 때.
 * 노트 하나만 띄운 창(solo)은 동기화를 돌리지 않으므로 열지 않고, 주소가 노트·설정을 가리키면 그쪽이 먼저다.
 */
export function needsSyncSetup(m: { kind: "app" | "browser"; solo: boolean; connected: boolean; hash: string }): boolean {
  return m.kind === "browser" && !m.solo && !m.connected && (m.hash === "" || m.hash === "#");
}
