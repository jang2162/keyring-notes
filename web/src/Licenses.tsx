import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { errorText } from "./toast";
import { t } from "./i18n";
import { splitNoticeBlocks } from "./licenseNotices";

/**
 * 제3자 라이선스 고지(빌드가 만든 `licenses.txt`, web/licenses/plugin.ts)를 모달로 연다.
 * 새 창 대신 모달인 것은 앱(Tauri)에 새 창 탭이 없어서다. 서버·앱 모두 같은 주소에 있고, 웹은 서비스 워커가 받아 둬 오프라인에서도 열린다.
 * 개발 서버(vite dev)에는 파일이 없다 — 빌드에서만 만든다.
 *
 * 앱판 고지는 1.8MB 쯤 된다. `pre` 하나에 넣으면 레이아웃을 한 번에 해 화면이 몇 초 멈추므로 묶음마다 따로 그리고
 * 화면 밖 묶음은 `content-visibility: auto` 로 건너뛴다(styles.css 의 .licenses-block).
 * 본문은 포커스를 받아(data-autofocus) 열자마자 PageDown·↓ 로 스크롤된다 — 모달 상자에 포커스가 있으면 스크롤 영역의 바깥이라 안 움직인다.
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
  const blocks = useMemo(() => (text === null ? [] : splitNoticeBlocks(text)), [text]);
  return (
    <Modal title={t("settings.licenses")} onClose={onClose} maximizable>
      {/* 틀은 불러오기 전부터 그린다 — 모달은 처음 붙을 때만 [data-autofocus] 를 찾는다 */}
      <div className="licenses-text" role="region" aria-label={t("settings.licenses")} tabIndex={0} data-autofocus>
        {error ? (
          <p role="alert">{t("licenses.failed", { message: error })}</p>
        ) : text === null ? (
          <p className="meta">{t("common.loading")}</p>
        ) : (
          blocks.map((block, i) => (
            <pre key={i} className="licenses-block">
              {block}
            </pre>
          ))
        )}
      </div>
    </Modal>
  );
}
