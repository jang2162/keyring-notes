import { describe, expect, it } from "vitest";
import { analyze, rewriteLinks, unlinkedMentions, wikilinkTargets } from "../src/index.js";
import { angleRanges, inlineLinkRanges, mdlinkMatches, quotedValue, wikilinkLabels, wikilinkMatches } from "../src/linkScan.js";

/**
 * 스캐너(linkScan.ts)가 지켜야 하는 규칙을 정규식으로 적은 것. 구현에는 쓰지 않는다 — 닫는 짝이 없는 여는 괄호가 많은 줄에서
 * 길이의 제곱으로 느리다. 여기서는 짧은 글에만 돌려 스캐너와 같은 답인지 견준다.
 */
const WIKILINK_RE = /(!?)\[\[([^\]\n|#]*)((?:#[^\]\n|]*)?)((?:\|[^\]\n]*)?)\]\]/g;
const MASKED_WIKILINK_RE = /!?\[\[[^\]\n]*\]\]/g;
const LABEL_RE = /\[\[([^\]|]*\|)?([^\]]*)\]\]/g;
const MDLINK_RE = /(!?)\[((?:[^\]\\\n]|\\.)*)\]\((<[^>\n]*>|[^)\s]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?)\)/g;
const INLINE_LINK_RE = /!?\[[^\]\n]*\]\([^)\n]*\)/g;
const ANGLE_RE = /<[^>\n]+>/g;
const QUOTED_RE = /^(\s*)(["']?)(.*?)\2(\s*)$/;

const ranges = (s: string, re: RegExp): [number, number][] => [...s.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);

/** 글 하나를 규칙(정규식)과 스캐너 양쪽에 돌려 다른 것의 이름을 준다 */
function differences(s: string): string[] {
  const bad: string[] = [];
  const same = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  };
  const wiki = wikilinkMatches(s);
  same(
    "wikilinkMatches",
    wiki,
    [...s.matchAll(WIKILINK_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length, bang: m[1], target: m[2], heading: m[3], alias: m[4] })),
  );
  same(
    "wikilinkMatches(언급 가림)",
    wiki.map((m) => [m.start, m.end]),
    ranges(s, MASKED_WIKILINK_RE),
  );
  same("wikilinkLabels", wikilinkLabels(s), s.replace(LABEL_RE, "$2"));
  same(
    "mdlinkMatches",
    mdlinkMatches(s),
    [...s.matchAll(MDLINK_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length, bang: m[1], label: m[2], url: m[3], title: m[4] })),
  );
  same("inlineLinkRanges", inlineLinkRanges(s), ranges(s, INLINE_LINK_RE));
  same("angleRanges", angleRanges(s), ranges(s, ANGLE_RE));
  const q = QUOTED_RE.exec(s);
  same("quotedValue", quotedValue(s), q ? [q[1], q[2], q[3], q[4]] : null);
  return bad;
}

