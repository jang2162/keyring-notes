import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Modal } from "./Modal";
import { t } from "./i18n";

/** 빠른 전환(문서)·명령 팔레트 공용 항목 */
export interface PaletteItem {
  id: string;
  label: string;
  /** 보조 설명(폴더, 단축키 등) */
  detail?: string;
  /** 앞에 붙는 아이콘(문서 아이콘) */
  icon?: ReactNode;
  /** 이름 대신 보일 것(데일리 노트: 날짜 흐리게·제목 진하게). 검색은 label로 한다 */
  display?: ReactNode;
  /** Enter(또는 Ctrl/Cmd+Enter면 alt=true) */
  run: (alt: boolean) => void;
}

/**
 * 순서를 지키는 부분 일치(띄어 쓴 단어는 각각) 점수. 낮을수록 좋다. 맞지 않으면 null.
 * 앞쪽·연속으로 맞을수록, 파일 이름에서 맞을수록 높게 친다.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  let total = 0;
  for (const word of q.split(/\s+/)) {
    const direct = t.indexOf(word);
    if (direct >= 0) {
      total += direct;
      continue;
    }
    let pos = -1;
    let gaps = 0;
    for (const ch of word) {
      const next = t.indexOf(ch, pos + 1);
      if (next < 0) return null;
      if (pos >= 0) gaps += next - pos - 1;
      pos = next;
    }
    total += 50 + gaps * 3;
  }
  return total;
}

/**
 * 목록 키: ↑↓ 로 옮기고 Enter 로 고른다. numbered 면 1~9 가 그 번째 항목을 바로 고른다(10번째부터는 번호가 없다).
 * 처리하지 않는 키면 null
 */
export function paletteKey(key: string, sel: number, count: number, numbered: boolean): { sel: number } | { choose: number } | null {
  if (key === "ArrowDown") return { sel: Math.min(sel + 1, count - 1) };
  if (key === "ArrowUp") return { sel: Math.max(sel - 1, 0) };
  if (key === "Enter") return { choose: sel };
  if (numbered && /^[1-9]$/.test(key)) {
    const i = Number(key) - 1;
    return i < count ? { choose: i } : null;
  }
  return null;
}

/**
 * numbered: 짧은 고르기 목록(데일리 워크스페이스 등). 찾기 칸 없이 목록이 키를 받고, 앞 9개에 번호를 붙여 숫자로 고른다 —
 * 찾기 칸이 있으면 숫자가 칸에 들어가고 터치에서 키보드가 올라온다
 */
export function Palette({
  placeholder,
  items,
  onClose,
  hint,
  numbered = false,
}: {
  placeholder: string;
  items: PaletteItem[];
  onClose: () => void;
  hint?: string;
  numbered?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    if (!query.trim()) return items.slice(0, 200);
    return items
      .map((it) => ({ it, s: fuzzyScore(query, `${it.label} ${it.detail ?? ""}`), n: fuzzyScore(query, it.label) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (a.n ?? 999) - (b.n ?? 999) || a.s! - b.s! || a.it.label.length - b.it.label.length)
      .slice(0, 200)
      .map((x) => x.it);
  }, [items, query]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: number, alt: boolean) => {
    const it = shown[i];
    if (!it) return;
    onClose();
    it.run(alt);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    // 번호 목록은 수식키 조합(Alt+숫자 등 앱 단축키)을 가로채지 않는다
    if (numbered && (e.altKey || ((e.ctrlKey || e.metaKey) && e.key !== "Enter"))) return;
    const r = paletteKey(e.key, sel, shown.length, numbered);
    if (!r) return;
    e.preventDefault();
    if ("sel" in r) setSel(r.sel);
    else choose(r.choose, e.ctrlKey || e.metaKey);
  };

  return (
    <Modal title={placeholder} label={placeholder} size="palette" hideHead escapeFromInputs onClose={onClose} className="palette">
      {numbered ? (
        <p className="palette-title">{placeholder}</p>
      ) : (
        <input autoFocus placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} aria-label={placeholder} />
      )}
      <ul
        ref={listRef}
        role="listbox"
        {...(numbered
          ? {
              tabIndex: 0,
              "data-autofocus": true,
              "aria-label": placeholder,
              "aria-activedescendant": shown[sel] ? `palette-opt-${sel}` : undefined,
              onKeyDown: onKey,
            }
          : {})}
      >
        {shown.map((it, i) => (
          <li
            key={it.id}
            id={numbered ? `palette-opt-${i}` : undefined}
            data-i={i}
            role="option"
            aria-selected={i === sel}
            className={i === sel ? "on" : ""}
            onMouseEnter={() => setSel(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(i, e.ctrlKey || e.metaKey);
            }}
          >
            <span className="palette-label">
              {numbered && <kbd className="palette-num">{i < 9 ? i + 1 : ""}</kbd>}
              {it.icon}
              {it.display ?? it.label}
            </span>
            {it.detail && <span className="palette-detail">{it.detail}</span>}
          </li>
        ))}
        {shown.length === 0 && <li className="meta">{t("palette.none")}</li>}
      </ul>
      {hint && <p className="meta palette-hint">{hint}</p>}
    </Modal>
  );
}
