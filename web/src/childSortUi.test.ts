import { describe, expect, it } from "vitest";
import { parseFrontmatter, planReorder, seedRanks, sortChildren, type VaultNode } from "@keyring-notes/core";
import {
  childSortWrites,
  edgeDrop,
  fillBlankNote,
  isGeneratedNote,
  planWritable,
  rankWrites,
  reorderHintKey,
  seedWritable,
  shownChildren,
  siblingTarget,
  writableSiblings,
  type NoteState,
} from "./childSortUi";

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

describe("막 만든 노트에 템플릿 넣기", () => {
  const tpl = "---\ntags: [tpl]\n---\n템플릿 본문\n";

  it("앱이 적은 edited 만 있는 빈 노트는 템플릿으로 채운다(edited 는 버린다)", () => {
    expect(fillBlankNote("---\nedited: 2026-10-30T09:12:33Z\n---\n", tpl)).toBe(tpl);
    expect(fillBlankNote("---\nedited: 2026-10-30T09:12:33Z\n---\n\n  \n", tpl)).toBe(tpl);
  });

  it("정렬·순서는 템플릿 프런트매터로 옮겨 남긴다", () => {
    const out = fillBlankNote("---\nsort: custom\nrank: V\nedited: 2026-10-30T09:12:33Z\n---\n", tpl)!;
    expect(fm(out)).toEqual({ tags: ["tpl"], sort: "custom", rank: "V" });
    expect(out.endsWith("템플릿 본문\n")).toBe(true);
  });

  it("본문이 있거나 사람이 쓴 속성이 있거나 프런트매터가 없거나 깨졌으면 채우지 않는다(null)", () => {
    expect(fillBlankNote("---\nedited: 2026-10-30T09:12:33Z\n---\n글", tpl)).toBeNull();
    expect(fillBlankNote("---\nicon: 📁\nedited: 2026-10-30T09:12:33Z\n---\n", tpl)).toBeNull();
    expect(fillBlankNote("", tpl)).toBeNull();
    expect(fillBlankNote("---\na: [\n---\n", tpl)).toBeNull();
  });
});

describe("커스텀 순서 바꾸기", () => {
  const kids = [node("가", { rank: "J" }), node("나", { rank: "V" }), node("다", { rank: "d" }), node("라", { note: null }), node("마")];

  it("옮긴 노트 하나의 rank 만 적고 다른 필드·본문은 그대로", () => {
    const notes: Record<string, NoteState> = { "W/다.md": { content: "---\nicon: 🌱\nrank: d\n---\n다 본문", hash: "h" } };
    const w = rankWrites(planReorder(kids, "W/다", "W/가"), (n) => notes[n] ?? null);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ path: "W/다.md", baseHash: "h" });
    expect(fm(w[0].content)).toMatchObject({ icon: "🌱" });
    expect((fm(w[0].content)!.rank as string) < "J").toBe(true);
    expect(w[0].content.endsWith("다 본문")).toBe(true);
  });

  it("rank 없는 노드 사이로 옮기면 그 자리까지 함께 적고, 노트 없는 폴더 노드는 노트를 만든다", () => {
    const plan = planReorder(kids, "W/가", null);
    const w = rankWrites(plan, (n) => ({ content: "", hash: `h:${n}` }));
    expect(w.map((x) => [x.path, x.baseHash])).toEqual([
      ["W/라.md", null],
      ["W/마.md", "h:W/마.md"],
      ["W/가.md", "h:W/가.md"],
    ]);
    const ranked = kids.map((k) => ({ ...k, rank: plan.find((p) => p.node === k.path)?.rank ?? k.rank }));
    expect(names(sortChildren(ranked, "custom", noView))).toEqual(["나", "다", "라", "마", "가"]);
  });

  it("프런트매터가 깨진 노트면 던진다(알리고 아무것도 쓰지 않는다)", () => {
    expect(() => rankWrites(planReorder(kids, "W/다", "W/가"), () => ({ content: "---\na: [\n---\n", hash: "x" }))).toThrow();
  });

  it("한 칸 위·아래의 넣을 자리, 끝이면 못 옮긴다", () => {
    const ns = [node("a"), node("b"), node("c")];
    expect(siblingTarget(ns, "W/b", -1)).toBe("W/a");
    expect(siblingTarget(ns, "W/b", 1)).toBeNull();
    expect(siblingTarget(ns, "W/a", 1)).toBe("W/c");
    expect(siblingTarget(ns, "W/a", -1)).toBeUndefined();
    expect(siblingTarget(ns, "W/c", 1)).toBeUndefined();
  });

  it("목록에 없는 경로는 위·아래 모두 못 옮긴다", () => {
    const ns = [node("a"), node("b"), node("c")];
    expect(siblingTarget(ns, "W/없음", 1)).toBeUndefined();
    expect(siblingTarget(ns, "W/없음", -1)).toBeUndefined();
  });
});

