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
 * 노트 하나만 띄운 창(solo)은 동기화를 돌리지 않으므로 열지 않는다.
 * 주소가 노트여도 연다 — 연결 전의 빈 볼트에서 그 노트는 「없음」으로 열리고, 설치한 웹 앱은 설치 때 주소(노트)로 시작하기도 한다.
 * 그 노트로는 동기화 화면을 닫을 때 돌아간다(syncSetupState).
 */
export function needsSyncSetup(m: { kind: "app" | "browser"; solo: boolean; connected: boolean }): boolean {
  return m.kind === "browser" && !m.solo && !m.connected;
}

/** 주소(location.hash)가 가리키는 노트 경로. 비었거나 설정 등 ":" 로 시작하는 화면이면 null */
export function notePathOfHash(hash: string): string | null {
  const h = decodeURIComponent(hash.replace(/^#\/?/, ""));
  if (h.startsWith(":")) return null;
  return h || null;
}

/** 동기화 화면으로 바꿔 연 주소의 history.state: 닫으면 돌아갈 노트(원래 주소) */
export function syncSetupState(hash: string): { back: string } | null {
  const back = notePathOfHash(hash);
  return back ? { back } : null;
}

/** history.state 에서 설정을 닫으면 돌아갈 노트를 읽는다 */
export function settingsBack(state: unknown): string | null {
  const back = (state as { back?: unknown } | null | undefined)?.back;
  return typeof back === "string" && back ? back : null;
}
