/**
 * 설정 화면 주소와 「닫으면 돌아갈 노트」. 설정은 주소(`#/:settings/<묶음>`)로 열리고,
 * 부팅이 동기화 화면으로 주소를 바꿔 치운 노트는 그 기록 항목의 history.state(`{ back }`)에 남는다.
 */

/** 설정 화면 주소: 파일 이름에 못 쓰는 ":"로 시작해 문서 경로와 겹치지 않는다 */
export const SETTINGS_HASH = "#/:settings";

/** 주소(location.hash)가 가리키는 노트 경로. 비었거나 설정 등 ":" 로 시작하는 화면이면 null */
export function notePathOfHash(hash: string): string | null {
  const h = decodeURIComponent(hash.replace(/^#\/?/, ""));
  if (h.startsWith(":")) return null;
  return h || null;
}

/** history.state 에서 설정을 닫으면 돌아갈 노트를 읽는다 */
export function settingsBack(state: unknown): string | null {
  const back = (state as { back?: unknown } | null | undefined)?.back;
  return typeof back === "string" && back ? back : null;
}

/**
 * 동기화 화면으로 주소를 바꿀 때 남길 state. 주소가 노트면 그 노트,
 * 아니면(동기화 화면에서 새로 고침 등) 브라우저가 보존해 둔 지금 state 의 돌아갈 노트를 이어받는다.
 */
export function syncSetupState(hash: string, state: unknown): { back: string } | null {
  const back = notePathOfHash(hash) ?? settingsBack(state);
  return back ? { back } : null;
}

/**
 * 설정을 닫을 때 갈 주소와 새로 열 노트. restore 가 아니면(곧 다른 노트를 여는 중) 주소만 비운다.
 * 돌아갈 노트(back)가 있으면 지금 노트보다 먼저다 — 복원된 탭이 아니라 사람이 이 주소로 열려던 노트다.
 */
export function settingsCloseTarget(m: { restore: boolean; current: string | null; back: string | null }): { hash: string; open: string | null } {
  if (!m.restore) return { hash: "#", open: null };
  if (m.back) return { hash: `#/${encodeURIComponent(m.back)}`, open: m.back === m.current ? null : m.back };
  return { hash: m.current ? `#/${encodeURIComponent(m.current)}` : "#", open: null };
}

/** 설정 안에서 묶음만 바꾼다. state(돌아갈 노트)는 그대로 둔다 */
export function replaceSettingsSection(h: Pick<History, "state" | "replaceState">, section: string): void {
  h.replaceState(h.state, "", `${SETTINGS_HASH}/${section}`);
}
