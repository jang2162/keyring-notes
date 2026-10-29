import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLanguage, t } from "./i18n";
import { SearchResults } from "./Search";

/** 결과 칸의 글(따옴표 등은 HTML 이스케이프를 푼다) */
const render = (offline?: boolean) =>
  renderToStaticMarkup(
    <SearchResults hits={[]} offline={offline} query="낱말" searchKey="낱말" semantic={false} current={null} iconOf={() => null} onGo={() => undefined} />,
  )
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

describe("검색 결과가 비었을 때", () => {
  it("연결이 없어 실패했으면 「결과 없음」이 아니라 검색할 수 없다고 말한다", () => {
    for (const lang of ["en", "ko"]) {
      setLanguage(lang);
      const html = render(true);
      expect(html).toContain(t("search.offline"));
      expect(html).not.toContain(t("search.none"));
    }
  });

  it("검색이 됐는데 없으면 「결과 없음」", () => {
    setLanguage("en");
    expect(render(false)).toContain(t("search.none"));
    expect(render()).toContain(t("search.none"));
  });
});
