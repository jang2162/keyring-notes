import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { Modal } from "./Modal";
import { t, useLang } from "./i18n";
import { getPrefs } from "./prefs";
import { errorText } from "./toast";
import { startupCheck } from "./updateCheck";
import { SOLO } from "./soloWindow";

/**
 * 데스크톱 앱 업데이트. 새 버전 정보는 GitHub 릴리스의 latest.json(app/src-tauri/tauri.conf.json 의 plugins.updater)에서 읽고,
 * 받기·설치는 사람이 대화상자에서 고른 뒤에만 한다. 모바일은 업데이터가 없고(스토어), 웹·서버는 서버 관리 화면이 따로 본다.
 * 릴리스 쪽 절차: docs/guides/release-macos.md
 * 노트 하나만 띄운 새 창(SOLO)은 확인하지 않는다 — 원래 창이 확인하고, 새 창에는 업데이터 권한도 없다(capabilities 의 desktop)
 */
export const updatesSupported = () => isTauri() && !/Android|iPhone|iPad/.test(navigator.userAgent) && !SOLO;

/** 업데이터는 기본으로 시간 제한이 없다(tauri-plugin-updater) — 응답이 없는 망에서 확인이 끝나지 않게 둔다 */
const CHECK_TIMEOUT_MS = 15_000;
/** 실행 직후 볼트 읽기·동기화와 겹치지 않게 조금 뒤에 확인한다 */
const STARTUP_DELAY_MS = 5_000;

/** 정보 파일만 읽는다. 새 버전이 없으면 null */
export async function checkForUpdate(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: CHECK_TIMEOUT_MS });
}

let found: Update | null = null;
const listeners = new Set<(u: Update | null) => void>();

/** 대화상자를 띄운다(설정의 「지금 확인」 도 이것으로). null 이면 닫는다 */
export function showUpdate(u: Update | null) {
  found = u;
  for (const l of listeners) l(u);
}

/** 앱 맨 위에 하나 둔다: 실행 때 한 번 확인하고, 찾은 업데이트를 묻는다 */
export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(found);
  useEffect(() => {
    listeners.add(setUpdate);
    return () => {
      listeners.delete(setUpdate);
    };
  }, []);
  useEffect(() => {
    // 값은 확인하는 순간에 읽는다(그 사이 설정에서 끈 것도 지킨다)
    const timer = setTimeout(
      () => void startupCheck({ enabled: getPrefs().updateCheck, supported: updatesSupported(), check: checkForUpdate, onFound: showUpdate }),
      STARTUP_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, []);
  return update ? <UpdateDialog update={update} onClose={() => showUpdate(null)} /> : null;
}

type Phase = { phase: "ask" } | { phase: "download"; done: number; total?: number } | { phase: "install" } | { phase: "error"; message: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function UpdateDialog({ update, onClose }: { update: Update; onClose: () => void }) {
  useLang();
  const [state, setState] = useState<Phase>({ phase: "ask" });
  const busy = state.phase === "download" || state.phase === "install";

  const install = async () => {
    let done = 0;
    let total: number | undefined;
    setState({ phase: "download", done });
    try {
      // 서명 검증은 플러그인이 설치 전에 한다(tauri.conf.json 의 pubkey)
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength;
        else if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ phase: "download", done, total });
        } else setState({ phase: "install" });
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: errorText(e) });
    }
  };
  const close = () => {
    if (busy) return;
    void update.close().catch(() => undefined);
    onClose();
  };

  return (
    <Modal title={t("update.title")} size="sm" onClose={close} className="update-dialog">
      <p>{t("update.available", { version: update.version, current: update.currentVersion })}</p>
      {update.body?.trim() && (
        <details className="update-notes">
          <summary>{t("update.notes")}</summary>
          <pre>{update.body.trim()}</pre>
        </details>
      )}
      {state.phase === "download" && (
        <p className="meta" role="status">
          {state.total
            ? t("update.downloading", { percent: Math.min(100, Math.floor((state.done / state.total) * 100)) })
            : t("update.downloadingSize", { size: mb(state.done) })}
        </p>
      )}
      {state.phase === "install" && (
        <p className="meta" role="status">
          {t("update.installing")}
        </p>
      )}
      {state.phase === "error" && <p className="form-error">{t("update.failed", { message: state.message })}</p>}
      <div className="ask-actions">
        <button type="button" onClick={close} disabled={busy}>
          {t("update.later")}
        </button>
        <button type="button" className="on" onClick={() => void install()} disabled={busy} data-autofocus>
          {state.phase === "error" ? t("common.retry") : t("update.install")}
        </button>
      </div>
    </Modal>
  );
}