/** 시드를 고정한 난수(mulberry32) — 실패한 입력을 다시 만들 수 있게 */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("링크 스캐너는 규칙(정규식)과 같은 답을 낸다", () => {
  it("문서에 나오는 꼴", () => {
    const shapes = [
      "",
      "[[노트]]",
      "[[노트|별칭]]",
      "[[노트#제목]]",
      "[[노트#제목|별칭]]",
      "[[노트#^block]]",
      "[[폴더/노트.md#제목 둘|별칭 | 둘]]",
      "![[그림.png]]",
      "![[그림.png|300]]",
      "앞 [[a]] 가운데 ![[b|c]] 뒤 [[d#e]]",
      "[[a]][[b]]",
      "[[[a]]]",
      "[[a]]]",
      "[[a]b]]",
      "[[a|b|c]]",
      "[[a#b#c|d#e]]",
      "[[]]",
      "[[|]]",
      "[[#]]",
      "[[a\nb]]",
      "[[a]",
      "[[a",
      "!![[a]]",
      "[[a]]![[b]]",
      "\\[[a]]",
      "[글](주소)",
      '[글](주소 "제목")',
      "[글](주소 '제목')",
      "[글](<주소 공백>)",
      '[글](<주소> "제목")',
      "![그림](a.png)",
      "[![배지](a.svg)](b)",
      "[a [b] c](d)",
      "[a [b](c)",
      "[a \\] b](c)",
      "[a\\\\](c)",
      "[a\\](c)",
      "[a\\",
      "[a](b)(c)",
      "[a](b c)",
      "[a]( b)",
      "[a]()",
      "[a](<>)",
      "[a](<b>c)",
      "[a](<b)",
      '[a](b "c)',
      '[a](b "c" )',
      '[a](b\n"c")',
      '[a](b  "c")',
      "[a](b 'c\nd')",
      "[a]\\(b)",
      "\\[a](b)",
      "[[a]](b)",
      "[a]: http://example.com",
      "글[^1] 과 [^긴 각주]",
      "[^1]: 각주 [[a]] 와 [b](c)",
      "`[[코드]]` 와 `[a](b)`",
      "- [ ] 할 일 [[a]] [b](c.md)",
      "| [[a\\|b]] | [c](d) |",
      "<div>",
      '<a href="x">글</a>',
      "<>",
      "< a >",
      "a < b > c",
      "<<a>>",
      "<a\nb>",
      "https://example.com/a?b=[c]&d=<e>",
      "  값  ",
      '  "값"  ',
      "'값'",
      "\"값'",
      '"',
      '""',
      '"a"b"',
      "   ",
      ' "a"\r',
      "a\rb",
      "a b",
    ];
    for (const s of shapes) expect(differences(s), JSON.stringify(s)).toEqual([]);
  });

  it("무작위 글자 조합 6만 건", () => {
    const chars = ["[", "]", "(", ")", "!", "|", "#", "^", "\\", "<", ">", "`", "a", " ", "\n", '"', "'", "\t", "\r", " "];
    // 괄호가 자주 나와야 링크 꼴이 만들어진다
    const pool = [...chars, "[", "[", "]", "]", "(", ")", "a", "a", " "];
    const next = random(20261113);
    let failed: string[] = [];
    for (let k = 0; k < 60000 && failed.length === 0; k++) {
      let s = "";
      for (let len = Math.floor(next() * 25); len > 0; len--) s += pool[Math.floor(next() * pool.length)];
      const bad = differences(s);
      if (bad.length) failed = [JSON.stringify(s), ...bad];
    }
    expect(failed).toEqual([]);
  });

  it("무작위 조각 조합 6만 건", () => {
    const parts = [
      "[[",
      "]]",
      "](",
      "[",
      "]",
      "(",
      ")",
      "![",
      "!",
      "|",
      "#",
      "^",
      "\\",
      "\\]",
      "<",
      ">",
      "`",
      "a",
      "b c",
      " ",
      "  ",
      "\n",
      ' "',
      '")',
      " '",
      "')",
      "\t",
      "\r",
      " ",
      "<a>",
      "[a]",
      "(b)",
    ];
    const next = random(424242);
    let failed: string[] = [];
    for (let k = 0; k < 60000 && failed.length === 0; k++) {
      let s = "";
      for (let len = 1 + Math.floor(next() * 12); len > 0; len--) s += parts[Math.floor(next() * parts.length)];
      const bad = differences(s);
      if (bad.length) failed = [JSON.stringify(s), ...bad];
    }
    expect(failed).toEqual([]);
  });

  it("링크 뼈대에 무작위 조각을 끼운 6만 건", () => {
    const next = random(55);
    const pick = (from: string[]) => from[Math.floor(next() * from.length)];
    const some = (from: string[], max: number) => {
      let out = "";
      for (let len = Math.floor(next() * (max + 1)); len > 0; len--) out += pick(from);
      return out;
    };
    const noise = ["", "", "a ", "[", "[[", "!", "](", "<", "\\", "`", "\n"];
    const inWiki = ["a", "b c", "|", "#", "^", "[", "!", "\\", "\n", "]"];
    const inLabel = ["a", "b c", "[", "\\]", "\\\\", "\\", "!", "]", "\n", "\\\r"];
    const urls = ["a", "a.md", "<a b>", "<a", "a>", "<>", "<a>b", "", "a(b", "a\\", "<a\nb>"];
    const gaps = ["", "", " ", "  ", "\t", "\n", " "];
    const titles = ["", "", '"t"', "'t'", '"t', "'t\n'", '"a" x', '""', '"t" ', "x"];
    const ends = [")", ")", "", " )", "))"];
    let linked = 0;
    let failed: string[] = [];
    for (let k = 0; k < 60000 && failed.length === 0; k++) {
      const s =
        next() < 0.5
          ? `${pick(noise)}${pick(["", "!"])}[[${some(inWiki, 5)}${pick(["]]", "]]", "]", ""])}${pick(noise)}`
          : `${pick(noise)}${pick(["", "!"])}[${some(inLabel, 4)}${pick(["](", "](", "]", "]("])}${pick(urls)}${pick(gaps)}${pick(titles)}${pick(ends)}${pick(noise)}`;
      if (wikilinkMatches(s).length || mdlinkMatches(s).length) linked++;
      const bad = differences(s);
      if (bad.length) failed = [JSON.stringify(s), ...bad];
    }
    expect(failed).toEqual([]);
    // 링크로 읽히는 것이 충분히 섞여 있어야 견준 것이다
    expect(linked).toBeGreaterThan(10000);
  });

  it("따옴표 값: 공백·따옴표·줄 끝 글자로 만든 길이 6 이하의 모든 글", () => {
    const chars = [" ", "\t", "\r", " ", '"', "'", "a"];
    let count = 0;
    let failed: string[] = [];
    const walk = (s: string, left: number) => {
      if (failed.length) return;
      count++;
      const q = QUOTED_RE.exec(s);
      const want = q ? [q[1], q[2], q[3], q[4]] : null;
      if (JSON.stringify(quotedValue(s)) !== JSON.stringify(want)) failed = [JSON.stringify(s)];
      if (left > 0) for (const ch of chars) walk(s + ch, left - 1);
    };
    walk("", 6);
    expect(failed).toEqual([]);
    expect(count).toBe(137257); // (7^7 - 1) / 6
  });
});

