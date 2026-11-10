import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { App } from "./App";
import { registerLanguageKind } from "./i18nMarket";
import { backStack } from "./backStack";
import { startLocal, wantsLocal } from "./local/boot";
import { hasOwnNotes, syncSetupRedirect } from "./local/mode";
import { startMarket } from "./market/start";
import { browserEnv, watchUpdates } from "./pwaUpdate";
import { SOLO } from "./soloWindow";
import { registerThemeKind } from "./theme/marketThemes";
import { watchTrafficLights } from "./windowChrome";
import "./styles.css";
import { t } from "./i18n";
import { registerBuiltins } from "./widgets/builtins";

registerBuiltins();
const root = createRoot(document.getElementById("root")!);
watchTrafficLights();

async function boot() {
  // 새로 고침·앱 다시 열기 때 뒤로가기 표시 항목에 서 있으면 치운다(첫 뒤로가기가 헛돌지 않게, backStack.ts).
  // 동기화 화면으로 주소를 바꾸는 replaceState 보다 먼저, 치운 back 이 도착한 뒤에
  backStack.initClean();
  await Promise.race([backStack.settle(), new Promise((r) => setTimeout(r, 1000))]);
  // 오프라인에서도 앱 화면이 열리도록(문서 데이터는 IndexedDB). 데스크톱·모바일 앱은 화면이 앱에 들어 있어 필요 없다.
  if ("serviceWorker" in navigator && import.meta.env.PROD && !isTauri()) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => watchUpdates(reg, browserEnv()))
        .catch((e) => console.warn("service worker registration failed", e));
    });
  }
  if (await wantsLocal()) {
    try {
      const ctx = await startLocal();
      // 비밀번호만 넣으면 되게: 동기화 화면은 서버 주소(이 출처)·기기 이름을 채워 둔다(Sync.tsx)
      const go = syncSetupRedirect({
        kind: ctx.kind,
        solo: SOLO,
        connected: !!ctx.sync.get().settings,
        hasNotes: hasOwnNotes(
          ctx.vault.docs().map((d) => d.path),
          (p) => ctx.vault.isGenerated(p),
        ),
        hash: location.hash,
        state: history.state,
      });
      if (go) history.replaceState(go.state, "", go.url);
    } catch (e) {
      root.render(
        <div className="boot-error">
          <h1>{t("app.cannotOpenVault")}</h1>
          <p>{e instanceof Error ? e.message : String(e)}</p>
          <button onClick={() => (localStorage.removeItem("keyring:vaultDir"), location.reload())}>{t("app.reopenDefault")}</button>
        </div>,
      );
      return;
    }
  }
  // 마켓 상태: 공통 설정(잠금)을 읽으면 기기 캐시를 맞춘다. 서버 모드는 로그인 뒤 설정이 읽혀야 돈다
  const m = startMarket();
  registerThemeKind(m);
  registerLanguageKind(m);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
