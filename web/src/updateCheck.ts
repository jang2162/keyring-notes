import type { Update } from "@tauri-apps/plugin-updater";
import { quitAfterClosing, restartAfterClosing } from "./closeWindow";

/**
 * 실행 때 확인. 「업데이트 자동 확인」 이 꺼졌거나 데스크톱 앱이 아니면 check 를 부르지 않는다 — 밖으로 나가는 요청이 없어야 한다.
 * 찾으면 onFound 로 넘길 뿐 받거나 설치하지 않는다. 실패(오프라인 등)는 조용히 넘긴다(설정의 「지금 확인」 이 오류를 보인다).
 */
export async function startupCheck<U>(opts: {
  enabled: boolean;
  supported: boolean;
  check: () => Promise<U | null>;
  onFound: (u: U) => void;
}): Promise<"off" | "none" | "found" | "failed"> {
  if (!opts.supported || !opts.enabled) return "off";
  try {
    const u = await opts.check();
    if (!u) return "none";
    opts.onFound(u);
    return "found";
  } catch {
    return "failed";
  }
}

/**
 * 받아 설치하고 다시 시작한다. 다시 시작은 창마다 닫기 물음을 거친다(저장 안 한 초안을 묻지 않고 버리지 않는다 — closeWindow.ts).
 * process 플러그인의 relaunch 는 쓰지 않는다(의존성에서도 뺐다): 창에 닫기 요청 없이 곧바로 끝난다.
 * 다 닫히면 앱이 다시 시작하므로 돌아오지 않는다. 누가 닫지 않기로 하면 "cancelled"(업데이트는 설치된 채 다음 실행 때 적용된다)
 */
export async function installAndRestart(
  update: Pick<Update, "downloadAndInstall">,
  onProgress: Parameters<Update["downloadAndInstall"]>[0],
  onRestart: () => void,
  restart: () => Promise<"cancelled"> = restartAfterClosing,
): Promise<"cancelled"> {
  // 서명 검증은 플러그인이 설치 전에 한다(tauri.conf.json 의 pubkey)
  await update.downloadAndInstall(onProgress);
  onRestart();
  return restart();
}

/**
 * 받아 설치하고 끈다(Quit 앞의 업데이트 물음에서 「설치하고 종료」). 다시 시작하지 않는다 — 다음 실행 때 새 버전으로 뜬다.
 * 끄는 길은 Quit 차례다(창마다 저장 안 한 변경을 묻는다). 누가 닫지 않기로 하면 업데이트는 설치된 채 남는다
 */
export async function installAndQuit(
  update: Pick<Update, "downloadAndInstall">,
  onProgress: Parameters<Update["downloadAndInstall"]>[0],
  onInstalled: () => void,
  quit: () => Promise<void> = quitAfterClosing,
): Promise<void> {
  await update.downloadAndInstall(onProgress);
  onInstalled();
  await quit();
}

/** 「새 버전이 있다」 상태(레드닷, Quit 앞의 물음) */
export interface Available<U> {
  get: () => U | null;
  /** 새 버전을 찾았다(u), 설치했거나 다시 확인해 없었다(null) */
  set: (u: U | null) => void;
  subscribe: (l: (u: U | null) => void) => () => void;
}

/**
 * 「새 버전이 있다」 상태. 실행 때 확인과 「업데이트 확인」이 넣고, 설치가 끝나거나 다시 확인해 없으면 비운다 — 정보 화면을 열거나
 * 대화상자에서 「나중에」를 눌러도 그대로 둔다. 있고 없음이 바뀔 때마다 report 로 앱에 알린다(메뉴의 Quit 이 먼저 묻는다).
 * 갈아 끼운 업데이트는 놓는다(close) — 대화상자가 쥐고 있는 것(inUse)만 대화상자가 닫힐 때 놓는다
 */
export function availableUpdate<U extends { close: () => Promise<void> }>(opts: {
  report: (pending: boolean) => void;
  inUse: (u: U) => boolean;
}): Available<U> {
  let cur: U | null = null;
  const listeners = new Set<(u: U | null) => void>();
  return {
    get: () => cur,
    set: (u) => {
      if (u === cur) return;
      const prev = cur;
      cur = u;
      if (prev && !opts.inUse(prev)) void prev.close().catch(() => undefined);
      if (!prev !== !u) opts.report(!!u);
      for (const l of listeners) l(u);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}
