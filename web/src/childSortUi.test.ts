import { describe, expect, it } from "vitest";
import { parseFrontmatter, seedRanks, type VaultNode } from "@keyring-notes/core";
import { childSortWrites, shownChildren, type NoteState } from "./childSortUi";

const node = (name: string, extra: Partial<VaultNode> = {}): VaultNode => ({
  name,
  path: `W/${name}`,
  note: `W/${name}.md`,
  dir: false,
  children: [],
  attachments: [],
  ...extra,
});
const names = (ns: VaultNode[]) => ns.map((n) => n.name);
const fm = (content: string) => parseFrontmatter(content).data;
const none = () => null;
const noView = () => undefined;

describe("트리에 보일 하위 순서", () => {
  const ns = [node("가", { edited: 1 }), node("나", { edited: 3 }), node("다", { edited: 2 })];

  it("정하지 않았으면 받은 이름순, 데일리 폴더면 이름 내림차순", () => {
    expect(names(shownChildren(ns, null, false, noView))).toEqual(["가", "나", "다"]);
    expect(names(shownChildren(ns, null, true, noView))).toEqual(["다", "나", "가"]);
  });

  it("정렬을 정했으면 데일리 폴더라도 그 정렬을 따른다", () => {
    expect(names(shownChildren(ns, "name", true, noView))).toEqual(["가", "나", "다"]);
    expect(names(shownChildren(ns, "modified", true, noView))).toEqual(["나", "다", "가"]);
  });
});

describe("정렬을 적을 쓰기 목록", () => {
  const parent: NoteState = { content: "---\nicon: 📁\n---\n본문", hash: "h0" };

  it("정렬을 고르면 부모 노트의 sort 만 바꾸고 다른 필드·본문은 그대로", () => {
    const w = childSortWrites("W/P.md", parent, "modified", [], none);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: "W/P.md", baseHash: "h0" });
    expect(fm(w[0].content)).toEqual({ icon: "📁", sort: "modified" });
    expect(w[0].content.endsWith("\n본문")).toBe(true);
  });

  it("이름순을 고르면 sort 를 지운다", () => {
    const w = childSortWrites("W/P.md", { content: "---\nicon: 📁\nsort: viewed\n---\n본문", hash: "h1" }, "name", [], none);
    expect(w).toHaveLength(1);
    expect(fm(w[0].content)).toEqual({ icon: "📁" });
  });

  it("이미 그 정렬이면 아무것도 쓰지 않는다", () => {
    expect(childSortWrites("W/P.md", { content: "---\nsort: viewed\n---\n", hash: "h" }, "viewed", [], none)).toEqual([]);
    expect(childSortWrites("W/P.md", parent, "name", [], none)).toEqual([]);
  });

  it("노트 없는 폴더 노드에서 이름순이 아닌 것을 고르면 노트를 새로 만든다(이름순이면 만들지 않는다)", () => {
    const w = childSortWrites("W/P.md", null, "custom", [], none);
    expect(w).toEqual([{ path: "W/P.md", content: expect.any(String), baseHash: null }]);
    expect(fm(w[0].content)).toEqual({ sort: "custom" });
    expect(childSortWrites("W/P.md", null, "name", [], none)).toEqual([]);
  });

  it("처음 커스텀이면 지금 보이는 순서대로 노트가 있는 하위에 rank 를 함께 적는다", () => {
    const kids = [node("가"), node("나", { note: null }), node("다"), node("라")];
    const shown = shownChildren(kids, null, true, noView); // 데일리: 라, 다, 나, 가
    const notes: Record<string, NoteState> = {
      "W/가.md": { content: "가 본문", hash: "a" },
      "W/다.md": { content: "---\ntags: [x]\n---\n다 본문", hash: "c" },
      "W/라.md": { content: "", hash: "d" },
    };
    const w = childSortWrites("W/P.md", parent, "custom", seedRanks(shown), (n) => notes[n] ?? null);
    expect(w.map((x) => x.path)).toEqual(["W/P.md", "W/라.md", "W/다.md", "W/가.md"]);
    expect(w.map((x) => x.baseHash)).toEqual(["h0", "d", "c", "a"]);
    const ranks = w.slice(1).map((x) => fm(x.content)!.rank as string);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(3);
    expect(fm(w[2].content)).toMatchObject({ tags: ["x"] });
    expect(w[3].content.endsWith("가 본문")).toBe(true);
  });

  it("하위 노트의 프런트매터가 깨졌으면 그 노트만 건너뛴다. 부모가 깨졌으면 던진다", () => {
    const broken = { content: "---\na: [\n---\n본문", hash: "x" };
    const w = childSortWrites(
      "W/P.md",
      parent,
      "custom",
      [
        { note: "W/가.md", rank: "V" },
        { note: "W/나.md", rank: "k" },
      ],
      (n) => (n === "W/가.md" ? broken : { content: "", hash: "b" }),
    );
    expect(w.map((x) => x.path)).toEqual(["W/P.md", "W/나.md"]);
    expect(() => childSortWrites("W/P.md", broken, "custom", [], none)).toThrow();
  });
});