/**
 * 닫는 짝이 없는 여는 괄호가 많은 한 줄. 정규식으로 찾는 구현은 이런 줄에서 길이의 제곱으로 느리다
 * (2만 번 반복에 수 초~수십 초 — 위의 정규식에 같은 줄을 넣어 잰다). 그 꼴로 돌아갔을 때 오래 서 있지 않게
 * 5천 번을 먼저 재고, 통과한 때만 2만 번을 잰다.
 */
describe("괄호가 닫히지 않는 긴 한 줄도 바로 끝난다", () => {
  const LIMIT_MS = 1000;
  const fast = (units: string[], run: (line: string) => unknown) => {
    for (const n of [5000, 20000])
      for (const unit of units) {
        const line = unit.repeat(n);
        const t = performance.now();
        run(line);
        expect(performance.now() - t, `${JSON.stringify(unit)} × ${n}`).toBeLessThan(LIMIT_MS);
      }
  };

  it("wikilinkTargets", { timeout: 120_000 }, () => {
    fast(["[", "[[", "[[a", "![[a|b", "[[a#b", "[[a]"], (line) => wikilinkTargets(line + "\n"));
  });

  it("analyze(요약·링크·태그)", { timeout: 120_000 }, () => {
    fast(["[[", "![[a|b", "[[a|", "[a](", "[[a]"], (line) => analyze("a.md", line + "\n"));
  });

  it("rewriteLinks", { timeout: 120_000 }, () => {
    const ctx = { before: ["a.md", "b.md"], after: ["a.md", "c.md"], moves: new Map([["b.md", "c.md"]]) };
    fast(["[", "[[", "[[a", "![[a|b", "[[a#b", "[a", "[a](", "[a](<b", "[a](b '", "![", "\\["], (line) =>
      rewriteLinks(line + "\n", "x/old.md", "y/new.md", ctx),
    );
  });

  it("rewriteLinks — 프런트매터 sources 값의 긴 공백", { timeout: 120_000 }, () => {
    const ctx = { before: ["a.md", "b.md"], after: ["a.md", "c.md"], moves: new Map([["b.md", "c.md"]]) };
    for (const n of [20000, 60000]) {
      const gap = " ".repeat(n);
      const doc = `---\nsources: ${gap}a${gap}b${gap}\n---\n본문\n`;
      const t = performance.now();
      rewriteLinks(doc, "x/old.md", "y/new.md", ctx);
      expect(performance.now() - t, `공백 ${n}칸`).toBeLessThan(LIMIT_MS);
    }
  });

  it("unlinkedMentions", { timeout: 120_000 }, () => {
    fast(["[", "[[", "[[a", "[a", "[a](", "[a](<b", "![", "<", "<a", "\\["], (line) => unlinkedMentions(line + " zz\n", ["zz"]));
  });

  it("고친 결과는 그대로: 닫히지 않는 괄호 사이의 링크만 고친다", () => {
    const ctx = { before: ["a.md", "b.md"], after: ["a.md", "c.md"], moves: new Map([["b.md", "c.md"]]) };
    const noise = "[[".repeat(2000) + "[a](".repeat(2000);
    expect(rewriteLinks(`${noise}[[b]] 와 [글](../b.md)${noise}\n`, "x/old.md", "x/old.md", ctx)).toEqual({
      content: `${noise}[[c]] 와 [글](../c.md)${noise}\n`,
      count: 2,
    });
    expect(wikilinkTargets(`${noise}[[b#제목|별칭]]${noise}`)).toEqual(["b"]);
  });
});