describe("위키 주제의 자동 생성 노트(index·log)는 rank 를 적지 않는다", () => {
  const wiki = (name: string, extra: Partial<VaultNode> = {}): VaultNode => ({
    ...node(name, extra),
    path: `업무/경제/wiki/${name}`,
    note: extra.note === null ? null : `업무/경제/wiki/${name}.md`,
  });
  const kids = [wiki("금리"), wiki("index"), wiki("log"), wiki("환율")];
  const generated = (n: string) => n.endsWith("/index.md") || n.endsWith("/log.md");

  it("자동 생성 노트 판정", () => {
    expect(isGeneratedNote("업무/경제/wiki/index.md")).toBe(true);
    expect(isGeneratedNote("업무/경제/wiki/log.md")).toBe(true);
    expect(isGeneratedNote("업무/경제/wiki/금리.md")).toBe(false);
    expect(isGeneratedNote("업무/index.md")).toBe(false);
  });

  it("처음 커스텀: 쓸 수 있는 노트에만 rank 를 매긴다(노트 없는 노드는 그대로 남긴다)", () => {
    expect(writableSiblings([...kids, wiki("폴더", { note: null })], generated).map((n) => n.name)).toEqual(["금리", "환율", "폴더"]);
    expect(seedWritable(kids, generated).map((s) => s.note)).toEqual(["업무/경제/wiki/금리.md", "업무/경제/wiki/환율.md"]);
  });

  const apply = (ns: VaultNode[], plan: { node: string; rank: string }[]) =>
    names(
      sortChildren(
        ns.map((k) => ({ ...k, rank: plan.find((p) => p.node === k.path)?.rank ?? k.rank })),
        "custom",
        noView,
      ),
    );

  it("자동 생성 노트를 지나가는 순서 바꾸기도 쓸 수 있는 노트만 적는다", () => {
    const ranked = [wiki("금리", { rank: "V" }), wiki("환율", { rank: "k" }), wiki("index"), wiki("log"), wiki("물가")];
    const shown = sortChildren(ranked, "custom", noView);
    // rank 없는 노트(물가)를 맨 앞으로: 자동 생성 노트를 지나간다
    const up = planWritable(shown, generated, "업무/경제/wiki/물가", "업무/경제/wiki/금리");
    expect(up.map((p) => p.node)).toEqual(["업무/경제/wiki/물가"]);
    expect(apply(ranked, up).slice(0, 3)).toEqual(["물가", "금리", "환율"]);
    // 맨 뒤로: rank 없는 쓸 수 있는 노트(물가)까지 함께, 자동 생성 노트는 빼고
    const end = planWritable(shown, generated, "업무/경제/wiki/금리", null);
    expect(end.every((p) => !generated(`${p.node}.md`))).toBe(true);
    expect(apply(ranked, end).slice(0, 3)).toEqual(["환율", "물가", "금리"]);
  });

  it("자동 생성 노트 앞에 놓으면 그 뒤의 첫 쓸 수 있는 노트 앞으로 친다(없으면 맨 뒤)", () => {
    const ranked = [wiki("금리", { rank: "V" }), wiki("환율", { rank: "k" }), wiki("index"), wiki("log"), wiki("물가")];
    const shown = sortChildren(ranked, "custom", noView);
    const at = shown.findIndex((n) => n.name === "index");
    const after = shown.slice(at + 1).find((n) => !generated(n.note!));
    const plan = planWritable(shown, generated, "업무/경제/wiki/금리", "업무/경제/wiki/index");
    expect(plan.every((p) => !generated(`${p.node}.md`))).toBe(true);
    const order = apply(ranked, plan).filter((n) => n !== "index" && n !== "log");
    expect(order.indexOf("금리")).toBe(after ? order.indexOf(after.name) - 1 : order.length - 1);
  });

  it("목록에 없는 자리면 던진다", () => {
    expect(() => planWritable(kids, generated, "업무/경제/wiki/금리", "업무/경제/wiki/없음")).toThrow();
  });
});

describe("커스텀 부모 아래 행에 끌어 놓기 판정", () => {
  const base = { custom: true, sameParent: true, parentOk: true, expanded: false };

  it("같은 부모: 위·아래 가장자리는 삽입선, 가운데는 그 노드 안으로(null)", () => {
    expect(edgeDrop(0.1, base)).toEqual({ kind: "line", side: "before" });
    expect(edgeDrop(0.9, base)).toEqual({ kind: "line", side: "after" });
    expect(edgeDrop(0.5, base)).toBeNull();
  });

  it("부모가 커스텀이 아니면 판정하지 않는다", () => {
    expect(edgeDrop(0.1, { ...base, custom: false })).toBeNull();
    expect(edgeDrop(0.9, { ...base, custom: false })).toBeNull();
  });

  it("다른 부모의 노드면 가장자리에서 삽입선 대신 그 부모 안으로", () => {
    expect(edgeDrop(0.1, { ...base, sameParent: false })).toEqual({ kind: "parent" });
    expect(edgeDrop(0.9, { ...base, sameParent: false })).toEqual({ kind: "parent" });
    expect(edgeDrop(0.5, { ...base, sameParent: false })).toBeNull();
    expect(edgeDrop(0.1, { ...base, sameParent: false, parentOk: false })).toBeNull();
  });

  it("펼친 노드의 아래 가장자리는 가운데로 친다(위 가장자리는 그대로)", () => {
    expect(edgeDrop(0.9, { ...base, expanded: true })).toBeNull();
    expect(edgeDrop(0.1, { ...base, expanded: true })).toEqual({ kind: "line", side: "before" });
    expect(edgeDrop(0.9, { ...base, expanded: true, sameParent: false })).toBeNull();
  });
});

describe("순서를 못 바꿀 때의 안내", () => {
  it("워크스페이스 맨 위 노트는 「노트 정렬」, 그 아래는 부모의 「하위 노트 정렬」 을 가리킨다", () => {
    expect(reorderHintKey("W")).toBe("tree.reorderNeedsCustomRoot");
    expect(reorderHintKey("W/P")).toBe("tree.reorderNeedsCustom");
  });
});
