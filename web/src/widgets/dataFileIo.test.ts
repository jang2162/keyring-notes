import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { DataFileError } from "./dataFile";
import { apiDataFileIO } from "./dataFileIo";

const err = (status: number) => new ApiError(status, status === 404 ? "not_found" : status === 409 ? "conflict" : "error", "x");

function fake(fail: { read?: unknown; replace?: unknown; create?: unknown } = {}) {
  const calls: { replace?: [string, Blob, string]; create?: [string, Blob] } = {};
  const api = {
    readBytes: async (p: string) => {
      if (fail.read) throw fail.read;
      return new Uint8Array([p.length]);
    },
    replaceAttachment: async (p: string, b: Blob, h: string) => {
      calls.replace = [p, b, h];
      if (fail.replace) throw fail.replace;
      return { path: p, hash: "nh" };
    },
    uploadAttachment: async (p: string, b: Blob) => {
      calls.create = [p, b];
      if (fail.create) throw fail.create;
      return { path: `${p}!`, hash: null };
    },
  };
  return { io: apiDataFileIO(api), calls };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof DataFileError ? e.code : `other ${String(e)}`;
  }
};

describe("apiDataFileIO", () => {
  it("성공: 바이트·해시·만든 경로, 쓰기는 Blob 으로", async () => {
    const { io, calls } = fake();
    expect(await io.read("ab")).toEqual(new Uint8Array([2]));
    expect(await io.replace("a/x.json", new Uint8Array([1, 2]), "h0")).toEqual({ hash: "nh" });
    expect(calls.replace![1]).toBeInstanceOf(Blob);
    expect(new Uint8Array(await calls.replace![1].arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(calls.replace![2]).toBe("h0");
    expect(await io.create("a/y.json", new Uint8Array([3]))).toBe("a/y.json!");
    expect(calls.create![1]).toBeInstanceOf(Blob);
  });

  it("오류 갈래: 409 → conflict(교체)·exists(만들기), 404 → missing, 그 밖 → failed", async () => {
    expect(await code(fake({ replace: err(409) }).io.replace("p", new Uint8Array(), "h"))).toBe("conflict");
    expect(await code(fake({ create: err(409) }).io.create("p", new Uint8Array()))).toBe("exists");
    expect(await code(fake({ replace: err(404) }).io.replace("p", new Uint8Array(), "h"))).toBe("missing");
    expect(await code(fake({ read: err(404) }).io.read("p"))).toBe("missing");
    expect(await code(fake({ read: err(500) }).io.read("p"))).toBe("failed");
    expect(await code(fake({ replace: new TypeError("Failed to fetch") }).io.replace("p", new Uint8Array(), "h"))).toBe("failed");
    expect(await code(fake({ create: err(503) }).io.create("p", new Uint8Array()))).toBe("failed");
  });
});
