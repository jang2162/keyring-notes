import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { App } from "./App";
import { startLocal, wantsLocal } from "./local/boot";
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
  if (wantsLocal()) {
    try {
      await startLocal();
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
