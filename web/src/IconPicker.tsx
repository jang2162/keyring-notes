import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  activeSection,
  addRecentIcon,
  EMOJI_GROUPS,
  pastedEmoji,
  recentIcons,
  sameEmoji,
  searchable,
  searchEmoji,
  type Catalog,
  type CatalogEmoji,
  type Searchable,
} from "./emojiCatalog";
import { locale, t } from "./i18n";
import { tipProps } from "./Tooltip";

/**
 * 이모지 고르기 창(문서·폴더·데일리 기본 아이콘). 최근 쓴 것(이 기기)과 묶음별 전체 목록을 한 스크롤에 두고, 위의 묶음 단추로 건너뛴다.
 * 검색(한글·영어 이름·검색 낱말)은 묶음 없이 평평하게. 목록에 없는 이모지는 검색칸에 직접 붙여 넣고 Enter.
 * 목록(`virtual:emoji-data`, emojiCatalog.ts)은 창을 처음 열 때 불러온다.
 */
type Loaded = { groups: Catalog; all: Searchable[]; byEmoji: Map<string, CatalogEmoji> };
let loaded: Loaded | null = null;
let catalogLoad: Promise<Loaded> | null = null;
function loadCatalog() {
  catalogLoad ??= import("virtual:emoji-data").then(
    ({ default: groups }) => {
      const items = groups.flatMap((g) => g.items);
      loaded = { groups, all: items.map(searchable), byEmoji: new Map(items.map((x) => [x.e, x])) };
      return loaded;
    },
    (err: unknown) => {
      // 다음에 창을 열 때 다시 시도하려고 비우지만, 브라우저(적어도 Chromium)는 실패한 동적 import 를 모듈 맵에 기억해 같은 URL 을
      // 다시 받지 않는다 — 한 번 실패하면 페이지를 새로 고쳐야 다시 받는다(icon.loadFailed 문구가 그렇게 안내한다).
      catalogLoad = null;
      throw err;
    },
  );
  return catalogLoad;
}

const RECENT_ICON = "🕒";

const RECENT_KEY = "keyring:recent-icons";

function loadRecent(): string[] {
  try {
    return recentIcons(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]);
  } catch {
    return [];
  }
}

function remember(icon: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(addRecentIcon(loadRecent(), icon)));
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
}

export function IconPicker({
  at,
  value,
  onPick,
  onClose,
  title,
}: {
  at: { x: number; y: number };
  value?: string | null;
  onPick: (icon: string | null) => void;
  onClose: () => void;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const [recent] = useState(loadRecent);
  const [catalog, setCatalog] = useState(loaded);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const searching = !!q.trim();
  const shown = useMemo(() => (catalog && searching ? searchEmoji(catalog.all, q) : []), [catalog, q, searching]);
  const sections = [
    ...(recent.length ? [{ key: "recent", icon: RECENT_ICON, label: t("icon.recent"), items: recent }] : []),
    ...EMOJI_GROUPS.map((g) => ({
      key: g.key as string,
      icon: g.icon,
      label: t(`icon.group.${g.key}`),
      items: catalog?.groups.find((c) => c.key === g.key)?.items.map((x) => x.e) ?? [],
    })),
  ];
  const [active, setActive] = useState(sections[0].key);

  useEffect(() => {
    if (catalog) return;
    let live = true;
    loadCatalog().then(
      (c) => live && setCatalog(c),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [catalog]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
  }, [at.x, at.y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  const pick = (icon: string | null) => {
    if (icon) remember(icon);
    onPick(icon);
    onClose();
  };

  // 묶음 머리의 자리는 스크롤 영역(position: relative) 기준 offsetTop
  const sectionEls = () => [...(body.current?.querySelectorAll<HTMLElement>("[data-section]") ?? [])];
  const onScroll = () => {
    if (searching || !body.current) return;
    const cur = activeSection(
      sectionEls().map((el) => ({ key: el.dataset.section!, top: el.offsetTop })),
      body.current.scrollTop,
    );
    if (cur) setActive(cur);
  };
  const jump = (key: string) => {
    const el = sectionEls().find((s) => s.dataset.section === key);
    if (!el || !body.current) return;
    body.current.scrollTop = el.offsetTop;
    setActive(key);
  };

  const nameOf = (e: string) => {
    const it = catalog?.byEmoji.get(e);
    return it ? (locale() === "ko" ? it.ko : it.en) : e;
  };
  const cell = (e: string) => (
    <button key={e} type="button" className={value && sameEmoji(e, value) ? "on" : ""} onClick={() => pick(e)} aria-label={nameOf(e)}>
      {e}
    </button>
  );
  const status = failed ? t("icon.loadFailed") : !catalog ? t("common.loading") : null;

  return createPortal(
    <div
      ref={ref}
      className="icon-picker menu"
      role="dialog"
      aria-label={t("icon.pickTitle", { title: title ?? t("icon.title") })}
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="icon-picker-head">
        <input
          autoFocus
          type="text"
          placeholder={t("icon.searchPlaceholder")}
          aria-label={t("icon.searchLabel")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (body.current) body.current.scrollTop = 0;
            setActive(sections[0].key);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            const pasted = pastedEmoji(q);
            if (pasted) pick(pasted);
            else if (shown[0]) pick(shown[0]);
          }}
        />
        <button type="button" onClick={() => pick(null)} disabled={!value} {...tipProps({ label: t("icon.clearTip") })}>
          {t("icon.clear")}
        </button>
      </div>
      {!searching && (
        <nav className="icon-picker-tabs" aria-label={t("icon.groups")}>
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={s.key === active ? "on" : ""}
              aria-current={s.key === active || undefined}
              aria-label={s.label}
              onClick={() => jump(s.key)}
              {...tipProps({ label: s.label })}
            >
              {s.icon}
            </button>
          ))}
        </nav>
      )}
      <div ref={body} className="icon-picker-body" onScroll={onScroll}>
        {searching ? (
          <div className="icon-grid">
            {shown.map(cell)}
            {shown.length === 0 && <p className="meta">{status ?? t("icon.noMatch")}</p>}
          </div>
        ) : (
          <>
            {sections.map(
              (s) =>
                s.items.length > 0 && (
                  <section key={s.key} data-section={s.key} aria-label={s.label}>
                    <div className="icon-picker-label">{s.label}</div>
                    <div className="icon-grid">{s.items.map(cell)}</div>
                  </section>
                ),
            )}
            {status && <p className="meta">{status}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 문서·폴더 이름 앞의 아이콘(없으면 아무것도 안 그린다) */
export function DocIcon({ icon, className }: { icon?: string | null; className?: string }) {
  if (!icon) return null;
  return (
    <span className={`doc-icon${className ? ` ${className}` : ""}`} aria-hidden>
      {icon}
    </span>
  );
}

/** 경로 → 문서 아이콘(위젯 목록처럼 Workspace 밖에서 그리는 곳이 쓴다) */
export const IconLookup = createContext<(path: string) => string | null>(() => null);
