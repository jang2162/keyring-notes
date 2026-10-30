import { useEffect, useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";
import { Modal } from "./Modal";
import { t, useLang } from "./i18n";
import { getPrefs } from "./prefs";
import { errorText, toast } from "./toast";
import { availableUpdate, installAndQuit, installAndRestart, InstallBusyError, installBusy, quitAskHandler, startupCheck } from "./updateCheck";
import { ackQuitAsk, listenQuitAsks, quitAskDone } from "./closeWindow";
import { SOLO } from "./soloWindow";

/**
 * 데스크톱 앱 업데이트. 새 버전 정보는 GitHub 릴리스의 latest.json(app/src-tauri/tauri.conf.json 의 plugins.updater)에서 읽고,
 * 받기·설치는 사람이 대화상자에서 고른 뒤에만 한다. 실행 때 찾으면 대화상자를 띄우지 않고 「새 버전이 있다」 상태만 둔다 —
 * 레일의 설정 단추와 설정의 「정보」에 주황 점을 찍고, 메뉴의 Quit 이 끄기 전에 묻는다(QuitUpdateDialog). 모바일은 업데이터가 없고(스토어), 웹·서버는 서버 관리 화면이 따로 본다.
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

/** 메뉴의 Quit 이 이 창에 먼저 묻도록 앱에 알린다(app/src-tauri/src/close_guard.rs 의 UpdateQuit) */
async function reportPending(pending: boolean) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_update_pending", { pending });
}

/** 새 버전이 있다(알림 점·Quit 앞의 물음). 대화상자가 쥔 업데이트는 대화상자가 닫힐 때 놓는다 */
export const available = availableUpdate<Update>({
  report: (p) => void reportPending(p).catch(() => undefined),
  inUse: (u) => u === found,
});

/** 새 버전이 있으면 그 업데이트 */
export const useAvailableUpdate = (): Update | null => useSyncExternalStore(available.subscribe, available.get);

/** 대화상자를 띄운다(설정의 「업데이트 확인」·정보의 「설치」). null 이면 닫는다 */
export function showUpdate(u: Update | null) {
  found = u;
  for (const l of listeners) l(u);
}

