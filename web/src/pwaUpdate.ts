/**
 * 열어 둔 설치 웹 앱(PWA)의 새 버전 알림.
 * 브라우저는 페이지를 새로 열 때만 새 서비스 워커를 찾으므로, 앱이 앞으로 돌아올 때(마지막 확인 뒤 30분이 지났으면) update() 를 부른다.
 * 새 워커가 자리를 잡으면(controllerchange) 그 워커에게 빌드 id 를 묻고(public/sw.js 의 build 메시지), 이 화면의 빌드와 다를 때만 알린다 —
 * 배포 뒤 처음 연 화면·처음 설치는 이미 같은 빌드라 알리지 않는다. 답하지 않는 옛 워커·오프라인은 조용히 넘어간다.
 */

export const CHECK_EVERY_MS = 30 * 60_000;

/** 마지막 확인 뒤 CHECK_EVERY_MS 가 지났는가 */
export function shouldCheck(now: number, last: number): boolean {
  return now - last >= CHECK_EVERY_MS;
}

/** 워커의 빌드가 이 화면의 빌드와 다른가. 모르면(null) 아니다 */
export function isNewBuild(workerBuild: string | null, pageBuild: string): boolean {
  return workerBuild !== null && workerBuild !== pageBuild;
}

/** 워커에게 빌드 id 를 묻는다. 답이 없거나(옛 워커·시간 초과) 오류면 null */
export function askBuild(sw: Pick<ServiceWorker, "postMessage">, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ch.port1.close();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ch.port1.onmessage = (e: MessageEvent) => finish(typeof e.data === "string" ? e.data : null);
    try {
      sw.postMessage({ type: "build" }, [ch.port2]);
    } catch {
      finish(null);
    }
  });
}

export interface UpdateEnv {
  now(): number;
  visible(): boolean;
  /** 보임 여부가 바뀔 때 부른다. 끊는 함수를 돌려준다 */
  onVisible(fn: () => void): () => void;
  /** 이 화면을 맡은 워커가 바뀔 때 부른다. 끊는 함수를 돌려준다 */
  onControllerChange(fn: () => void): () => void;
  controller(): Pick<ServiceWorker, "postMessage"> | null;
}

let found = false;
const listeners = new Set<() => void>();

function announce() {
  found = true;
  for (const fn of listeners) fn();
}

/** 새 버전을 알아채면 부른다. 이미 알아챈 뒤에 구독하면 바로 한 번 부른다(Workspace 가 늦게 그려져도 놓치지 않게). 끊는 함수를 돌려준다 */
export function onNewVersion(fn: () => void): () => void {
  listeners.add(fn);
  if (found) fn();
  return () => void listeners.delete(fn);
}

/** 감시를 시작한다(main.tsx 가 등록 뒤). 시작 때를 마지막 확인으로 친다 — 페이지를 열 때 브라우저가 이미 확인했다. 끊는 함수를 돌려준다 */
export function watchUpdates(
  reg: Pick<ServiceWorkerRegistration, "update">,
  env: UpdateEnv,
  pageBuild: string = __KEYRING_BUILD__,
  askTimeoutMs?: number,
): () => void {
  let last = env.now();
  const offVisible = env.onVisible(() => {
    if (!env.visible()) return;
    const now = env.now();
    if (!shouldCheck(now, last)) return;
    last = now;
    // 오프라인이면 거부된다 — 알리지 않고 다음에 돌아올 때 다시 본다
    try {
      void reg.update().catch(() => undefined);
    } catch {
      // 등록이 사라졌으면 그냥 넘어간다
    }
  });
  const offChange = env.onControllerChange(() => {
    const sw = env.controller();
    if (!sw) return;
    void askBuild(sw, askTimeoutMs).then((build) => {
      if (isNewBuild(build, pageBuild)) announce();
    });
  });
  return () => {
    offVisible();
    offChange();
  };
}

/** 브라우저의 document·navigator.serviceWorker 로 만든 UpdateEnv */
export function browserEnv(): UpdateEnv {
  const sw = navigator.serviceWorker;
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    onVisible: (fn) => {
      document.addEventListener("visibilitychange", fn);
      return () => document.removeEventListener("visibilitychange", fn);
    },
    onControllerChange: (fn) => {
      sw.addEventListener("controllerchange", fn);
      return () => sw.removeEventListener("controllerchange", fn);
    },
    controller: () => sw.controller,
  };
}
