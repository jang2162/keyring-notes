import { SearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { countLabel, matchStats, nextMatch, prevMatch } from "./findQuery";

const doc = "fox Fox foxes\nfirefox fox";
const at = (anchor: number, head = anchor) => EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
const q = (search: string, opts: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}) => new SearchQuery({ search, ...opts });

describe("찾기 막대: 일치 수", () => {
  it("대소문자 무시가 기본이고, 선택이 일치 위에 있으면 몇 번째인지 센다", () => {
    expect(matchStats(at(4, 7), q("fox"))).toEqual({ total: 5, current: 2, capped: false });
  });

  it("선택이 일치 위에 없으면 current 는 0", () => {
    expect(matchStats(at(1), q("fox")).current).toBe(0);
  });

  it("대소문자·단어 단위·정규식 토글을 따른다", () => {
    expect(matchStats(at(0), q("fox", { caseSensitive: true })).total).toBe(4);
    expect(matchStats(at(0), q("fox", { wholeWord: true })).total).toBe(3);
    expect(matchStats(at(0), q("fox(es)?$", { regexp: true })).total).toBe(2);
  });

  it("빈 검색어·잘못된 정규식은 0개, 상한을 넘으면 capped", () => {
    expect(matchStats(at(0), q("")).total).toBe(0);
    expect(matchStats(at(0), q("(", { regexp: true })).total).toBe(0);
    expect(matchStats(at(0), q("fox"), 3)).toEqual({ total: 3, current: 0, capped: true });
  });

  it("빈 일치(정규식 ^ 등)는 세지 않는다", () => {
    expect(matchStats(at(0), q("^", { regexp: true })).total).toBe(0);
  });
});

describe("찾기 막대: 다음·이전", () => {
  it("다음은 선택 끝 뒤의 첫 일치, 끝에서는 처음으로 돈다", () => {
    expect(nextMatch(at(4, 7), q("fox"))).toEqual({ from: 8, to: 11 });
    expect(nextMatch(at(25), q("fox"))).toEqual({ from: 0, to: 3 });
  });

  it("빈 커서가 일치 시작에 있으면 그 일치를 고른다(입력하며 찾기)", () => {
    expect(nextMatch(at(8), q("fox"))).toEqual({ from: 8, to: 11 });
    // 입력하며 찾기: 선택한 일치의 시작부터 다시 찾으면 그 자리에 머문다
    expect(nextMatch(at(8, 11), q("foxe"), 8)).toEqual({ from: 8, to: 12 });
  });

  it("이전은 선택 앞의 마지막 일치, 처음에서는 끝으로 돈다", () => {
    expect(prevMatch(at(8, 11), q("fox"))).toEqual({ from: 4, to: 7 });
    expect(prevMatch(at(0, 3), q("fox"))).toEqual({ from: 22, to: 25 });
  });

  it("일치가 없으면 null", () => {
    expect(nextMatch(at(0), q("wolf"))).toBeNull();
    expect(prevMatch(at(0), q("wolf"))).toBeNull();
  });
});

describe("찾기 막대: 일치 수 글", () => {
  it("검색어가 없으면 빈 글, 잘못된 정규식은 invalid, 없으면 none, 일치 위면 n/전체, 아니면 ?/전체", () => {
    const t = (key: string, p?: Record<string, string | number>) => (p ? `${key}:${JSON.stringify(p)}` : key);
    expect(countLabel(q(""), { total: 0, current: 0, capped: false }, t)).toBe("");
    expect(countLabel(q("(", { regexp: true }), { total: 0, current: 0, capped: false }, t)).toBe("find.invalid");
    expect(countLabel(q("x"), { total: 0, current: 0, capped: false }, t)).toBe("find.none");
    expect(countLabel(q("x"), { total: 12, current: 3, capped: false }, t)).toBe('find.count:{"current":3,"total":"12"}');
    expect(countLabel(q("x"), { total: 12, current: 0, capped: false }, t)).toBe('find.count:{"current":"?","total":"12"}');
    expect(countLabel(q("x"), { total: 1000, current: 0, capped: true }, t)).toBe('find.count:{"current":"?","total":"1000+"}');
  });
});
