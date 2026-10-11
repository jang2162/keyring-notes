import { File, FileImage, FileText, FileType, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "./api";
import { t } from "./i18n";
import { tipProps } from "./Tooltip";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

function KindIcon({ path }: { path: string }) {
  const props = { size: 18, strokeWidth: 1.5, "aria-hidden": true } as const;
  if (/\.pdf$/i.test(path)) return <FileType {...props} />;
  if (/\.(txt|csv|json|html?)$/i.test(path)) return <FileText {...props} />;
  if (IMAGE_RE.test(path)) return <FileImage {...props} />;
  return <File {...props} />;
}

/**
 * 첨부 파일 보기(왼쪽 패널). 이미지는 작은 그림으로 보이고, 누르면 앱 안에서 열고,
 * 문서로 끌어다 놓으면 embed(이미지 `![[…]]`, 나머지 `[[…]]`)가 그 자리에 들어간다.
 */
export function AttachmentList({
  paths,
  embedText,
  onOpen,
  onInsert,
}: {
  /** 보일 첨부 경로(범위는 부르는 쪽이 정한다) */
  paths: string[];
  /** 문서에 넣을 글(끌어 놓기·넣기 단추가 같이 쓴다) */
  embedText: (path: string) => string;
  onOpen: (path: string) => void;
  /** 지금 문서의 커서 자리에 넣기. 넣을 문서가 없으면 undefined */
  onInsert?: (path: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return paths.filter((p) => words.every((w) => p.toLowerCase().includes(w))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [paths, q]);

  return (
    <div className="attachments-view">
      <input
        type="search"
        className="attachments-filter"
        placeholder={t("attach.filter")}
        aria-label={t("attach.filter")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="attachments-list">
        {shown.map((p) => {
          const name = p.split("/").pop()!;
          const folder = p.slice(0, -name.length - 1);
          return (
            <li key={p}>
              <div
                className="attachment-item"
                role="button"
                tabIndex={0}
                draggable
                {...tipProps({ label: t("attach.itemTip", { name }) })}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("text/plain", embedText(p));
                }}
                onClick={() => onOpen(p)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(p)}
              >
                <span className="attachment-thumb">
                  {IMAGE_RE.test(p) ? <img src={api.rawUrl(p)} alt="" loading="lazy" draggable={false} /> : <KindIcon path={p} />}
                </span>
                <span className="attachment-text">
                  <span className="attachment-name">{name}</span>
                  {folder && <span className="attachment-folder">{folder}</span>}
                </span>
                {onInsert && (
                  <button
                    type="button"
                    className="attachment-insert"
                    {...tipProps({ label: t("attach.insert") })}
                    aria-label={t("attach.insertOf", { name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInsert(p);
                    }}
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {paths.length === 0 ? <p className="meta">{t("attach.none")}</p> : shown.length === 0 && <p className="meta">{t("attach.noMatch")}</p>}
      {paths.length > 0 && <p className="meta attachments-hint">{t("attach.dragHint")}</p>}
    </div>
  );
}
