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

export function Palette({ placeholder, items, onClose, hint }: { placeholder: string; items: PaletteItem[]; onClose: () => void; hint?: string }) {
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

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(sel, e.ctrlKey || e.metaKey);
    }
  };

  return (
    <Modal title={placeholder} label={placeholder} size="palette" hideHead escapeFromInputs onClose={onClose} className="palette">
        <input autoFocus placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} aria-label={placeholder} />
        <ul ref={listRef} role="listbox">
          {shown.map((it, i) => (
            <li
              key={it.id}
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
