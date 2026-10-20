import type { TrashItem } from "@keyring-notes/core";
import { ChevronRight, FileText, FolderClosed, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, appMode } from "./api";
import { fmtDateTime, t } from "./i18n";
import { renderMarkdown, type LinkResolver } from "./markdown";
import { Modal } from "./Modal";
import { errorText, toast, toastError } from "./toast";
import { parentOf, stemOf } from "./Tree";

/** 되살린 뒤 열 노트: 노드 노트, 없으면 처음 되살린 노트(만든 경로) */
function headTarget(item: TrashItem, restored: [string, string][]): [string, string] | null {
  const md = restored.filter(([from]) => /\.md$/i.test(from));
  return (item.node && md.find(([from]) => from === `${item.node}.md`)) || md[0] || null;
}

/**
 * 휴지통(ux.md 14번): 지운 노트를 묶음(한 번의 삭제)마다 한 줄로. 펼치면 지우기 직전 내용을 읽기 전용으로 보고,
 * 「되살리기」는 원래 자리에 만든다(자리에 파일이 생겼으면 " 2"). 영구 삭제는 없다(이력에 남아 있다).
 */
export function TrashPanel({
  folder,
  resolver,
  onClose,
  onChanged,
  onOpen,
}: {
  /** 워크스페이스(모든 워크스페이스면 undefined) */
  folder?: string;
  resolver: LinkResolver;
  onClose: () => void;
  onChanged: () => void;
  onOpen: (p: string) => void;
}) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; path: string } | null>(null);
  const [previews, setPreviews] = useState<Record<string, string | { error: string }>>({});

  const load = useCallback(
    async (cursor?: number) => {
      try {
        const page = await api.trash(folder, cursor);
        setItems((cur) => (cursor && cur ? [...cur, ...page.items] : page.items));
        setNext(page.next);
        setError(null);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [folder],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const key = (id: string, path: string) => `${id}\0${path}`;
  const show = (id: string, path: string) => {
    if (open?.id === id && open.path === path) return setOpen(null);
    setOpen({ id, path });
    if (previews[key(id, path)] !== undefined) return;
    api.trashPreview(id, path).then(
      (content) => setPreviews((p) => ({ ...p, [key(id, path)]: content })),
      (e) => setPreviews((p) => ({ ...p, [key(id, path)]: { error: errorText(e) } })),
    );
  };

  const restore = async (item: TrashItem) => {
    setBusy(item.id);
    try {
      const { restored, lost } = await api.restoreTrash(item.id, item.notes);
      setItems((cur) => cur?.filter((i) => i.id !== item.id) ?? null);
      onChanged();
      const head = headTarget(item, restored);
      const name = head ? stemOf(head[1]) : stemOf(item.node ?? item.notes[0]);
      const text = head && head[0] !== head[1] ? t("trash.restoredAs", { name }) : t("trash.restored", { name });
      toast(lost ? `${text} · ${t("trash.lost", { count: lost })}` : text, {
        kind: lost ? "warn" : "info",
        ...(head ? { action: { label: t("common.open"), run: () => onOpen(head[1]) } } : {}),
      });
    } catch (e) {
      toastError(e);
      void load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={t("tool.trash")} size="md" onClose={onClose}>
      <div className="admin-body trash">
        {error && <p className="form-error">{error}</p>}
        {items === null && !error && <p className="meta">{t("common.loading")}</p>}
        {items?.length === 0 && next === null && <p className="meta">{t("trash.empty")}</p>}
        <ul className="trash-list">
          {items?.map((item) => {
            const head = item.node ?? item.notes[0].replace(/\.md$/i, "");
            const children = item.node ? item.notes.filter((p) => p !== `${item.node}.md`).length : 0;
            const expanded = open?.id === item.id;
            const many = item.notes.length > 1;
            const preview = open && expanded ? previews[key(open.id, open.path)] : undefined;
            return (
              <li key={item.id} className={`trash-item${expanded ? " open" : ""}`}>
                <div className="trash-row">
                  <button
                    type="button"
                    className="trash-head"
                    aria-expanded={expanded}
                    onClick={() => (expanded ? setOpen(null) : show(item.id, item.notes[0]))}
                  >
                    <ChevronRight size={14} className="trash-caret" aria-hidden />
                    {many ? <FolderClosed size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
                    <span className="trash-title">{stemOf(head)}</span>
                    {parentOf(head) && <span className="meta trash-path">{parentOf(head)}</span>}
                  </button>
                  <button type="button" className="trash-restore" disabled={busy !== null} onClick={() => void restore(item)}>
                    <RotateCcw size={14} aria-hidden /> {t("trash.restore")}
                  </button>
                </div>
                <p className="meta trash-sub">
                  {[
                    fmtDateTime(item.date),
                    !appMode.local && item.author,
                    children > 0 && t("trash.children", { count: children }),
                    !item.node && many && t("trash.others", { count: item.notes.length - 1 }),
                    item.attachments.length > 0 && t("trash.attachments", { count: item.attachments.length }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {item.lost > 0 && <span className="trash-lost"> · {t("trash.lost", { count: item.lost })}</span>}
                </p>
                {expanded && (
                  <div className="trash-body">
                    {many && (
                      <div className="trash-notes" role="group" aria-label={t("trash.preview")}>
                        {item.notes.map((p) => (
                          <button type="button" key={p} aria-pressed={open?.path === p} onClick={() => show(item.id, p)}>
                            {p.startsWith(`${item.node}/`) ? p.slice(item.node!.length + 1).replace(/\.md$/i, "") : stemOf(p)}
                          </button>
                        ))}
                      </div>
                    )}
                    {preview === undefined ? (
                      <p className="meta">{t("common.loading")}</p>
                    ) : typeof preview === "object" ? (
                      <p className="form-error">{preview.error}</p>
                    ) : (
                      <div
                        className="markdown-body trash-preview"
                        aria-label={t("trash.preview")}
                        // 읽기 전용: 미리보기 안의 링크로 다른 곳으로 가지 않는다
                        onClickCapture={(e) => (e.target as HTMLElement).closest("a") && e.preventDefault()}
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(preview, { resolver, docPath: open!.path, docId: "trash" }).html }}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {next !== null && (
          <button type="button" className="trash-more" onClick={() => void load(next)}>
            {t("trash.more")}
          </button>
        )}
      </div>
    </Modal>
  );
}
