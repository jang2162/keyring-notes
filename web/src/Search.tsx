import { Folder, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { SearchHit } from "./api";
import { fmtNumber, t } from "./i18n";
import { DocIcon } from "./IconPicker";
import {
  chipAfterRemove,
  filterActive,
  followSearch,
  NO_EXPANDED,
  NO_FILTER,
  selectionFor,
  shownMatches,
  toggleExpanded,
  type SearchFilter,
} from "./searchFilter";
import { tipProps } from "./Tooltip";

/** 검색 패널의 필터 줄: 폴더 고르기, 태그 칩(모두 가진 문서), 필터 지우기 */
export function SearchFilters({
  filter,
  scope,
  tags,
  onChange,
  onPickFolder,
  onFocusSearch,
}: {
  filter: SearchFilter;
  /** 지금 범위(워크스페이스, 모든 워크스페이스면 빈 글). 폴더 이름은 이 범위 안의 경로로 보인다 */
  scope: string;
  /** 고를 수 있는 태그(지금 범위·폴더 안) */
  tags: { tag: string; count: number }[];
  onChange: (f: SearchFilter) => void;
  onPickFolder: () => void;
  onFocusSearch: () => void;
}) {
  const left = tags.filter((x) => !filter.tags.includes(x.tag));
  // 칩 × ·「필터 지우기」는 누르면 그 단추가 사라져 포커스가 body 로 떨어진다. 키보드로 눌렀으면 다음 칩(없으면 검색 칸)으로 옮긴다.
  // 포인터로 누른 것은 두지 않는다 — 터치 화면에서 검색 칸에 포커스를 주면 화면 키보드가 올라온다
  const xButtons = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<{ tag: string | null } | null>(null);
  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const next = r.tag === null ? undefined : xButtons.current.get(r.tag);
    if (next) next.focus();
    else onFocusSearch();
  });
  const remove = (e: MouseEvent, removed: string | null, next: SearchFilter) => {
    // 키보드(Enter·Space)로 누른 click 은 detail 이 0 이다
    if (e.detail === 0) refocus.current = { tag: next.tags.length === 0 ? null : chipAfterRemove(filter.tags, removed) };
    onChange(next);
  };
  const folderName = scope && filter.folder.startsWith(scope + "/") ? filter.folder.slice(scope.length + 1) : filter.folder;
  return (
    <div className="search-filters" role="group" aria-label={t("search.filters")}>
      <span className={`search-chip${filter.folder ? " on" : ""}`}>
        <button className="search-chip-main" onClick={onPickFolder} {...tipProps({ label: t("search.folderTip") })}>
          <Folder size={13} aria-hidden />
          <span className="search-chip-name">{folderName || t("search.allFolders")}</span>
        </button>
        {filter.folder && (
          <button
            className="search-chip-x"
            aria-label={t("search.removeFilter", { name: folderName })}
            onClick={(e) => remove(e, null, { ...filter, folder: "" })}
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </span>
      {filter.tags.map((tag) => (
        <span key={tag} className="search-chip on">
          <span className="search-chip-name">#{tag}</span>
          <button
            className="search-chip-x"
            ref={(el) => {
              if (el) xButtons.current.set(tag, el);
              else xButtons.current.delete(tag);
            }}
            aria-label={t("search.removeFilter", { name: `#${tag}` })}
            onClick={(e) => remove(e, tag, { ...filter, tags: filter.tags.filter((x) => x !== tag) })}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select
          className="search-add-tag"
          value=""
          aria-label={t("search.addTag")}
          onChange={(e) => e.target.value && onChange({ ...filter, tags: [...filter.tags, e.target.value] })}
        >
          <option value="">{t("search.addTag")}</option>
          {left.map((x) => (
            <option key={x.tag} value={x.tag}>
              #{x.tag} ({fmtNumber(x.count)})
            </option>
          ))}
        </select>
      )}
      {filterActive(filter) && (
        <button className="search-clear" onClick={(e) => remove(e, null, NO_FILTER)}>
          {t("search.clearFilters")}
        </button>
      )}
    </div>
  );
}

/**
 * 검색 결과 목록. 문서마다 일치 줄을 몇 줄 보이고 나머지는 「N줄 더」로 편다(줄이 없는 결과 — 의미 검색·태그로만 맞음 — 는 요약 한 줄).
 * 문서 머리를 누르면 첫 일치 줄로, 줄을 누르면 그 줄로 간다.
 */
export function SearchResults({
  hits,
  offline = false,
  query,
  searchKey,
  semantic,
  current,
  iconOf,
  onGo,
}: {
  hits: (SearchHit & { score?: number })[];
  /** 연결이 없어 검색하지 못했다: 빈 결과를 「결과 없음」으로 보이지 않는다 */
  offline?: boolean;
  query: string;
  /** 지금 검색(검색어·필터, searchFilter.ts searchKey). 바뀌면 펼친 결과를 다시 접는다 */
  searchKey: string;
  /** 의미 검색 결과(고를 글이 없다) */
  semantic: boolean;
  /** 지금 문서 경로 */
  current: string | null;
  iconOf: (path: string) => string | null | undefined;
  /** 그 문서의 그 줄로. text: 고를 글, newTab: Ctrl/Cmd 를 누르고 눌렀을 때 */
  onGo: (path: string, line: number, text: string | undefined, newTab: boolean) => void;
}) {
  const [expandedHits, setExpandedHits] = useState(NO_EXPANDED);
  // 검색어·필터가 바뀌면 펼친 결과를 비운다(그리는 중에 상태를 맞추는 React 의 방식 — 이 그림은 버리고 바로 다시 그린다)
  const followed = followSearch(expandedHits, searchKey);
  if (followed !== expandedHits) setExpandedHits(followed);
  const expanded = followed.paths;
  const toggle = (path: string, on: boolean) => setExpandedHits((e) => toggleExpanded(e, searchKey, path, on));
  const go = (path: string, line: number, snippet: string) => (e: MouseEvent) => {
    e.preventDefault();
    onGo(path, line, semantic ? undefined : selectionFor(query, snippet), e.ctrlKey || e.metaKey);
  };
  const href = (path: string) => `#/${encodeURIComponent(path)}`;

  return (
    <ul className="search-results">
      {hits.map((h) => {
        const open = expanded.has(h.path);
        const { lines, more, beyond } = shownMatches(h, open);
        return (
          <li key={h.path} className="search-hit">
            <a href={href(h.path)} className={h.path === current ? "active" : ""} onClick={go(h.path, h.line, h.snippet)}>
              <span className="hit-title">
                <DocIcon icon={iconOf(h.path)} />
                {h.title} {h.score !== undefined && <span className="hit-score">{h.score.toFixed(2)}</span>}
              </span>
              <span className="hit-path">
                {h.path}
                {!h.matches && h.line > 1 ? ` · ${t("search.line", { line: h.line })}` : ""}
              </span>
              {!h.matches && h.snippet && <span className="hit-snippet">{h.snippet}</span>}
            </a>
            {lines.length > 0 && (
              <ul className="hit-lines">
                {lines.map((m) => (
                  <li key={m.line}>
                    <a href={href(h.path)} onClick={go(h.path, m.line, m.snippet)} aria-label={`${t("search.line", { line: m.line })}: ${m.snippet}`}>
                      <span className="hit-line-no" aria-hidden>
                        {m.line}
                      </span>
                      <span className="hit-line-text" aria-hidden>
                        {m.snippet}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {beyond > 0 && <span className="hit-beyond meta">{t("search.beyondLines", { count: beyond })}</span>}
            {/* 펴기·접기는 같은 단추 하나다 — 단추가 바뀌면 키보드로 누른 뒤 포커스가 body 로 떨어진다 */}
            {(more > 0 || open) && (
              <button className="hit-more" aria-expanded={open} onClick={() => toggle(h.path, !open)}>
                {open ? t("search.fewerLines") : t("search.moreLines", { count: more })}
              </button>
            )}
          </li>
        );
      })}
      {hits.length === 0 && <li className="meta">{offline ? t("search.offline") : t("search.none")}</li>}
    </ul>
  );
}
