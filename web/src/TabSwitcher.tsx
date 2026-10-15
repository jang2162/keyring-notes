import type { ReactNode } from "react";
import { FilePlus, X } from "lucide-react";
import { DocIcon } from "./IconPicker";
import { Modal } from "./Modal";
import { t } from "./i18n";
import { tipProps } from "./Tooltip";
import { stemOf } from "./Tree";

/** 좁은 화면의 탭 개수 단추: 모바일 브라우저처럼 열린 탭 수를 네모 안에 보인다 */
export function TabCountButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className="tab-count" aria-label={t("tab.switch", { count })} {...tipProps({ label: t("tab.switch", { count }) })} onClick={onClick}>
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
    </button>
  );
}

/**
 * 좁은 화면의 열린 탭 목록(화면 전체 시트). 탭 줄 대신 여기서 골라 전환하고, 닫고, 새 노트를 만든다.
 * 고르거나 새로 만들면 닫힌다. 탭을 닫아도 목록은 열려 있다(여러 개를 차례로 닫는다)
 */
export function TabSwitcher({
  tabs,
  active,
  isDirty,
  label,
  icon,
  onPick,
  onCloseTab,
  onNew,
  canNew,
  onClose,
}: {
  tabs: string[];
  active: string | null;
  isDirty: (path: string) => boolean;
  label: (path: string) => ReactNode;
  icon: (path: string) => string | null;
  onPick: (path: string) => void;
  onCloseTab: (path: string) => void;
  onNew: () => void;
  canNew: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title={t("tab.label")} size="sm" onClose={onClose} bodyClassName="tab-sheet-body">
      <button type="button" className="tab-sheet-new" disabled={!canNew} onClick={onNew}>
        <FilePlus size={16} aria-hidden /> {t("tree.newNote")}
      </button>
      {tabs.length === 0 ? (
        <p className="meta tab-sheet-empty">{t("tab.none")}</p>
      ) : (
        <ul className="tab-sheet" aria-label={t("tab.label")}>
          {tabs.map((tp) => {
            const dir = tp.includes("/") ? tp.slice(0, tp.lastIndexOf("/")) : "";
            return (
              <li key={tp} className={tp === active ? "on" : undefined}>
                <button type="button" className="tab-sheet-open" aria-current={tp === active || undefined} onClick={() => onPick(tp)}>
                  <span className="tab-sheet-name">
                    <DocIcon icon={icon(tp)} />
                    {label(tp)}
                  </span>
                  {dir && <span className="tab-sheet-path">{dir}</span>}
                </button>
                {isDirty(tp) ? <span className="tab-dirty" aria-label={t("status.unsaved")} /> : null}
                <button type="button" className="tab-sheet-close icon-btn" aria-label={t("tab.closeName", { name: stemOf(tp) })} onClick={() => onCloseTab(tp)}>
                  <X size={16} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
