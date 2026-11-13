import { describe, expect, it } from "vitest";
import {
  dirtyPaths,
  docKeyOf,
  dropUnused,
  isDirty,
  patchDoc,
  reloadDoc,
  renameDoc,
  serverWrote,
  setConflict,
  setDraft,
  setSave,
  upsertDoc,
  type DocStore,
  type OpenDoc,
} from "./openDocs";

const doc = (path: string, saved: string, draft = saved, extra: Partial<OpenDoc> = {}): Omit<OpenDoc, "seq"> => ({
  path,
  saved,
  hash: `h-${saved}`,
  draft,
  generated: false,
  ...extra,
});

describe("열린 문서 저장소", () => {
  it("upsertDoc: 같은 경로를 다시 넣으면 seq 가 오르고 상태가 초기화된다", () => {
    const s1 = upsertDoc({}, doc("a.md", "x"));
    expect(s1["a.md"].doc.seq).toBe(1);
    const dirtyState = setConflict(setSave(s1, "a.md", { kind: "error", message: "e" }), "a.md", { currentHash: "h" });
    const s2 = upsertDoc(dirtyState, doc("a.md", "y"));
    expect(s2["a.md"]).toEqual({ doc: { ...doc("a.md", "y"), seq: 2 }, save: { kind: "idle" }, conflict: null });
  });

  it("patchDoc: 없는 경로는 같은 객체를 돌려준다", () => {
    const s = {};
    expect(patchDoc(s, "x.md", (d) => d)).toBe(s);
  });

  it("patchDoc: 문서만 바꾸고 저장 상태·충돌은 둔다", () => {
    const s = setSave(upsertDoc({}, doc("a.md", "x")), "a.md", { kind: "saving" });
    const p = patchDoc(s, "a.md", (d) => ({ ...d, draft: "xy" }));
    expect(p["a.md"].doc.draft).toBe("xy");
    expect(p["a.md"].save).toEqual({ kind: "saving" });
    expect(s["a.md"].doc.draft).toBe("x");
  });

  it("patchDoc: 문서가 그대로면 같은 저장소(다른 칸에서 받은 같은 초안이 다시 그리지 않게)", () => {
    const s = upsertDoc({}, doc("a.md", "x"));
    expect(patchDoc(s, "a.md", (d) => d)).toBe(s);
  });

  describe("setDraft: 뷰가 보낸 초안은 그 뷰의 판(docKey)이 저장소의 판일 때만 받는다", () => {
    const s1 = upsertDoc({}, doc("a.md", "x"));
    const key1 = docKeyOf(s1["a.md"].doc);

    it("docKeyOf: 경로#seq", () => {
      expect(key1).toBe("a.md#1");
    });

    it("같은 판이면 초안을 바꾼다", () => {
      expect(setDraft(s1, "a.md", "xy", key1)["a.md"].doc.draft).toBe("xy");
    });

    it("다시 읽어 판이 오른 뒤(옛 뷰를 다시 만들기 전)에 옛 뷰가 보낸 초안은 버린다", () => {
      const s2 = upsertDoc(s1, doc("a.md", "server"));
      expect(docKeyOf(s2["a.md"].doc)).toBe("a.md#2");
      expect(setDraft(s2, "a.md", "xy", key1)).toBe(s2);
      expect(s2["a.md"].doc.draft).toBe("server");
    });

    it("같은 초안이거나 없는 경로면 같은 객체", () => {
      expect(setDraft(s1, "a.md", "x", key1)).toBe(s1);
      expect(setDraft(s1, "z.md", "x", "z.md#1")).toBe(s1);
    });
  });

  it("setSave·setConflict: 없는 경로는 같은 객체", () => {
    const s: DocStore = {};
    expect(setSave(s, "x.md", { kind: "saving" })).toBe(s);
    expect(setConflict(s, "x.md", null)).toBe(s);
  });

  it("dropUnused: 안 쓰는 문서는 치우되 저장 안 한 것은 남긴다", () => {
    const s = upsertDoc(upsertDoc({}, doc("a.md", "x")), doc("b.md", "x", "xy"));
    expect(Object.keys(dropUnused(s, () => false))).toEqual(["b.md"]);
    expect(Object.keys(dropUnused(s, (p) => p === "a.md")).sort()).toEqual(["a.md", "b.md"]);
    expect(dropUnused(s, () => true)).toBe(s);
  });

  it("renameDoc: 키와 path 를 함께 바꾼다", () => {
    const s = upsertDoc({}, doc("a.md", "x"));
    const r = renameDoc(s, "a.md", "b.md", (d) => ({ ...d, draft: "moved" }));
    expect(Object.keys(r)).toEqual(["b.md"]);
    expect(r["b.md"].doc.path).toBe("b.md");
    expect(r["b.md"].doc.draft).toBe("moved");
    expect(renameDoc(s, "z.md", "y.md")).toBe(s);
  });

  it("dirtyPaths: generated 는 초안이 달라도 빼고, 경로 순서로 준다", () => {
    let s = upsertDoc({}, doc("c.md", "x", "y"));
    s = upsertDoc(s, doc("a.md", "x", "y"));
    s = upsertDoc(s, doc("b.md", "x"));
    s = upsertDoc(s, doc("g.md", "x", "y", { generated: true }));
    expect(dirtyPaths(s)).toEqual(["a.md", "c.md"]);
    expect(isDirty(s["g.md"])).toBe(false);
    expect(isDirty(s["a.md"])).toBe(true);
  });
});

