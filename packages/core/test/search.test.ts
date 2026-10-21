import { describe, expect, it } from "vitest";
import { hasAllTags, LocalVault, matchLines, MemoryStore, parseSearchQuery, PathError, searchHit, SEARCH_LINES_MAX } from "../src/index.js";

async function vault(files: Record<string, string>) {
  const store = new MemoryStore();
  for (const [p, c] of Object.entries(files)) store.touch(p, c);
  const v = new LocalVault(store, { author: "노트북" });
  await v.open();
  return v;
}

describe("검색어 나누기", () => {
  it("`#태그` 단어와 태그 칩을 태그 조건으로 합친다(소문자, `#` 떼기, 겹침 하나로)", () => {
    expect(parseSearchQuery("#A 금리 #a/x", ["#B", " c ", "a", ""])).toEqual({ text: ["금리"], tags: ["a", "a/x", "b", "c"] });
    // `#` 하나만 있는 단어는 글이다
    expect(parseSearchQuery("# 제목")).toEqual({ text: ["#", "제목"], tags: [] });
  });

  it("태그 조건은 모두 가져야 하고(AND), 하위 태그는 맞지만 앞부분만 같은 태그는 아니다", () => {
    expect(hasAllTags(["a/b", "c"], ["a", "c"])).toBe(true);
    expect(hasAllTags(["a", "c"], ["a", "d"])).toBe(false);
    expect(hasAllTags(["ab"], ["a"])).toBe(false);
    expect(hasAllTags([], [])).toBe(true);
  });
});

describe("일치 줄", () => {
  const body = "# 금리\n없음\n기준금리 동결\nKRW 환율\n금리 인하\n환율과 금리";

  it("단어 중 하나라도 든 줄을 앞에서부터 max 개, 전체 개수와 함께(대소문자 가리지 않음)", () => {
    expect(matchLines(body, ["금리", "krw"], 2)).toEqual({
      matches: [
        { line: 1, snippet: "# 금리" },
        { line: 3, snippet: "기준금리 동결" },
      ],
      count: 5,
    });
    expect(matchLines(body, [], 3)).toEqual({ matches: [], count: 0 });
  });

  it("lines 를 안 주면 예전 모양(첫 줄만), 주면 matches·matchCount 를 붙인다. 상한은 SEARCH_LINES_MAX", () => {
    expect(searchHit("a.md", "a", body, ["환율"])).toEqual({ path: "a.md", title: "a", line: 4, snippet: "KRW 환율" });
    expect(searchHit("a.md", "a", body, ["환율"], 3)).toEqual({
      path: "a.md",
      title: "a",
      line: 4,
      snippet: "KRW 환율",
      matches: [
        { line: 4, snippet: "KRW 환율" },
        { line: 6, snippet: "환율과 금리" },
      ],
      matchCount: 2,
    });
    // 글 단어 없이 태그로만 맞은 문서
    expect(searchHit("a.md", "a", body, [], 3)).toEqual({ path: "a.md", title: "a", line: 1, snippet: "", matches: [], matchCount: 0 });
    const many = Array.from({ length: SEARCH_LINES_MAX + 7 }, (_, i) => `x ${i}`).join("\n");
    const hit = searchHit("m.md", "m", many, ["x"], 999);
    expect(hit.matches).toHaveLength(SEARCH_LINES_MAX);
    expect(hit.matchCount).toBe(SEARCH_LINES_MAX + 7);
  });
});

describe("로컬 볼트 검색 필터", () => {
  const files = {
    "업무.md": "# 업무\n금리 회의 #회의",
    "업무/계획.md": "---\ntags: [프로젝트/a, 회의]\n---\n# 계획\n금리 1\n금리 2\n금리 3\n금리 4\n금리 5",
    "업무/메모.md": "# 메모\n금리 #프로젝트",
    "업무2/다른.md": "# 다른\n금리 #회의",
    "개인/일기.md": "# 일기\n금리 #회의 #프로젝트",
  };

  it("folder: 그 노드의 노트와 하위만(앞부분만 같은 형제는 빼고)", async () => {
    const v = await vault(files);
    expect(
      v
        .search("금리", { folder: "업무" })
        .map((h) => h.path)
        .sort(),
    ).toEqual(["업무.md", "업무/계획.md", "업무/메모.md"]);
    expect(v.search("금리", { folder: "업무/계획" }).map((h) => h.path)).toEqual(["업무/계획.md"]);
  });

  it("tags: 모두 가진 문서만, `#태그` 문법과 함께면 둘 다 만족, 글 없이 칩만으로도 찾는다", async () => {
    const v = await vault(files);
    expect(
      v
        .search("금리", { tags: ["회의"] })
        .map((h) => h.path)
        .sort(),
    ).toEqual(["개인/일기.md", "업무.md", "업무/계획.md", "업무2/다른.md"]);
    expect(
      v
        .search("금리", { tags: ["회의", "프로젝트"] })
        .map((h) => h.path)
        .sort(),
    ).toEqual(["개인/일기.md", "업무/계획.md"]);
    expect(
      v
        .search("#프로젝트 금리", { tags: ["회의"] })
        .map((h) => h.path)
        .sort(),
    ).toEqual(["개인/일기.md", "업무/계획.md"]);
    expect(
      v
        .search("", { tags: ["프로젝트"], folder: "업무" })
        .map((h) => h.path)
        .sort(),
    ).toEqual(["업무/계획.md", "업무/메모.md"]);
    expect(() => v.search("  ", { tags: [] })).toThrow(PathError);
  });

  it("lines: 결과마다 일치 줄과 전체 개수", async () => {
    const v = await vault(files);
    const [hit] = v.search("금리", { folder: "업무/계획", lines: 3 });
    expect(hit.matches).toEqual([
      { line: 5, snippet: "금리 1" },
      { line: 6, snippet: "금리 2" },
      { line: 7, snippet: "금리 3" },
    ]);
    expect(hit.matchCount).toBe(5);
    expect(v.search("금리", { folder: "업무/계획" })[0]).toEqual({ path: "업무/계획.md", title: "계획", line: 5, snippet: "금리 1" });
  });
});
