import { describe, expect, it } from "vitest";
import { linkMentions, LocalVault, MemoryStore, mentionNames, unlinkedMentions, withoutEdited } from "../src/index.js";

describe("연결되지 않은 언급", () => {
  it("이름(파일·title·aliases)을 찾되 링크·코드·주석·프런트매터 안은 뺀다", () => {
    const names = mentionNames("경제/기준금리.md", { title: "기준 금리", aliases: ["policy rate", "금리"] });
    expect(names).toEqual(["policy rate", "기준 금리", "기준금리", "금리"]);
    const doc = [
      "---",
      "title: 기준금리 메모",
      "---",
      "오늘 기준금리는 동결. [[기준금리]] 참고, `기준금리` 코드.",
      "%%기준금리%% 주석, [기준금리](x.md) 링크",
      "Policy rate rose. policy rates? 금리가 올랐다",
      "```",
      "기준금리",
      "```",
    ].join("\n");
    const ms = unlinkedMentions(doc, names);
    expect(ms.map((m) => [m.line, m.text])).toEqual([
      [4, "기준금리"],
      [6, "Policy rate"],
      [6, "금리"],
    ]);
  });

  it("언급을 링크로: 같은 글자면 [[이름]], 다르면 [[이름|글자]]", () => {
    const doc = "기준금리와 Policy rate, 그리고 기준금리.";
    const ms = unlinkedMentions(doc, ["기준금리", "policy rate"]);
    expect(linkMentions(doc, ms, "기준금리")).toBe("[[기준금리]]와 [[기준금리|Policy rate]], 그리고 [[기준금리]].");
    // 그 사이 바뀐 자리는 건너뛴다
    expect(linkMentions("바뀐 글", ms, "기준금리")).toBe("바뀐 글");
  });
});

describe("연결되지 않은 언급(로컬 볼트)", () => {
  it("다른 문서에서 찾고, 링크로 바꾸면 사라진다", async () => {
    const store = new MemoryStore();
    const v = new LocalVault(store);
    await v.open();
    await v.write("경제/기준금리.md", "# 기준금리\n", null);
    const note = await v.write("일기/오늘.md", "기준금리 동결\n", null);
    await v.write("일기/무관.md", "날씨\n", null);
    const r = await v.mentions("경제/기준금리.md");
    expect(r.docs.map((d) => [d.path, d.mentions.length])).toEqual([["일기/오늘.md", 1]]);
    await v.write("일기/오늘.md", linkMentions(note.content, r.docs[0].mentions, "기준금리"), r.docs[0].hash);
    // 저장하면 수정 시각(edited)이 함께 적힌다 — 본문만 본다
    expect(withoutEdited((await v.read("일기/오늘.md")).content)).toBe("[[기준금리]] 동결\n");
    expect((await v.mentions("경제/기준금리.md")).docs).toEqual([]);
  });
});

describe("언급 찾기는 규칙과 같은 답을 내고, 언급이 많은 줄도 바로 끝난다", () => {
  /**
   * 한 줄에서 언급을 고르는 규칙을 그대로 적은 것(가린 자리는 정규식으로, 겹침은 범위 전부와 견줘서).
   * 구현에는 쓰지 않는다 — 닫히지 않는 괄호가 많거나 언급이 많은 줄에서 길이의 제곱으로 느리다.
   */
  function byRule(line: string, names: string[]): [number, number][] {
    const masked: [number, number][] = [];
    for (const re of [/`+[^`]*`+/g, /!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /<[^>\n]+>/g, /https?:\/\/\S+/g])
      for (const m of line.matchAll(re)) masked.push([m.index, m.index + m[0].length]);
    const word = /[A-Za-z0-9_]/;
    const lower = line.toLowerCase();
    const taken: [number, number][] = [];
    for (const name of names.map((n) => n.toLowerCase())) {
      for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + name.length)) {
        const end = at + name.length;
        if (masked.some(([a, b]) => at < b && end > a) || taken.some(([a, b]) => at < b && end > a)) continue;
        if (word.test(name[0]) && word.test(line[at - 1] ?? "")) continue;
        if (word.test(name[name.length - 1]) && word.test(line[end] ?? "")) continue;
        taken.push([at, end]);
      }
    }
    return taken.sort((x, y) => x[0] - y[0]);
  }

  it("무작위 줄 3만 건", () => {
    const parts = [
      "ab",
      "abc",
      "bc",
      "a b",
      "AB",
      "가나",
      "가",
      "[[ab]]",
      "[[",
      "]]",
      "[ab](bc)",
      "[",
      "](",
      ")",
      "<ab>",
      "<",
      ">",
      "`ab`",
      "`",
      "https://ab.c ",
      " ",
      "_",
      "1",
      "!",
    ];
    const names = ["a b", "abc", "ab", "가나", "bc", "AB"];
    let seed = 31;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    let found = 0;
    for (let k = 0; k < 30000; k++) {
      let line = "";
      for (let len = Math.floor(next() * 10); len > 0; len--) line += parts[Math.floor(next() * parts.length)];
      const got = unlinkedMentions(line, names).map((m) => [m.start, m.end]);
      const want = byRule(line, names);
      found += want.length;
      if (JSON.stringify(got) !== JSON.stringify(want)) expect(got, JSON.stringify(line)).toEqual(want);
    }
    expect(found).toBeGreaterThan(10000);
  });

  // 찾은 자리마다 범위 전부와 견주는 꼴은 한 줄에 언급 2만 개면 수 초가 걸린다. 5천 개를 먼저 재고 통과한 때만 2만 개를 잰다
  it("한 줄에 언급·링크가 수만 개", { timeout: 120_000 }, () => {
    for (const n of [5000, 20000])
      for (const unit of ["zz ", "[[x]] zz ", "`c` zz yy "]) {
        const t = performance.now();
        const found = unlinkedMentions(unit.repeat(n), ["zz", "yy"]);
        expect(performance.now() - t, `${JSON.stringify(unit)} × ${n}`).toBeLessThan(1000);
        expect(found.length).toBeGreaterThanOrEqual(n);
      }
  });
});
