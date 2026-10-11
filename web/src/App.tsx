import { useCallback, useEffect, useState } from "react";
import { api, appMode } from "./api";
import { ClipPage } from "./Ingest";
import { Login } from "./Login";
import { authMemo, isNetworkError, offline } from "./offline";
import { Workspace } from "./Workspace";
import { useLang } from "./i18n";
import { TooltipLayer } from "./Tooltip";

export function App() {
  // 화면 언어가 바뀌면 다시 그린다(편집 상태는 그대로)
  useLang();
  // 데스크톱·모바일 앱(또는 브라우저 ?local): 기기 볼트라 로그인이 없다
  return (
    <>
      {appMode.local ? <Workspace onLogout={() => undefined} /> : <ServerApp />}
      <TooltipLayer />
    </>
  );
}

function ServerApp() {
  const [auth, setAuth] = useState({ ready: false, ok: false, wasIn: false, passwordSet: true, passkey: false });

  const checkAuth = useCallback(async () => {
    try {
      const s = await api.status();
      const ok = s.authenticated && s.principal?.kind === "owner";
      authMemo.set(ok);
      setAuth((a) => ({ ready: true, ok, wasIn: a.wasIn || ok, passwordSet: s.passwordSet, passkey: s.passkey === true }));
    } catch (e) {
      // 연결이 없을 때: 이 기기에서 로그인했었다면 오프라인으로 연다
      const offlineOk = isNetworkError(e) && authMemo.get();
      setAuth((a) => ({ ...a, ready: true, ok: offlineOk, wasIn: a.wasIn || offlineOk }));
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const onUnauthorized = () => setAuth((a) => ({ ...a, ok: false }));
    window.addEventListener("keyring:unauthorized", onUnauthorized);
    return () => window.removeEventListener("keyring:unauthorized", onUnauthorized);
  }, [checkAuth]);

  if (!auth.ready) return null;
  // 북마클릿이 연 클리퍼 창
  if (location.hash.startsWith("#/clip")) {
    return auth.ok ? <ClipPage /> : <Login passwordSet={auth.passwordSet} passkey={auth.passkey} onDone={checkAuth} />;
  }
  // 세션이 끊겨도 작업 화면은 남겨 두어 저장하지 않은 내용을 잃지 않게 한다.
  return (
    <>
      {(auth.ok || auth.wasIn) && (
        <Workspace
          onLogout={() =>
            api.logout().finally(() => {
              authMemo.set(false);
              void offline.clear().catch(() => undefined);
              setAuth((a) => ({ ...a, wasIn: false }));
              void checkAuth();
            })
          }
        />
      )}
      {!auth.ok && <Login passwordSet={auth.passwordSet} passkey={auth.passkey} onDone={checkAuth} />}
    </>
  );
}
