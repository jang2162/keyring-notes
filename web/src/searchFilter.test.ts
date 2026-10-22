import { buildNodeTree } from "@keyring-notes/core";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "./api";
import {
  chipAfterRemove,
  folderChoices,
  folderInScope,
  followSearch,
  hasSearchTerms,
  NO_EXPANDED,
  NO_FILTER,
  SEARCH_LINES_FETCH,
  SEARCH_LINES_SHOWN,
  searchKey,
  selectionFor,
  shownMatches,
  toggleExpanded,
} from "./searchFilter";

const hit = (count: number, returned = count): SearchHit => ({
  path: "a.md",
  title: "a",
  line: 1,
  snippet: "x",
  matches: Array.from({ length: returned }, (_, i) => ({ line: i + 1, snippet: `x ${i + 1}` })),
  matchCount: count,
});

describe("검색 필터", () => {
  it("글 단어나 태그 조건(문법·칩)이 있어야 찾는다. 폴더만으로는 찾지 않는다", () => {
    expect(hasSearchTerms("", NO_FILTER)).toBe(false);
    expect(hasSearchTerms("  ", { folder: "업무", tags: [] })).toBe(false);
    expect(hasSearchTerms("", { folder: "", tags: ["회의"] })).toBe(true);
    expect(hasSearchTerms("#회의", NO_FILTER)).toBe(true);
    expect(hasSearchTerms("금리", NO_FILTER)).toBe(true);
  });

  it("폴더 고르기: 트리 안에서 하위가 있는 노드만(노트 하나뿐인 노드는 빼고)", () => {
    const nodes = buildNodeTree([
      {
        name: "업무",
        path: "업무",
        type: "dir",
        children: [
          { name: "프로젝트", path: "업무/프로젝트", type: "dir", children: [{ name: "a.md", path: "업무/프로젝트/a.md", type: "file" }] },
          { name: "메모.md", path: "업무/메모.md", type: "file" },
        ],
      },
      { name: "업무.md", path: "업무.md", type: "file" },
    ]);
    expect(folderChoices(nodes)).toEqual(["업무", "업무/프로젝트"]);
  });

  it("칩 × 로 지운 뒤 포커스: 지운 칩 다음의 태그 칩, 없으면 검색 칸(null)", () => {
    expect(chipAfterRemove(["a", "b", "c"], "a")).toBe("b");
    expect(chipAfterRemove(["a", "b", "c"], "b")).toBe("c");
    expect(chipAfterRemove(["a", "b", "c"], "c")).toBeNull();
    // 폴더 칩 다음은 첫 태그 칩
    expect(chipAfterRemove(["a", "b"], null)).toBe("a");
    expect(chipAfterRemove([], null)).toBeNull();
  });

  it("워크스페이스가 바뀌면 그 범위 밖의 폴더는 걷는다(앞부분만 같은 형제는 밖)", () => {
    expect(folderInScope("업무/프로젝트", "업무")).toBe(true);
    expect(folderInScope("업무", "업무")).toBe(true);
    expect(folderInScope("업무2/x", "업무")).toBe(false);
    expect(folderInScope("개인/x", "")).toBe(true);
  });
});

describe("결과의 일치 줄", () => {
  it(`접혀 있으면 앞의 ${SEARCH_LINES_SHOWN}줄과 「N줄 더」, 펼치면 받은 줄 전부`, () => {
    expect(shownMatches(hit(2), false)).toMatchObject({ more: 0, beyond: 0 });
    expect(shownMatches(hit(2), false).lines).toHaveLength(2);
    const closed = shownMatches(hit(7), false);
    expect(closed.lines.map((m) => m.line)).toEqual([1, 2, 3]);
    expect(closed.more).toBe(4);
    expect(shownMatches(hit(7), true)).toMatchObject({ more: 0, beyond: 0 });
    expect(shownMatches(hit(7), true).lines).toHaveLength(7);
  });

  it("받은 줄(화면은 SEARCH_LINES_FETCH)을 넘은 줄은 「N줄 더」에 세고, 펼친 뒤에는 남은 수로 보인다", () => {
    expect(shownMatches(hit(60, 50), false).more).toBe(57);
    expect(shownMatches(hit(60, 50), true)).toMatchObject({ more: 0, beyond: 10 });
    const big = hit(12, SEARCH_LINES_FETCH);
    expect(shownMatches(big, false).more).toBe(12 - SEARCH_LINES_SHOWN);
    expect(shownMatches(big, true).lines).toHaveLength(SEARCH_LINES_FETCH);
    expect(shownMatches(big, true).beyond).toBe(2);
  });

  it("펼친 결과는 그 검색(검색어·폴더·태그) 동안만 남고, 바뀌면 비어 같은 검색으로 돌아와도 접힌 채다", () => {
    const k = searchKey("금리", NO_FILTER);
    const open = toggleExpanded(NO_EXPANDED, k, "a.md", true);
    expect([...followSearch(open, k).paths]).toEqual(["a.md"]);
    // 앞뒤 공백만 다르면 같은 검색(같은 객체라 다시 그리지 않는다)
    expect(followSearch(open, searchKey(" 금리 ", NO_FILTER))).toBe(open);
    for (const other of [searchKey("금리 줄", NO_FILTER), searchKey("금리", { folder: "업무", tags: [] }), searchKey("금리", { folder: "", tags: ["회의"] })]) {
      const changed = followSearch(open, other);
      expect(changed.paths.size).toBe(0);
      expect(followSearch(changed, k).paths.size).toBe(0);
    }
    // 다른 검색에서 펴면 앞의 검색에서 편 것은 따라오지 않는다
    const other = searchKey("환율", NO_FILTER);
    expect([...toggleExpanded(open, other, "b.md", true).paths]).toEqual(["b.md"]);
    expect(toggleExpanded(open, k, "a.md", false).paths.size).toBe(0);
  });

  it("줄이 없는 결과(의미 검색·태그로만 맞음)는 줄도 「더」도 없다", () => {
    expect(shownMatches({ path: "a.md", title: "a", line: 1, snippet: "" }, false)).toEqual({ lines: [], more: 0, beyond: 0 });
  });
});

describe("줄로 갈 때 고를 글", () => {
  it("글 단어를 이은 것이 그 줄에 있으면 그것, 아니면 그 줄에 든 첫 단어, 태그 단어는 빼고", () => {
    expect(selectionFor("금리 이야기", "오늘 금리 이야기를 했다")).toBe("금리 이야기");
    expect(selectionFor("금리 환율", "환율만 있는 줄")).toBe("환율");
    expect(selectionFor("#회의 Rate", "the RATE is")).toBe("Rate");
    expect(selectionFor("#회의", "아무 줄")).toBeUndefined();
    expect(selectionFor("금리", "제목으로만 맞음")).toBeUndefined();
  });
});
