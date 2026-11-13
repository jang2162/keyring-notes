import { describe, expect, it } from "vitest";
import { analyze, headings } from "../src/index.js";

/**
 * 제목 줄을 정규식 하나로 읽는 꼴. 꼬리의 공백을 네 조각이 나눠 가져 공백 수의 세제곱으로 느리므로 구현에는 쓰지 않고,
 * headings() 가 같은 답(level·text)을 내는지 견주는 기준으로만 둔다.
 */
function byOneRegex(line: string): { level: number; text: string } | null {
  const h = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
  return h ? { level: h[1].length, text: h[2].trim() } : null;
}

function now(line: string): { level: number; text: string } | null {
  const hs = headings(line);
  expect(hs.length).toBeLessThanOrEqual(1);
  return hs[0] ? { level: hs[0].level, text: hs[0].text } : null;
}

describe("ATX 제목 줄", () => {
  it("경계 사례", () => {
    const cases: [string, { level: number; text: string } | null][] = [
      ["# a", { level: 1, text: "a" }],
      ["###### a", { level: 6, text: "a" }],
      ["####### a", null],
      ["#a", null],
      ["#", null],
      ["# ", { level: 1, text: "" }],
      ["#\t", { level: 1, text: "" }],
      ["# #", { level: 1, text: "" }],
      ["## ##", { level: 2, text: "" }],
      ["# a #", { level: 1, text: "a" }],
      ["# a ##  ", { level: 1, text: "a" }],
      ["# a ## \t", { level: 1, text: "a" }],
      ["# a# b", { level: 1, text: "a# b" }],
      ["# a # b", { level: 1, text: "a # b" }],
      ["# a # #", { level: 1, text: "a #" }],
      ["#\ta\tb\t#", { level: 1, text: "a\tb" }],
      ["   # a", { level: 1, text: "a" }],
      ["    # a", null],
      ["\t# a", null],
      ["#  a  b  ", { level: 1, text: "a  b" }],
      ["# 　a ", { level: 1, text: "a" }],
      ["# a\\#", { level: 1, text: "a\\" }],
      // 닫는 # 앞에 공백이 없어도 걷는다(CommonMark 와 다르다 — 바꾸면 기존 노트의 제목과 `[[노트#제목]]` 링크의 글자가 바뀐다)
      ["# a#", { level: 1, text: "a" }],
      ["# C#", { level: 1, text: "C" }],
      // 줄 안의 CR·줄 구분 문자(U+2028·U+2029)가 있으면 제목이 아니다
      ["# a\rb", null],
      ["# a b", null],
      ["# a ", null],
    ];
    for (const [line, want] of cases) {
      expect(byOneRegex(line), JSON.stringify(line)).toEqual(want);
      expect(now(line), JSON.stringify(line)).toEqual(want);
    }
  });

  it("짧은 줄 전부에서 정규식 하나로 읽던 때와 같은 답", () => {
    const alphabet = ["#", " ", "\t", "a", "\\"];
    let count = 0;
    const walk = (line: string, left: number) => {
      const want = byOneRegex(line);
      const got = now(line);
      if (JSON.stringify(got) !== JSON.stringify(want)) expect(got, JSON.stringify(line)).toEqual(want);
      count++;
      if (left > 0) for (const ch of alphabet) walk(line + ch, left - 1);
    };
    walk("", 7);
    expect(count).toBe(97656); // 길이 0~7 의 모든 줄: (5^8 - 1) / 4
  });

  it("줄 끝 CR 은 떼고 읽는다", () => {
    expect(headings("# a #\r\n## b\r\n").map((h) => [h.level, h.text])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
  });

  // 꼬리를 정규식 하나로 잡는 꼴(byOneRegex)은 공백 3,000칸에 수 초, 20,000칸이면 수십 분이 걸린다(byOneRegex 에 같은 줄을 넣어 잰다).
  // 그 꼴로 돌아갔을 때 20,000칸에서 멈춰 서지 않게 3,000칸을 먼저 재고, 통과한 때만 20,000칸을 잰다.
  it("공백이 아주 긴 제목 줄도 바로 끝난다", { timeout: 60_000 }, () => {
    const elapsed = (n: number, run: (s: string) => unknown) => {
      const s = "# a" + " ".repeat(n) + "b\n";
      const t = performance.now();
      run(s);
      return performance.now() - t;
    };
    expect(elapsed(3000, headings)).toBeLessThan(500);
    expect(elapsed(20000, headings)).toBeLessThan(500);
    expect(headings("# a" + " ".repeat(20000) + "b #  \n")[0]).toMatchObject({ level: 1, text: "a" + " ".repeat(20000) + "b" });
    // 색인이 부르는 길 전체
    expect(elapsed(20000, (s) => analyze("a.md", s))).toBeLessThan(500);
  });
});
