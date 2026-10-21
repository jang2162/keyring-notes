/**
 * 아이콘 고르기 창의 이모지 목록: 만들기(빌드 때, emojibase-data 의 한·영 데이터에서)와 찾기(화면에서).
 * 빌드 쪽은 vite.config.ts 의 `virtual:emoji-data` 가 부르고, 화면은 그 결과를 창을 처음 열 때 받는다.
 */

/** emojibase-data `<lang>/data.json` 한 줄에서 쓰는 칸 */
export type SourceEmoji = {
  hexcode: string;
  emoji: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
  version: number;
};

/**
 * 보여 줄 가장 새 이모지 판. 14.0(2021)은 macOS 12.3·iOS 15.4·Windows 11·Android 12L 부터 그린다.
 * 15.0 이상은 2023년 이후 OS 에만 있어 그보다 오래된 기기에서 두부(□)로 보인다.
 */
export const MAX_EMOJI_VERSION = 14;

/** 묶음(emojibase 의 group 번호, 대표 이모지). 2번 component(피부색·머리 조각)는 혼자 쓰는 이모지가 아니라 뺀다 */
export const EMOJI_GROUPS = [
  { key: "smileys", group: 0, icon: "😀" },
  { key: "people", group: 1, icon: "👋" },
  { key: "nature", group: 3, icon: "🐻" },
  { key: "food", group: 4, icon: "🍔" },
  { key: "travel", group: 5, icon: "🚗" },
  { key: "activities", group: 6, icon: "⚽" },
  { key: "objects", group: 7, icon: "💡" },
  { key: "symbols", group: 8, icon: "🔣" },
  { key: "flags", group: 9, icon: "🚩" },
] as const;

export type EmojiGroupKey = (typeof EMOJI_GROUPS)[number]["key"];

/** 목록의 이모지 하나. `ko`·`en` 은 이름, `words` 는 이름 다음으로 친 낱말(손으로 단 낱말), `tags` 는 검색 낱말 — 모두 소문자 */
export type CatalogEmoji = { e: string; ko: string; en: string; words: string[]; tags: string[] };
export type Catalog = { key: EmojiGroupKey; items: CatalogEmoji[] }[];

const bare = (s: string) => s.replace(/\uFE0F/g, "");
/**
 * emojibase 는 `⭐`·`👍` 처럼 원래 이모지로 그려지는 한 글자에도 FE0F 를 붙여 둔다. 유니코드의 정식 형태(fully-qualified)로 떼어
 * 예전에 고른 아이콘(프런트매터 `icon`, 최근 목록)과 같은 글이 되게 한다. 🗓️ 처럼 글자로 그려지는 것에는 FE0F 가 있어야 하므로 둔다.
 */
export const canonicalEmoji = (s: string) => (/^\p{Emoji_Presentation}$/u.test(bare(s)) ? bare(s) : s);
const lower = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toLowerCase().trim()))];

/**
 * 한·영 데이터 → 묶음별 목록. 피부색 변형(`skins`)은 읽지 않고, 묶음 없는 것(지역 지표 글자)·component·`maxVersion` 보다 새 것은 뺀다.
 * `hand` 의 낱말은 같은 이모지(FE0F 는 가리지 않는다)의 `words` 에 덧붙인다.
 */
export function buildCatalog(ko: SourceEmoji[], en: SourceEmoji[], hand: [string, string][] = [], maxVersion = MAX_EMOJI_VERSION): Catalog {
  const enByHex = new Map(en.map((x) => [x.hexcode, x]));
  const handBy = new Map<string, string[]>();
  for (const [e, words] of hand) handBy.set(bare(e), [...(handBy.get(bare(e)) ?? []), ...words.split(/\s+/)]);
  return EMOJI_GROUPS.map(({ key, group }) => ({
    key,
    items: ko
      .filter((x) => x.group === group && x.version <= maxVersion)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((x) => {
        const e = enByHex.get(x.hexcode);
        const names = lower([x.label, e?.label]);
        const words = lower(handBy.get(bare(x.emoji)) ?? []).filter((w) => !names.includes(w));
        return {
          e: canonicalEmoji(x.emoji),
          ko: x.label,
          en: e?.label ?? x.label,
          words,
          tags: lower([...(x.tags ?? []), ...(e?.tags ?? [])]).filter((w) => !names.includes(w) && !words.includes(w)),
        };
      }),
  }));
}

/** 찾기용으로 낱말을 미리 펴 둔 이모지 */
export type Searchable = { e: string; name: Set<string>; tag: Set<string>; hay: string };

/** 이름·손으로 단 낱말은 띄어쓰기로 나눈 조각까지 `name`, 검색 낱말은 `tag`, 전부 이어 붙인 것은 부분 일치용 `hay` */
export function searchable(item: CatalogEmoji): Searchable {
  const names = [item.ko.toLowerCase(), item.en.toLowerCase(), ...item.words];
  const split = (xs: string[]) => new Set(xs.flatMap((x) => [x, ...x.split(/\s+/)]));
  return { e: item.e, name: split(names), tag: split(item.tags), hay: [...names, ...item.tags].join("\n") };
}

/**
 * 검색(낱말 모두가 맞아야 한다, 대소문자 무시). 묶음 없이 평평하게, 맞은 정도 순서로 돌려준다 —
 * 모든 낱말이 이름(또는 그 조각)과 같으면 먼저, 그다음 검색 낱말과 같은 것, 나머지(부분 일치)는 뒤. 같은 정도 안에서는 목록 순서.
 */
export function searchEmoji(list: Searchable[], query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const tiers: string[][] = [[], [], []];
  for (const it of list) {
    let tier = 0;
    for (const w of words) {
      const t = it.e === w || it.name.has(w) ? 0 : it.tag.has(w) ? 1 : it.hay.includes(w) ? 2 : -1;
      if (t < 0) {
        tier = -1;
        break;
      }
      tier = Math.max(tier, t);
    }
    if (tier >= 0) tiers[tier].push(it.e);
  }
  return tiers.flat();
}

/** 스크롤 위치 → 지금 묶음: 머리가 스크롤 영역 맨 위(조금 아래까지)를 지난 마지막 묶음 */
export function activeSection(tops: { key: string; top: number }[], scrollTop: number, slack = 4): string | undefined {
  let cur = tops[0]?.key;
  for (const s of tops) if (s.top <= scrollTop + slack) cur = s.key;
  return cur;
}