/** 앱 맨 위에 하나 둔다: 실행 때 한 번 확인해 찾은 것을 상태로 두고, 대화상자와 Quit 앞의 물음을 띄운다 */
export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(found);
  const [quitting, setQuitting] = useState<Update | null>(null);
  useEffect(() => {
    listeners.add(setUpdate);
    return () => {
      listeners.delete(setUpdate);
    };
  }, []);
  useEffect(() => {
    // 값은 확인하는 순간에 읽는다(그 사이 설정에서 끈 것도 지킨다)
    const timer = setTimeout(
      () => void startupCheck({ enabled: getPrefs().updateCheck, supported: updatesSupported(), check: checkForUpdate, onFound: available.set }),
      STARTUP_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!updatesSupported()) return;
    let off: (() => void) | undefined;
    let gone = false;
    // 받는 중이면(설정의 대화상자) 묻지 않는다 — 그 대화상자가 이미 이 창에 떠 있다
    const onQuitAsk = quitAskHandler({
      ack: ackQuitAsk,
      busy: installBusy,
      pending: available.get,
      ask: setQuitting,
      done: (quit) => void quitAskDone(quit),
      onBusy: () => toast(t("update.busy"), { kind: "info" }),
    });
    void listenQuitAsks((id) => void onQuitAsk(id)).then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  return (
    <>
      {update && <UpdateDialog update={update} onClose={() => showUpdate(null)} />}
      {quitting && <QuitUpdateDialog update={quitting} onClose={() => setQuitting(null)} />}
    </>
  );
}

type Phase =
  | { phase: "ask" }
  | { phase: "download"; done: number; total?: number }
  | { phase: "install" }
  | { phase: "restart" }
  | { phase: "installed" }
  | { phase: "error"; message: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const installError = (e: unknown) => (e instanceof InstallBusyError ? t("update.busy") : errorText(e));

function UpdateDialog({ update, onClose }: { update: Update; onClose: () => void }) {
  useLang();
  const [state, setState] = useState<Phase>({ phase: "ask" });
  const busy = state.phase === "download" || state.phase === "install" || state.phase === "restart";

  const install = async () => {
    let done = 0;
    let total: number | undefined;
    setState({ phase: "download", done });
    try {
      await installAndRestart(
        update,
        (e) => {
          if (e.event === "Started") total = e.data.contentLength;
          else if (e.event === "Progress") {
            done += e.data.chunkLength;
            setState({ phase: "download", done, total });
          } else setState({ phase: "install" });
        },
        () => {
          available.set(null);
          setState({ phase: "restart" });
        },
      );
      setState({ phase: "installed" });
    } catch (e) {
      setState({ phase: "error", message: installError(e) });
    }
  };
  const close = () => {
    if (busy) return;
    // 「나중에」여도 새 버전이 있다는 상태(알림 점)는 남긴다 — 그 업데이트는 상태가 쥔다
    if (update !== available.get()) void update.close().catch(() => undefined);
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
      {state.phase === "restart" && (
        <p className="meta" role="status">
          {t("update.restarting")}
        </p>
      )}
      {state.phase === "installed" && (
        <p className="meta" role="status">
          {t("update.restartCancelled")}
        </p>
      )}
      {state.phase === "error" && <p className="form-error">{t("update.failed", { message: state.message })}</p>}
      <div className="ask-actions">
        {state.phase === "installed" ? (
          <button type="button" className="on" onClick={close} data-autofocus>
            {t("common.ok")}
          </button>
        ) : (
          <>
            <button type="button" onClick={close} disabled={busy}>
              {t("update.later")}
            </button>
            <button type="button" className="on" onClick={() => void install()} disabled={busy} data-autofocus>
              {state.phase === "error" ? t("common.retry") : t("update.install")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

type QuitPhase = { phase: "ask" } | { phase: "download"; done: number; total?: number } | { phase: "install" } | { phase: "error"; message: string };

/**
 * 메뉴의 Quit 앞의 물음: 설치하고 종료(다시 시작하지 않는다 — 다음 실행 때 새 버전) · 그냥 종료 · 취소.
 * 끄는 길은 모두 앱의 Quit 차례라 창마다 저장 안 한 변경을 묻는다. 받다가 실패하면 오류와 함께 그냥 종료·취소를 다시 고른다
 */
function QuitUpdateDialog({ update, onClose }: { update: Update; onClose: () => void }) {
  useLang();
  const [state, setState] = useState<QuitPhase>({ phase: "ask" });
  const busy = state.phase === "download" || state.phase === "install";

  const cancel = () => {
    if (busy) return;
    onClose();
    void quitAskDone(false);
  };
  // 물음을 먼저 닫는다: 이 창에 저장 안 한 변경이 있으면 Quit 차례가 그 물음을 띄운다
  const quit = () => {
    onClose();
    void quitAskDone(true);
  };
  const install = async () => {
    let done = 0;
    let total: number | undefined;
    setState({ phase: "download", done });
    try {
      await installAndQuit(
        update,
        (e) => {
          if (e.event === "Started") total = e.data.contentLength;
          else if (e.event === "Progress") {
            done += e.data.chunkLength;
            setState({ phase: "download", done, total });
          } else setState({ phase: "install" });
        },
        () => {
          onClose();
          available.set(null);
        },
      );
    } catch (e) {
      setState({ phase: "error", message: installError(e) });
    }
  };

  return (
    <Modal title={t("update.quitTitle")} size="sm" onClose={cancel} className="update-dialog">
      <p>{t("update.quitAsk", { version: update.version, current: update.currentVersion })}</p>
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
        <button type="button" onClick={cancel} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={quit} disabled={busy} data-autofocus={state.phase === "error" || undefined}>
          {t("update.quitOnly")}
        </button>
        {state.phase !== "error" && (
          <button type="button" className="on" onClick={() => void install()} disabled={busy} data-autofocus>
            {t("update.installAndQuit")}
          </button>
        )}
      </div>
    </Modal>
  );
}
