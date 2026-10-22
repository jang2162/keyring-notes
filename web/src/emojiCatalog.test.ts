import enData from "emojibase-data/en/data.json";
import koData from "emojibase-data/ko/data.json";
import { describe, expect, it } from "vitest";
import {
  activeSection,
  addRecentIcon,
  buildCatalog,
  canonicalEmoji,
  EMOJI_GROUPS,
  MAX_EMOJI_VERSION,
  pastedEmoji,
  recentIcons,
  sameEmoji,
  searchable,
  searchEmoji,
  type SourceEmoji,
} from "./emojiCatalog";
import { HAND_WORDS } from "./emojiWords";

const ko: SourceEmoji[] = koData;
const en: SourceEmoji[] = enData;
const catalog = buildCatalog(ko, en, HAND_WORDS);
const all = catalog.flatMap((g) => g.items);
const list = all.map(searchable);
const find = (q: string) => searchEmoji(list, q);
const bare = (s: string) => s.replace(/\uFE0F/g, "");

describe("목록 만들기(실제 emojibase-data)", () => {
  it("묶음은 표정·사람·동물과 자연·음식·여행과 장소·활동·사물·기호·깃발 순서이고 모두 비어 있지 않다", () => {
    expect(catalog.map((g) => g.key)).toEqual(["smileys", "people", "nature", "food", "travel", "activities", "objects", "symbols", "flags"]);
    for (const g of catalog) expect(g.items.length).toBeGreaterThan(50);
  });

  it("피부색 변형·component·지역 지표 글자는 없다", () => {
    expect(all.some((x) => /[\u{1F3FB}-\u{1F3FF}]/u.test(x.e))).toBe(false);
    const es = new Set(all.map((x) => x.e));
    expect(es.has("👍")).toBe(true);
    expect(es.has("👍🏻")).toBe(false);
    expect(es.has("🦰")).toBe(false);
    expect(es.has("🇦")).toBe(false);
  });

  it(`${MAX_EMOJI_VERSION}.0 판까지만 싣는다`, () => {
    const es = new Set(all.map((x) => x.e));
    expect(es.has("🫠")).toBe(true); // 14.0 녹는 얼굴
    expect(es.has("🫨")).toBe(false); // 15.0 흔들리는 얼굴
    expect(es.has("🐦‍🔥")).toBe(false); // 15.1 불사조
    const newer = new Set(ko.filter((x) => x.version > MAX_EMOJI_VERSION).map((x) => x.emoji));
    expect(all.filter((x) => newer.has(x.e))).toEqual([]);
  });

  it("한 이모지는 한 번만, 묶음 안은 emojibase 순서", () => {
    expect(new Set(all.map((x) => x.e)).size).toBe(all.length);
    const order = new Map(ko.map((x) => [canonicalEmoji(x.emoji), x.order ?? 0]));
    for (const g of catalog) {
      const os = g.items.map((x) => order.get(x.e)!);
      expect(os).toEqual([...os].sort((a, b) => a - b));
    }
  });

  it("예전 목록의 이모지는 모두 있고, 예전 낱말 하나하나로 찾아진다", () => {
    const es = new Map(all.map((x) => [bare(x.e), x.e]));
    const missing: string[] = [];
    for (const [e, words] of HAND_WORDS) {
      const hit = es.get(bare(e));
      if (!hit) {
        missing.push(e);
        continue;
      }
      for (const w of words.split(/\s+/)) if (!find(w).includes(hit)) missing.push(`${e} ${w}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("목록 만들기(작은 데이터)", () => {
  const src = (over: Partial<SourceEmoji> & { hexcode: string; emoji: string }): SourceEmoji => ({ label: over.emoji, group: 7, version: 1, ...over });

  it("판·묶음으로 거르고, 영어 이름·검색 낱말은 hexcode 로 짝짓는다", () => {
    const k = [
      src({ hexcode: "B", emoji: "b", label: "나중", order: 2, tags: ["낱말", "Same"] }),
      src({ hexcode: "A", emoji: "a", label: "먼저", order: 1 }),
      src({ hexcode: "N", emoji: "n", order: 3, version: 15 }),
      src({ hexcode: "C", emoji: "c", group: 2 }),
      src({ hexcode: "R", emoji: "r", group: undefined }),
    ];
    const e = [src({ hexcode: "B", emoji: "b", label: "Later", tags: ["word", "same"] })];
    const objects = buildCatalog(k, e, [["b\uFE0F", "손 Hand 나중"]], 14).find((g) => g.key === "objects")!;
    expect(objects.items.map((x) => x.e)).toEqual(["a", "b"]);
    expect(objects.items[1]).toEqual({ e: "b", ko: "나중", en: "Later", words: ["손", "hand"], tags: ["낱말", "same", "word"] });
    expect(
      buildCatalog(k, e, [], 15)
        .find((g) => g.key === "objects")!
        .items.map((x) => x.e),
    ).toEqual(["a", "b", "n"]);
  });
});

describe("FE0F", () => {
  it("원래 이모지로 그려지는 한 글자는 FE0F 를 떼고, 글자로 그려지는 것·ZWJ 묶음은 둔다", async () => {
    expect(canonicalEmoji("⭐\uFE0F")).toBe("⭐");
    expect(canonicalEmoji("👍\uFE0F")).toBe("👍");
    expect(canonicalEmoji("🗓\uFE0F")).toBe("🗓\uFE0F");
    expect(canonicalEmoji("❤\uFE0F\u200D🔥")).toBe("❤\uFE0F\u200D🔥");
  });

  it("목록에는 예전 목록과 같은 글로 들어 있다(⭐·👍·🗓️·☀️)", () => {
    const es = new Set(all.map((x) => x.e));
    for (const [e] of HAND_WORDS) expect(es.has(e), e).toBe(true);
  });

  it("붙여 넣은 이모지도 정식 형태로 고른다(Enter)", () => {
    expect(pastedEmoji(" ⭐\uFE0F ")).toBe("⭐");
    expect(pastedEmoji("🗓\uFE0F")).toBe("🗓\uFE0F");
    expect(pastedEmoji("🦊")).toBe("🦊");
    expect(pastedEmoji("🇰🇷")).toBe("🇰🇷");
    expect(pastedEmoji("star")).toBeNull();
    expect(pastedEmoji("  ")).toBeNull();
  });

  it("FE0F 만 다른 것은 같은 이모지다(「지금 아이콘」 켜짐)", () => {
    expect(sameEmoji("⭐\uFE0F", "⭐")).toBe(true);
    expect(sameEmoji("⭐", "🌟")).toBe(false);
    expect(sameEmoji("🗓\uFE0F", "🗓\uFE0F")).toBe(true);
  });

  it("FE0F 붙은 것으로 찾아도 목록의 정식 형태가 나온다", () => {
    expect(find("⭐\uFE0F")).toEqual(["⭐"]);
  });
});

describe("최근 목록", () => {
  it("같은 이모지의 다른 형태는 한 번만, 새것이 앞", () => {
    expect(addRecentIcon(["⭐\uFE0F", "🦊"], "⭐")).toEqual(["⭐", "🦊"]);
    expect(addRecentIcon(["🦊", "⭐"], "🦊")).toEqual(["🦊", "⭐"]);
  });

  it("이미 두 형태가 함께 저장돼 있으면 읽을 때 앞의 것만 남기고 글은 그대로 둔다", () => {
    expect(recentIcons(["⭐\uFE0F", "🦊", "⭐"])).toEqual(["⭐\uFE0F", "🦊"]);
  });

  it("16개까지, 글이 아닌 값은 뺀다", () => {
    const many = all.slice(0, 20).map((x) => x.e);
    expect(addRecentIcon(many, "🦊")).toHaveLength(16);
    expect(recentIcons(["🦊", 1, "", null] as unknown as string[])).toEqual(["🦊"]);
  });
});

describe("찾기", () => {
  it("한국어 이름·영어 이름·검색 낱말로 찾는다", () => {
    expect(find("고양이")).toContain("🐱");
    expect(find("cat")).toContain("🐱");
    expect(find("따봉")).toContain("👍");
    expect(find("THUMBS")).toContain("👍");
  });

  it("낱말이 여럿이면 모두 맞아야 한다", () => {
    expect(find("red heart")).toContain("❤️");
    expect(find("red heart")).not.toContain("💙");
  });

  it("이름과 같은 것이 먼저, 검색 낱말과 같은 것이 그다음, 부분 일치는 뒤", () => {
    expect(find("star")[0]).toBe("⭐");
    expect(find("star").indexOf("🤩")).toBeGreaterThan(find("star").indexOf("🌟"));
    expect(find("데일리")[0]).toBe("📅");
    expect(find("책")[0]).toBe("📕");
  });

  it("이모지 자체로도 찾고, 빈 검색은 아무것도 돌려주지 않는다", () => {
    expect(find("🐱")).toEqual(["🐱"]);
    expect(find("  ")).toEqual([]);
    expect(find("없는낱말xyz")).toEqual([]);
  });
});

describe("지금 묶음", () => {
  const tops = [
    { key: "recent", top: 0 },
    { key: "smileys", top: 80 },
    { key: "people", top: 500 },
  ];
  it("머리가 맨 위를 지난 마지막 묶음", () => {
    expect(activeSection(tops, 0)).toBe("recent");
    expect(activeSection(tops, 77)).toBe("smileys");
    expect(activeSection(tops, 499)).toBe("people");
    expect(activeSection(tops, 2000)).toBe("people");
    expect(activeSection([], 0)).toBeUndefined();
  });
});

describe("묶음 정의", () => {
  it("대표 이모지는 그 묶음에 있다", () => {
    for (const g of EMOJI_GROUPS) expect(catalog.find((c) => c.key === g.key)!.items.map((x) => x.e)).toContain(g.icon);
  });
});
