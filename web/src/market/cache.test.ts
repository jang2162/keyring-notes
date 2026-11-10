import { describe, expect, it } from "vitest";
import type { LockEntry } from "@keyring-notes/core";
import { memoryPackageCache, type PackageCache } from "./cache";

const H = (c: string) => c.repeat(64);
const entry = (version: string, c: string): LockEntry => ({ version, repo: "https://r/", sha256: { "keyring-package.json": H(c), "frame.js": H(c) } });
const files = (s: string) =>
  new Map([
    ["keyring-package.json", new TextEncoder().encode(`{"v":"${s}"}`)],
    ["frame.js", new TextEncoder().encode(s)],
  ]);

/** 세 구현(memory·IndexedDB·앱 데이터 폴더)이 지킬 계약. IDB·Tauri 는 Node 에서 돌지 않아 화면 확인(검문 3)으로 본다 */
export function cacheContract(make: () => PackageCache) {
  it("put 뒤 list·get, remove 뒤 없음, 같은 판 put 두 번은 덮어쓴다", async () => {
    const c = make();
    expect(await c.list()).toEqual([]);
    await c.put("@a/b", "1.0.0", entry("1.0.0", "a"), files("one"));
    expect(await c.list()).toEqual([{ id: "@a/b", version: "1.0.0", sha256: entry("1.0.0", "a").sha256 }]);
    expect(new TextDecoder().decode((await c.get("@a/b", "1.0.0", "frame.js"))!)).toBe("one");
    expect(await c.get("@a/b", "1.0.0", "messages/ko.json")).toBeNull();
    expect(await c.get("@a/b", "2.0.0", "frame.js")).toBeNull();
    await c.put("@a/b", "1.0.0", entry("1.0.0", "b"), files("two"));
    expect(await c.list()).toEqual([{ id: "@a/b", version: "1.0.0", sha256: entry("1.0.0", "b").sha256 }]);
    expect(new TextDecoder().decode((await c.get("@a/b", "1.0.0", "frame.js"))!)).toBe("two");
    await c.put("@c/d", "0.1.0", entry("0.1.0", "c"), files("three"));
    await c.remove("@a/b", "1.0.0");
    expect((await c.list()).map((x) => x.id)).toEqual(["@c/d"]);
    expect(await c.get("@a/b", "1.0.0", "frame.js")).toBeNull();
    await c.remove("@a/b", "1.0.0");
  });
  it("받은 쪽이 쥔 배열을 바꿔도 캐시가 바뀌지 않는다", async () => {
    const c = make();
    const f = files("one");
    await c.put("@a/b", "1.0.0", entry("1.0.0", "a"), f);
    f.get("frame.js")!.fill(0);
    expect(new TextDecoder().decode((await c.get("@a/b", "1.0.0", "frame.js"))!)).toBe("one");
  });
}

describe("memoryPackageCache", () => cacheContract(() => memoryPackageCache()));
