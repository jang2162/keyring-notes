import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ExternalLink, PanelRightClose, SquarePen, X } from "lucide-react";
import { api } from "./api";
import { enhance } from "./enhance";
import { LinkResolver, renderMarkdown } from "./markdown";
import { IconButton } from "./ui";
import { stemOf } from "./Tree";
import { t } from "./i18n";
import { errorText } from "./toast";

/**
 * 옆 칸 미리보기: 다른 문서(또는 지금 문서)를 가운데 오른쪽에 읽기 전용으로 띄운다.
 * 안의 링크를 누르면 이 칸에서 따라가고, "여기서 편집"은 가운데 탭으로 연다.
 * version이 바뀌면(볼트 변경·지금 문서 저장) 다시 읽는다.
 */
export function AsidePreview({
  path,
  resolver,
  version,
  live,
  onNavigate,
  onEdit,
  onClose,
}: {
  path: string;
  resolver: LinkResolver;
  version: number;
  /** 지금 편집 중인 내용(같은 문서를 옆에 띄웠을 때) */
  live?: string;
  onNavigate: (path: string) => void;
  onEdit: (path: string) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live !== undefined) return;
    let alive = true;
    setError(null);
    api
      .read(path)
      .then((d) => alive && setContent(d.content))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [path, version, live]);

  const text = live ?? content;
  const html = useMemo(() => (text === null ? "" : renderMarkdown(text, { resolver, docPath: path, docId: "aside" }).html), [text, resolver, path]);
  useEffect(() => {
    if (!ref.current || text === null) return;
    return enhance(ref.current, { resolver, docPath: path });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const onClick = (e: MouseEvent) => {
    const box = (e.target as HTMLElement).closest("input.task");
    if (box) {
      e.preventDefault();
      return;
    }
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-wikilink]");
    if (!a) return;
    e.preventDefault();
    const target = a.dataset.wikilink!;
    if (a.dataset.resolved !== "1") return;
    if (/\.md$/i.test(target)) onNavigate(target);
    else window.open(api.rawUrl(target), "_blank", "noreferrer");
  };

  return (
    <section className="aside-pane" aria-label={t("aside.label", { name: stemOf(path) })}>
      <header className="aside-head">
        <span className="aside-title" title={path}>
          {stemOf(path)}
          <span className="meta"> · {t("aside.readOnly")}</span>
        </span>
        <IconButton icon={SquarePen} label={t("aside.edit")} onClick={() => onEdit(path)} size={16} />
        <IconButton icon={PanelRightClose} label={t("cmd.asideClose")} keys="Mod+\" onClick={onClose} size={16} />
      </header>
      <div className="aside-body" onClick={onClick}>
        {error ? (
          <p className="meta aside-error">
            <X size={14} aria-hidden /> {error}
          </p>
        ) : text === null ? (
          <p className="meta">{t("common.loading")}</p>
        ) : (
          <div className="markdown-body" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </section>
  );
}

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
