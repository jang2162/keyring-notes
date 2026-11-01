import { isTouch } from "./touch";

/**
 * 뒤로가기로 위에 뜬 것(확인 창·메뉴·모달·서랍)을 하나씩 닫는다 — 터치 환경에서만.
 *
 * 무언가 열리면 주소 기록에 같은 주소의 표시 항목(`history.state.kOverlay`)을 하나 쌓는다(여럿이 열려도 하나).
 * 뒤로가기가 그 항목을 떠나면 맨 위 것 하나를 닫고, 남은 게 있으면 표시를 다시 쌓는다.
 * 단추·배경·Esc 로 마지막 것이 닫히면 쌓아 둔 표시를 우리가 `history.back()` 으로 치운다(그 popstate 는 닫기가 아니다).
 * 우리가 부른 back 이 도착하기 전의 기록 조작(설정 열기 push, 주소 replace)은 도착을 기다린다 — back 이 그것을 되돌리지 않게.
 */

export interface BackEnv {
  history: Pick<History, "state" | "pushState" | "replaceState" | "back">;
  addPopListener(fn: (e: { state: unknown }) => void): void;
  enabled(): boolean;
}

type Close = () => boolean | void | Promise<boolean | void>;

export interface BackStack {
  /** 위에 뜬 것 하나를 등록한다(뒤로가기면 close). 돌려준 함수는 닫혔을 때 부른다 — 두 번 불려도 한 번만 */
  push(close: Close): () => void;
  /** 우리가 부른 back 의 popstate 가 아직이면 그때까지 기다린다 */
  settle(): Promise<void>;
  /** 새 기록 항목으로 간다(설정 열기). 표시가 서 있으면 그 항목을 갈아 끼운다 */
  navigate(url: string, state?: Record<string, unknown>): Promise<void>;
  /** 설정이 닫혀 노트 주소로 돌아왔다: navigate 가 미뤄 둔 것 중 아직 열린 것의 표시를 다시 쌓는다 */
  resume(): void;
  /** 지금 항목의 주소만 바꾼다(활성 노트). 표시가 없으면 state 는 null, 있으면 표시를 지킨다 */
  replace(url: string): void;
  /** 시작 때 표시 항목에 서 있으면(새로 고침·앱 다시 열기) 치운다 */
  initClean(): void;
}

const isMarker = (state: unknown) => !!(state as { kOverlay?: unknown } | null)?.kOverlay;
const withoutMarker = (state: unknown): Record<string, unknown> | null => {
  if (!state || typeof state !== "object") return null;
  const { kOverlay: _, ...rest } = state as Record<string, unknown>;
  return Object.keys(rest).length ? rest : null;
};

export function createBackStack(env: BackEnv): BackStack {
  const h = env.history;
  interface Item {
    close: Close;
  }
  let items: Item[] = [];
  /** navigate 가 표시를 갈아 끼울 때 열려 있던 것 — 설정이 닫히면 resume 이 items 로 되돌린다 */
  let suspended: Item[] = [];
  /** 지금 기록 항목이 우리가 쌓은 표시다 */
  let marker = false;
  /** 우리가 부른 back 중 popstate 가 아직 안 온 수 */
  let pending = 0;
  /** back 도착을 기다리는 일 */
  let waiters: (() => void)[] = [];
  /** 표시가 서 있는 동안 바뀐 주소 — 표시를 떠나면 아래 항목에도 적는다 */
  let wantUrl: string | null = null;

  const ourBack = () => {
    marker = false;
    pending++;
    h.back();
  };

  const ensure = () => {
    if (marker || items.length === 0) return;
    if (pending > 0) {
      waiters.push(ensure);
      return;
    }
    h.pushState({ ...(h.state && typeof h.state === "object" ? h.state : {}), kOverlay: true }, "");
    marker = true;
  };

  const leftMarker = () => {
    if (wantUrl !== null) h.replaceState(withoutMarker(h.state), "", wantUrl);
    wantUrl = null;
  };

  env.addPopListener(() => {
    if (pending > 0) {
      pending--;
      leftMarker();
      if (pending === 0) {
        const run = waiters;
        waiters = [];
        for (const fn of run) fn();
      }
      return;
    }
    if (!marker) return;
    // 사람이 뒤로가기로 표시를 떠났다: 맨 위 것 하나를 닫는다
    marker = false;
    leftMarker();
    const top = items.pop();
    if (!top) return;
    const restore = (r: boolean | void) => {
      if (r === false) {
        // 닫기 거부(닫기 확인에서 취소): 열린 채이므로 표시를 다시 쌓는다
        items.push(top);
      }
      ensure();
    };
    let r: ReturnType<Close>;
    try {
      r = top.close();
    } catch (err) {
      ensure();
      throw err;
    }
    if (r instanceof Promise) {
      ensure();
      r.then(restore, () => restore(false));
    } else restore(r);
  });

  const api: BackStack = {
    push(close) {
      if (!env.enabled()) return () => {};
      const item: Item = { close };
      items.push(item);
      ensure();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const i = items.indexOf(item);
        if (i < 0) {
          const j = suspended.indexOf(item);
          if (j >= 0) suspended.splice(j, 1);
          return; // 뒤로가기로 닫혔거나, 설정 아래에서 닫혔다(표시가 없으므로 back 을 부르지 않는다)
        }
        items.splice(i, 1);
        if (items.length === 0 && marker) ourBack();
      };
    },
    settle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    async navigate(url, state) {
      if (marker && pending === 0) {
        // 표시 항목을 새 주소로 갈아 끼운다. 지금 열린 것들은 설정 아래로 미룬다 — 닫히는 중인 것(더 보기·서랍)은
        // 해제되며 back 없이 빠지고, 남는 것(그래프 등)은 설정이 닫힌 뒤 resume 이 표시를 다시 쌓는다
        h.replaceState(state ?? null, "", url);
        marker = false;
        suspended = suspended.concat(items);
        items = [];
        wantUrl = null;
        return;
      }
      await api.settle();
      h.pushState(state ?? null, "", url);
    },
    resume() {
      if (suspended.length === 0) return;
      items = suspended.concat(items);
      suspended = [];
      ensure();
    },
    replace(url) {
      if (pending > 0) {
        waiters.push(() => api.replace(url));
        return;
      }
      if (marker) {
        h.replaceState(h.state, "", url);
        wantUrl = url;
      } else h.replaceState(null, "", url);
    },
    initClean() {
      if (isMarker(h.state)) ourBack();
    },
  };
  return api;
}

export const backStack: BackStack = createBackStack({
  history: typeof window === "undefined" ? { state: null, pushState() {}, replaceState() {}, back() {} } : window.history,
  addPopListener: (fn) => {
    if (typeof window !== "undefined") window.addEventListener("popstate", fn);
  },
  enabled: isTouch,
});

export const pushOverlay = (close: Close) => backStack.push(close);
