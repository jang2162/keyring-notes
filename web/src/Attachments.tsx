import { File, FileImage, FileText, FileType, Plus, Upload } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
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
 * 아래 끌어 놓기 영역에 파일을 놓거나 눌러 고르면 첨부 폴더에 올린다.
 */
export function AttachmentList({
  paths,
  embedText,
  onOpen,
  onInsert,
  onUpload,
}: {
  /** 보일 첨부 경로(범위는 부르는 쪽이 정한다) */
  paths: string[];
  /** 문서에 넣을 글(끌어 놓기·넣기 단추가 같이 쓴다) */
  embedText: (path: string) => string;
  onOpen: (path: string) => void;
  /** 지금 문서의 커서 자리에 넣기. 넣을 문서가 없으면 undefined */
  onInsert?: (path: string) => void;
  /** 파일을 첨부 폴더에 올리기. 올릴 워크스페이스가 없으면 undefined(영역을 숨긴다) */
  onUpload?: (files: File[]) => void;
}) {
  const [q, setQ] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // 목록의 첨부를 끌 때(글자만 실림)는 받지 않는다
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return paths.filter((p) => words.every((w) => p.toLowerCase().includes(w))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [paths, q]);

  return (
    <div className="attachments-view">
      {paths.length > 0 && (
        <input
          type="search"
          className="attachments-filter"
          placeholder={t("attach.filter")}
          aria-label={t("attach.filter")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
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
      {paths.length > 0 && shown.length === 0 && <p className="meta">{t("attach.noMatch")}</p>}
      {onUpload && (
        <button
          type="button"
          className={`attachments-drop${over ? " over" : ""}${paths.length === 0 ? " empty" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setOver(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
          onDrop={(e) => {
            setOver(false);
            if (!hasFiles(e)) return;
            e.preventDefault();
            onUpload(Array.from(e.dataTransfer.files));
          }}
        >
          <Upload size={14} strokeWidth={1.75} aria-hidden />
          {t("attach.drop")}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) onUpload(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
        </button>
      )}
    </div>
  );
}
