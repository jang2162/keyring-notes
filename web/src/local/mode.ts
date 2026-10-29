/**
 * 브라우저를 서버 모드로 열지 로컬 모드(IndexedDB 볼트 + 서버 동기화)로 열지 정한다.
 * 판정(startsLocal·readMode)은 순수 함수이고, 브라우저 상태를 읽어 넘기는 것은 boot.ts 의 wantsLocal 이다.
 */
import { VAULT_SETTINGS_PATH } from "@keyring-notes/core";
import { SETTINGS_HASH, syncSetupState } from "../settingsNav";

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

export interface ModeEnv {
  tauri: boolean;
  /** location.search */
  search: string;
  /** 기억 키(keyring:mode)의 지금 값 */
  stored: string | null;
  installed: boolean;
  /** 서버 모드 대기열에 남은 것이 있는지. 판정을 가를 때만 부른다(IndexedDB 를 연다) */
  pending: () => Promise<boolean>;
}

/**
 * 브라우저 상태로 모드를 정한다. remember 는 기억 키에 써 넣을 선택(주소로 고른 것)이다.
 * - `?local=0` 은 지우지 않고 "server" 로 남긴다 — 설치한 웹 앱의 자동 로컬 시작이 그 선택을 덮지 않게.
 * - 새 창(`?solo`)의 `?local` 은 부모 창이 자기 모드를 실어 보낸 것이라 기억하지 않는다(soloHref).
 * - 대기열을 못 읽으면 남은 것으로 본다(서버 모드가 대기분을 보낼 기회를 잃지 않게).
 */
export async function readMode(env: ModeEnv): Promise<{ local: boolean; remember: ModeChoice }> {
  if (env.tauri) return { local: true, remember: null };
  const query = queryChoice(env.search);
  const remember = new URLSearchParams(env.search).has("solo") ? null : query;
  const stored = storedChoice(env.stored);
  let pendingOutbox = false;
  if (env.installed && !query && !stored)
    pendingOutbox = await Promise.resolve()
      .then(env.pending)
      .catch(() => true);
  return { local: startsLocal({ tauri: false, installed: env.installed, query, stored, pendingOutbox }), remember };
}

/**
 * 새 창(노트 하나만) 주소. 부모 창의 모드를 `?local` 로 실어 보낸다 — 자동으로 정한 로컬은 기억하지 않으므로,
 * 싣지 않으면 설치한 웹 앱이 연 새 창(대개 설치 앱이 아닌 브라우저 창)은 서버 모드로 열려 다른 볼트를 본다.
 */
export function soloHref(href: string, path: string, local: boolean): string {
  const u = new URL(href);
  u.searchParams.set("solo", "1");
  u.searchParams.set("local", local ? "1" : "0");
  u.hash = `#/${encodeURIComponent(path)}`;
  return u.toString();
}

/**
 * 볼트에 사람이 쓴 노트가 있는지. 볼트가 스스로 만드는 공통 설정 파일(keyring-settings.md)과
 * 위키 토픽의 자동 생성 문서(generated), 점으로 시작하는 폴더·파일 안의 것은 세지 않는다.
 */
export function hasOwnNotes(paths: string[], generated: (path: string) => boolean): boolean {
  return paths.some((p) => p !== VAULT_SETTINGS_PATH && !generated(p) && !p.split("/").some((seg) => seg.startsWith(".")));
}

/**
 * 처음 화면으로 동기화 연결(설정 「이 기기·동기화」)을 열지: 브라우저 로컬 볼트가 서버 동기화 없이 비어 있을 때.
 * 노트 하나만 띄운 창(solo)은 동기화를 돌리지 않으므로 열지 않는다. 노트가 이미 있으면 동기화 없이 쓰는 사람이라 끌고 가지 않는다.
 * 주소가 노트여도 연다 — 빈 볼트에서 그 노트는 「없음」으로 열리고, 설치한 웹 앱은 설치 때 주소(노트)로 시작하기도 한다.
 */
export function needsSyncSetup(m: { kind: "app" | "browser"; solo: boolean; connected: boolean; hasNotes: boolean }): boolean {
  return m.kind === "browser" && !m.solo && !m.connected && !m.hasNotes;
}

/** 부팅이 동기화 화면으로 주소를 바꿀지와 그 기록 항목에 남길 state(닫으면 돌아갈 노트, settingsNav.ts) */
export function syncSetupRedirect(
  m: Parameters<typeof needsSyncSetup>[0] & { hash: string; state: unknown },
): { url: string; state: { back: string } | null } | null {
  if (!needsSyncSetup(m)) return null;
  return { url: `${SETTINGS_HASH}/device`, state: syncSetupState(m.hash, m.state) };
}
