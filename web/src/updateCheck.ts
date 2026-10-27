import type { Update } from "@tauri-apps/plugin-updater";
import { restartAfterClosing } from "./closeWindow";

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
 * 플러그인의 relaunch 를 쓰지 않는다: 창에 닫기 요청 없이 곧바로 끝난다.
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
