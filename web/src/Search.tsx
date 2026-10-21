import { Folder, X } from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { SearchHit } from "./api";
import { fmtNumber, t } from "./i18n";
import { DocIcon } from "./IconPicker";
import { filterActive, NO_FILTER, selectionFor, shownMatches, type SearchFilter } from "./searchFilter";
import { tipProps } from "./Tooltip";

/** 검색 패널의 필터 줄: 폴더 고르기, 태그 칩(모두 가진 문서), 필터 지우기 */
export function SearchFilters({
  filter,
  scope,
  tags,
  onChange,
  onPickFolder,
}: {
  filter: SearchFilter;
  /** 지금 범위(워크스페이스, 모든 워크스페이스면 빈 글). 폴더 이름은 이 범위 안의 경로로 보인다 */
  scope: string;
  /** 고를 수 있는 태그(지금 범위·폴더 안) */
  tags: { tag: string; count: number }[];
  onChange: (f: SearchFilter) => void;
  onPickFolder: () => void;
}) {
  const left = tags.filter((x) => !filter.tags.includes(x.tag));
  const folderName = scope && filter.folder.startsWith(scope + "/") ? filter.folder.slice(scope.length + 1) : filter.folder;
  return (
    <div className="search-filters" role="group" aria-label={t("search.filters")}>
      <span className={`search-chip${filter.folder ? " on" : ""}`}>
        <button className="search-chip-main" onClick={onPickFolder} {...tipProps({ label: t("search.folderTip") })}>
          <Folder size={13} aria-hidden />
          <span className="search-chip-name">{folderName || t("search.allFolders")}</span>
        </button>
        {filter.folder && (
          <button className="search-chip-x" aria-label={t("search.removeFilter", { name: folderName })} onClick={() => onChange({ ...filter, folder: "" })}>
            <X size={12} aria-hidden />
          </button>
        )}
      </span>
      {filter.tags.map((tag) => (
        <span key={tag} className="search-chip on">
          <span className="search-chip-name">#{tag}</span>
          <button
            className="search-chip-x"
            aria-label={t("search.removeFilter", { name: `#${tag}` })}
            onClick={() => onChange({ ...filter, tags: filter.tags.filter((x) => x !== tag) })}
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
        <button className="search-clear" onClick={() => onChange(NO_FILTER)}>
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
  query,
  semantic,
  current,
  iconOf,
  onGo,
}: {
  hits: (SearchHit & { score?: number })[];
  query: string;
  /** 의미 검색 결과(고를 글이 없다) */
  semantic: boolean;
  /** 지금 문서 경로 */
  current: string | null;
  iconOf: (path: string) => string | null | undefined;
  /** 그 문서의 그 줄로. text: 고를 글, newTab: Ctrl/Cmd 를 누르고 눌렀을 때 */
  onGo: (path: string, line: number, text: string | undefined, newTab: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string, on: boolean) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
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
            {more > 0 && (
              <button className="hit-more" aria-expanded={false} onClick={() => toggle(h.path, true)}>
                {t("search.moreLines", { count: more })}
              </button>
            )}
            {open && (
              <>
                {beyond > 0 && <span className="hit-beyond meta">{t("search.beyondLines", { count: beyond })}</span>}
                <button className="hit-more" aria-expanded onClick={() => toggle(h.path, false)}>
                  {t("search.fewerLines")}
                </button>
              </>
            )}
          </li>
        );
      })}
      {hits.length === 0 && <li className="meta">{t("search.none")}</li>}
    </ul>
  );
}