describe("응답이 돌아왔을 때 그사이 친 글", () => {
  /** 저장소에 깨끗한 a.md 를 넣고, 요청이 떠 있는 동안 친 것처럼 초안을 바꾼다 */
  const typedDuring = (saved: string, draft: string): DocStore => {
    const s = upsertDoc({}, doc("a.md", saved));
    return setDraft(s, "a.md", draft, docKeyOf(s["a.md"].doc));
  };

  it("reloadDoc: 처음 읽는 문서는 그대로 넣는다", () => {
    expect(reloadDoc({}, doc("a.md", "x"))["a.md"].doc).toEqual({ ...doc("a.md", "x"), seq: 1 });
  });

  it("reloadDoc: 저장 안 한 변경이 없으면 서버 본문으로 바꾸고 에디터를 다시 만든다", () => {
    const s = reloadDoc(upsertDoc({}, doc("a.md", "x")), doc("a.md", "y"));
    expect(s["a.md"].doc).toEqual({ ...doc("a.md", "y"), seq: 2 });
  });

  it("reloadDoc: 읽는 사이 친 글이 있으면 초안을 남긴다 — 서버 본문이 그대로면 해시만 맞춘다", () => {
    const before = typedDuring("x", "x + typed");
    const s = reloadDoc(before, { ...doc("a.md", "x"), hash: "h-new" });
    expect(s["a.md"].doc).toEqual({ ...before["a.md"].doc, hash: "h-new" });
    expect(s["a.md"].doc.draft).toBe("x + typed");
  });

  it("reloadDoc: 읽는 사이 쳤고 서버 본문도 달라졌으면 손대지 않는다(다음 저장이 옛 해시로 충돌 → 병합)", () => {
    const before = typedDuring("x", "x + typed");
    expect(reloadDoc(before, doc("a.md", "server"))).toBe(before);
  });

  it("reloadDoc: force 면 저장 안 한 초안도 버리고 바꾼다(되돌리기·사본으로 저장한 뒤)", () => {
    const s = reloadDoc(typedDuring("x", "x + typed"), doc("a.md", "server"), true);
    expect(s["a.md"].doc).toEqual({ ...doc("a.md", "server"), seq: 2 });
  });

  it("reloadDoc: 서버가 만드는 문서는 늘 바꾼다", () => {
    const gen = upsertDoc({}, doc("index.md", "x", "x", { generated: true }));
    expect(reloadDoc(gen, doc("index.md", "y", "y", { generated: true }))["index.md"].doc.draft).toBe("y");
  });

  const open = (saved: string, draft = saved): OpenDoc => ({ ...doc("a.md", saved, draft), seq: 3 });

  it("serverWrote: 초안이 쓴 내용과 같으면 저장본·해시만 맞추고 에디터를 다시 만들지 않는다", () => {
    expect(serverWrote(open("x"), "x", "h2")).toEqual({ ...open("x"), hash: "h2" });
  });

  it("serverWrote: 서버가 내용을 고쳐 썼고 그사이 친 글이 없으면 그 내용으로 바꾼다", () => {
    expect(serverWrote(open("x"), "x fixed", "h2")).toEqual({ ...open("x fixed"), hash: "h2", seq: 4 });
  });

  it("serverWrote: 응답을 기다리는 동안 친 글은 남긴다 — 쓴 내용이 저장본 그대로면 해시만 맞춘다", () => {
    expect(serverWrote(open("x", "x + typed"), "x", "h2")).toEqual({ ...open("x", "x + typed"), hash: "h2" });
  });

  it("serverWrote: 그사이 쳤고 서버도 내용을 고쳐 썼으면 손대지 않는다(다음 저장이 옛 해시로 충돌 → 병합)", () => {
    const d = open("x", "x + typed");
    expect(serverWrote(d, "x fixed", "h2")).toBe(d);
  });
});
