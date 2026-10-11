import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { api } from "./api";
import { IconButton } from "./ui";
import { t } from "./i18n";

/** 첨부 보기: 이미지는 앱 안에서, 그 밖은 원본 열기 */
export function FileViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const image = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop file-viewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal file-viewer" role="dialog" aria-label={path}>
        <div className="modal-head">
          <strong className="file-viewer-name" title={path}>
            {path.split("/").pop()}
          </strong>
          <span>
            <a className="button-like" href={api.rawUrl(path)} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden /> {t("file.openOriginal")}
            </a>{" "}
            <IconButton icon={X} label={t("common.close")} onClick={onClose} size={16} />
          </span>
        </div>
        <p className="meta">{path}</p>
        {image ? <img className="file-viewer-img" src={api.rawUrl(path)} alt={path.split("/").pop()} /> : <p>{t("file.noPreview")}</p>}
      </div>
    </div>
  );
}
