import { useEffect, useRef, type ReactNode } from "react";
import { Ellipsis, Files, Plus, Search, type LucideIcon } from "lucide-react";
import { pressOutcome, LONG_PRESS_MS } from "./bottomBarState";
import { Modal } from "./Modal";
import { t } from "./i18n";

/** 「더 보기」 목록의 항목(레일에 있던 것 중 바에 없는 것) */
export interface MoreEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  dot?: boolean;
  run(): void;
}

/** 「더 보기」 목록 맨 위의 상태 줄(좁은 화면에는 상태 표시줄이 없다). run 이 있으면 눌러서 그 일을 한다 */
export interface MoreStatusLine {
  id: string;
  text: string;
  kind: "" | "warn" | "error";
  run?: () => void;
}

const countText = (n: number) => (n > 99 ? "99+" : String(n));

function Cell({
  icon: Icon,
  label,
  className,
  pressed,
  children,
  onClick,
}: {
  /** 없으면 children 만(탭 칸: 네모 안의 탭 수) */
  icon?: LucideIcon;
  label: string;
  className?: string;
  pressed?: boolean;
  children?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`bar-cell${className ? ` ${className}` : ""}`} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <span className="bar-icon">
        {Icon && <Icon size={20} strokeWidth={1.75} aria-hidden />}
        {children}
      </span>
      <span className="bar-name" aria-hidden>
        {label}
      </span>
    </button>
  );
}

/**
 * 좁은 화면의 하단 바: 파일 · 검색 · ＋ 새 노트 · 탭 · 더 보기. 각 칸은 이미 있는 동작을 부른다(Workspace 가 넘긴다).
 * ＋ 를 길게 누르면 오늘 노트(onNewHold) — 그때는 손을 떼며 오는 click 을 한 번 무시해 새 노트가 또 생기지 않게 한다.
 * ＋ 에는 툴팁(data-tip)을 달지 않는다: 앱 툴팁도 터치 길게 누르기(500ms)를 쓰므로 둘이 겹친다.
 */
export function BottomBar({
  active,
  tabCount,
  canNew,
  badge,
  onFiles,
  onSearch,
  onNew,
  onNewHold,
  onTabs,
  onMore,
}: {
  active: "files" | "search" | null;
  tabCount: number;
  canNew: boolean;
  badge: number | "dot" | null;
  onFiles(): void;
  onSearch(): void;
  onNew(): void;
  onNewHold: (() => void) | null;
  onTabs(): void;
  onMore(): void;
}) {
  const press = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; fired: boolean } | null>(null);
  /** 길게 누르기를 했으면 이어지는 click 하나를 무시한다 */
  const skipClick = useRef(false);
  const holdRef = useRef(onNewHold);
  holdRef.current = onNewHold;
  const clear = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => clear, []);

  return (
    <nav className="bottom-bar" aria-label={t("bar.label")}>
      <Cell icon={Files} label={t("rail.files")} pressed={active === "files"} onClick={onFiles} />
      <Cell icon={Search} label={t("rail.search")} pressed={active === "search"} onClick={onSearch} />
      <button
        type="button"
        className="bar-cell bar-new"
        aria-label={t("tree.newNote")}
        aria-description={onNewHold ? t("bar.newHold") : undefined}
        disabled={!canNew}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          clear();
          skipClick.current = false;
          const p = { at: performance.now(), timer: null as ReturnType<typeof setTimeout> | null, fired: false };
          if (holdRef.current)
            p.timer = setTimeout(() => {
              p.fired = true;
              skipClick.current = true;
              holdRef.current?.();
            }, LONG_PRESS_MS);
          press.current = p;
        }}
        onPointerUp={() => {
          const p = press.current;
          if (!p) return;
          clear();
          if (pressOutcome(performance.now() - p.at, !!holdRef.current) === "hold") {
            skipClick.current = true;
            // 타이머가 늦어 아직 안 불렸으면 여기서 부른다(한 번만)
            if (!p.fired) holdRef.current?.();
          }
        }}
        onPointerCancel={clear}
        onPointerLeave={clear}
        // 안드로이드는 길게 누르면 contextmenu 를 보낸다 — 기본 메뉴가 뜨지 않게
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (skipClick.current) {
            skipClick.current = false;
            return;
          }
          onNew();
        }}
      >
        <span className="bar-icon">
          <Plus size={20} strokeWidth={2} aria-hidden />
        </span>
        <span className="bar-name" aria-hidden>
          {t("tree.newNote")}
        </span>
      </button>
      <Cell label={t("bar.tabs")} className="bar-tabs" onClick={onTabs}>
        {/* 모바일 브라우저처럼 네모 안에 열린 탭 수(예전 위쪽 탭 개수 단추) */}
        <span className="bar-tab-count">{countText(tabCount)}</span>
      </Cell>
      <Cell icon={Ellipsis} label={t("bar.more")} onClick={onMore}>
        {typeof badge === "number" ? (
          <span className="bar-badge">{countText(badge)}</span>
        ) : badge === "dot" ? (
          <span className="update-dot bar-dot" aria-hidden />
        ) : null}
      </Cell>
    </nav>
  );
}

/** 「더 보기」 시트의 내용: 위에 상태 줄, 아래 항목 목록. 항목을 누르면 시트를 닫고 그 일을 한다 */
export function MoreSheetBody({ status, entries, onClose }: { status: MoreStatusLine[]; entries: MoreEntry[]; onClose(): void }) {
  const go = (run: () => void) => {
    onClose();
    run();
  };
  return (
    <>
      {status.length > 0 && (
        <div className="more-status-list">
          {status.map((s) => {
            const cls = `more-status${s.kind ? ` ${s.kind}` : ""}`;
            return s.run ? (
              <button key={s.id} type="button" className={cls} onClick={() => go(s.run!)}>
                {s.text}
              </button>
            ) : (
              <p key={s.id} className={cls}>
                {s.text}
              </p>
            );
          })}
        </div>
      )}
      <ul className="more-list">
        {entries.map((e) => (
          <li key={e.id}>
            <button type="button" className="more-item" onClick={() => go(e.run)}>
              <e.icon size={18} strokeWidth={1.75} aria-hidden />
              <span className="more-label">{e.label}</span>
              {e.badge ? <span className="bar-badge">{countText(e.badge)}</span> : null}
              {e.dot ? <span className="update-dot bar-dot" aria-hidden /> : null}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** 「더 보기」 시트: 탭 시트(TabSwitcher)와 같은 틀 — 배경을 누르거나 Esc 로 닫힌다 */
export function MoreSheet(props: { status: MoreStatusLine[]; entries: MoreEntry[]; onClose(): void }) {
  return (
    <Modal title={t("bar.more")} size="sm" onClose={props.onClose} bodyClassName="more-sheet-body">
      <MoreSheetBody {...props} />
    </Modal>
  );
}
