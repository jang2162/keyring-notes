import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { App } from "./App";
import { startLocal, wantsLocal } from "./local/boot";
import { hasOwnNotes, syncSetupRedirect } from "./local/mode";
import { SOLO } from "./soloWindow";
import "./styles.css";
import { t } from "./i18n";

const root = createRoot(document.getElementById("root")!);

async function boot() {
  // 오프라인에서도 앱 화면이 열리도록(문서 데이터는 IndexedDB). 데스크톱·모바일 앱은 화면이 앱에 들어 있어 필요 없다.
  if ("serviceWorker" in navigator && import.meta.env.PROD && !isTauri()) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker registration failed", e));
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
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
