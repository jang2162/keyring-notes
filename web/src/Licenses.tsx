import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { errorText } from "./toast";
import { t } from "./i18n";

/**
 * 제3자 라이선스 고지(빌드가 만든 `licenses.txt`, web/licenses/plugin.ts)를 모달로 연다.
 * 새 창 대신 모달인 것은 앱(Tauri)에 새 창 탭이 없어서다. 서버·앱 모두 같은 주소에 있고, 웹은 서비스 워커가 받아 둬 오프라인에서도 열린다.
 * 개발 서버(vite dev)에는 파일이 없다 — 빌드에서만 만든다.
 */
export function LicensesDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}licenses.txt`)
      .then((res) => {
        // 서버·개발 서버는 없는 주소에 화면(index.html)을 200 으로 준다 — 그것을 고지로 보이지 않게
        if (!res.ok || res.headers.get("content-type")?.includes("text/html")) throw new Error(res.ok ? "licenses.txt not found" : `HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => live && setText(body))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal title={t("settings.licenses")} onClose={onClose} maximizable>
      {error ? (
        <p role="alert">{t("licenses.failed", { message: error })}</p>
      ) : text === null ? (
        <p className="meta">{t("common.loading")}</p>
      ) : (
        <pre className="licenses-text">{text}</pre>
      )}
    </Modal>
  );
}
