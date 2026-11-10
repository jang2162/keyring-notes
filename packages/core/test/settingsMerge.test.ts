import { describe, expect, it } from "vitest";
import { isAtomicSettingsKey, mergeSettingsObjects } from "../src/index.js";

const H = (c: string) => c.repeat(64);
const entry = (version: string, sha: string, repo = "https://a/") => ({ version, repo, sha256: { "keyring-package.json": H(sha), "frame.js": H(sha) } });
const withPkg = (e: unknown, extra: Record<string, unknown> = {}) => ({
  keyring: "settings",
  ...extra,
  marketplace: { packages: e === undefined ? {} : { "@a/b": e } },
});
const pkgOf = (o: Record<string, unknown>) => ((o.marketplace as { packages?: Record<string, unknown> } | undefined)?.packages ?? {})["@a/b"];

describe("잠금 항목은 통째로 합친다", () => {
  it("isAtomicSettingsKey", () => {
    expect(isAtomicSettingsKey(["marketplace", "packages", "@a/b"])).toBe(true);
    expect(isAtomicSettingsKey(["marketplace", "packages"])).toBe(false);
    expect(isAtomicSettingsKey(["marketplace", "packages", "@a/b", "version"])).toBe(false);
    expect(isAtomicSettingsKey(["ui", "packages", "@a/b"])).toBe(false);
  });

  it("둘 다 다른 판으로 바꿈 → 높은 판의 항목 통째, 충돌 없음", () => {
    const L = entry("1.3.0", "c");
    const r = mergeSettingsObjects(withPkg(entry("1.2.0", "a")), withPkg(L), withPkg(entry("1.2.1", "b")));
    expect(pkgOf(r.merged)).toEqual(L);
    expect(r.conflicts).toEqual([]);
    const r2 = mergeSettingsObjects(withPkg(entry("1.2.0", "a")), withPkg(entry("1.2.1", "b")), withPkg(entry("1.3.0", "c")));
    expect(pkgOf(r2.merged)).toEqual(entry("1.3.0", "c"));
  });

  it("한쪽이 지우고 다른 쪽이 바꿨으면 바꾼 쪽(업데이트가 이긴다)", () => {
    const B = withPkg(entry("1.2.0", "a"));
    expect(pkgOf(mergeSettingsObjects(B, withPkg(undefined), withPkg(entry("1.2.1", "b"))).merged)).toEqual(entry("1.2.1", "b"));
    const r = mergeSettingsObjects(B, withPkg(entry("1.3.0", "c")), withPkg(undefined));
    expect(pkgOf(r.merged)).toEqual(entry("1.3.0", "c"));
    expect(r.conflicts).toEqual([]);
  });

  it("항목 안 키 순서만 바꾼 것은 바꿈이 아니다 — 다른 쪽의 제거가 남는다", () => {
    const e = entry("1.2.0", "a");
    const reordered = {
      sha256: { "frame.js": e.sha256["frame.js"], "keyring-package.json": e.sha256["keyring-package.json"] },
      repo: e.repo,
      version: e.version,
    };
    const r = mergeSettingsObjects(withPkg(e), withPkg(reordered), withPkg(undefined));
    expect(pkgOf(r.merged)).toBeUndefined();
    expect(r.conflicts).toEqual([]);
  });

  it("같은 판 다른 repo → 서버 쪽, 한쪽만 바뀜 → 그쪽", () => {
    const B = withPkg(entry("1.2.0", "a"));
    expect(pkgOf(mergeSettingsObjects(B, withPkg(entry("1.3.0", "c", "https://l/")), withPkg(entry("1.3.0", "c", "https://s/"))).merged)).toEqual(
      entry("1.3.0", "c", "https://s/"),
    );
    expect(pkgOf(mergeSettingsObjects(B, withPkg(entry("1.3.0", "c")), B).merged)).toEqual(entry("1.3.0", "c"));
    expect(pkgOf(mergeSettingsObjects(B, B, withPkg(entry("1.3.0", "c"))).merged)).toEqual(entry("1.3.0", "c"));
    expect(pkgOf(mergeSettingsObjects(B, withPkg(undefined), B).merged)).toBeUndefined();
  });

  it("다른 키의 충돌은 그대로 conflicts 에 남는다", () => {
    const B = withPkg(entry("1.2.0", "a"), { ui: { theme: "light" } });
    const r = mergeSettingsObjects(B, withPkg(entry("1.3.0", "c"), { ui: { theme: "dark" } }), withPkg(entry("1.2.1", "b"), { ui: { theme: "system" } }));
    expect(r.conflicts).toEqual([{ key: ["ui", "theme"], local: "dark", server: "system" }]);
    expect(pkgOf(r.merged)).toEqual(entry("1.3.0", "c"));
  });

  it("기준이 없을 때(처음 연결) 양쪽에 다른 판 → 높은 판", () => {
    const r = mergeSettingsObjects(null, withPkg(entry("2.0.0", "c")), withPkg(entry("1.9.0", "b")));
    expect(pkgOf(r.merged)).toEqual(entry("2.0.0", "c"));
    expect(r.conflicts).toEqual([]);
    expect(pkgOf(mergeSettingsObjects(null, withPkg(entry("1.0.0", "c")), withPkg(entry("1.9.0", "b"))).merged)).toEqual(entry("1.9.0", "b"));
  });
});

describe("빈 묶음은 값이 아니다", () => {
  it("한 기기가 ui.keys 를 비우고 서버가 새 키를 더했으면 새 키가 남는다", () => {
    const base = { keyring: "settings", ui: { keys: { a: "Mod+A" } } };
    const local = { keyring: "settings", ui: { keys: {} } };
    const server = { keyring: "settings", ui: { keys: { a: "Mod+A", b: "Mod+B" } } };
    const r = mergeSettingsObjects(base, local, server);
    expect(r.merged).toEqual({ keyring: "settings", ui: { keys: { b: "Mod+B" } } });
    expect(r.conflicts).toEqual([]);
  });
});
