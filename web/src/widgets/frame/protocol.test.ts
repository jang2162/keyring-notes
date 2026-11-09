import { describe, expect, it } from "vitest";
import { parseFrameMsg } from "./protocol";

const ID = "w1";
const m = (o: Record<string, unknown>) => ({ kw: "kw1", id: ID, ...o });
const HASH = "a".repeat(64);

describe("parseFrameMsg", () => {
  it("맞는 메시지는 통과", () => {
    const ok: Record<string, unknown>[] = [
      { type: "registered" },
      { type: "height", px: 120 },
      { type: "height", px: 0 },
      { type: "setState", patch: { a: 1 } },
      { type: "requestEdit" },
      { type: "exitEdit", apply: true },
      { type: "fileRead", req: 0 },
      { type: "fileWrite", req: 3, bytes: new Uint8Array([1]), baseHash: HASH },
      { type: "toggleFullscreen" },
      { type: "key", key: "escape" },
      { type: "key", key: "save" },
      { type: "blur" },
      { type: "error", message: "boom" },
    ];
    for (const o of ok) expect(parseFrameMsg(m(o), ID)).toEqual(o);
  });

  it("ready 는 id 없이 통과", () => {
    expect(parseFrameMsg({ kw: "kw1", type: "ready" }, ID)).toEqual({ type: "ready" });
  });

  it("어긋나면 null", () => {
    const bad: unknown[] = [
      null,
      "x",
      { ...m({ type: "blur" }), kw: "kw2" },
      { ...m({ type: "blur" }), id: "w2" },
      { kw: "kw1", type: "blur" },
      m({ type: "nope" }),
      m({ type: "height", px: Number.NaN }),
      m({ type: "height", px: -1 }),
      m({ type: "height", px: 1e6 }),
      m({ type: "height", px: "1" }),
      m({ type: "setState", patch: [] }),
      m({ type: "setState", patch: null }),
      m({ type: "exitEdit", apply: "yes" }),
      m({ type: "fileRead", req: 1.5 }),
      m({ type: "fileRead", req: -1 }),
      m({ type: "fileWrite", req: 0, bytes: new Uint8Array([1]), baseHash: "x" }),
      m({ type: "fileWrite", req: 0, bytes: [1], baseHash: HASH }),
      m({ type: "key", key: "tab" }),
      m({ type: "error", message: 1 }),
    ];
    for (const b of bad) expect(parseFrameMsg(b, ID)).toBeNull();
  });

  it("오류 글은 500자로 자른다", () => {
    expect(parseFrameMsg(m({ type: "error", message: "x".repeat(600) }), ID)).toEqual({ type: "error", message: "x".repeat(500) });
  });
});
