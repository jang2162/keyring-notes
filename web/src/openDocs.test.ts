import { describe, expect, it } from "vitest";
import { dirtyPaths, dropUnused, isDirty, patchDoc, renameDoc, setConflict, setSave, upsertDoc, type DocStore, type OpenDoc } from "./openDocs";

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
