import { describe, expect, it } from "vitest";
import { resolveFrameCode } from "./source";

describe("resolveFrameCode", () => {
  it("글이면 받지 않는다", async () => {
    const calls: string[] = [];
    const get = { text: async (u: string) => (calls.push(u), ""), bytes: async (u: string) => (calls.push(u), new ArrayBuffer(0)) };
    expect(await resolveFrameCode({ kind: "text", js: "x" }, get)).toEqual({ js: "x", css: "", fonts: {} });
    expect(await resolveFrameCode({ kind: "text", js: "x", css: "c" }, get)).toEqual({ js: "x", css: "c", fonts: {} });
    expect(calls).toEqual([]);
  });

  it("주소면 js·css·글꼴을 받아 채운다", async () => {
    const calls: string[] = [];
    const buf = new ArrayBuffer(3);
    const get = { text: async (u: string) => (calls.push(u), `T${u}`), bytes: async (u: string) => (calls.push(u), buf) };
    const r = await resolveFrameCode({ kind: "url", js: "/a.js", css: "/a.css", fonts: { "E/a.woff2": "/f/a.woff2" } }, get);
    expect(r).toEqual({ js: "T/a.js", css: "T/a.css", fonts: { "E/a.woff2": buf } });
    expect(calls.sort()).toEqual(["/a.css", "/a.js", "/f/a.woff2"]);
  });

  it("하나라도 실패하면 거절", async () => {
    const get = {
      text: async () => "",
      bytes: async () => {
        throw new Error("offline");
      },
    };
    await expect(resolveFrameCode({ kind: "url", js: "/a.js", fonts: { x: "/x" } }, get)).rejects.toThrow("offline");
  });
});
