import { KeyedError } from "@keyring-notes/core";
import { describe, expect, it, vi } from "vitest";
import type { InstalledPackage, MarketState } from "../market/state";
import { registerThemeKind } from "./marketThemes";
import type { ThemePackage } from "./resolve";

const raw = import.meta.glob("../../../server/test/fixtures/market/packages/me/*/*/keyring-package.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const manifestText = (id: string, v: string) => raw[`../../../server/test/fixtures/market/packages/${id.slice(1)}/${v}/keyring-package.json`]!;

const pkg = (id: string, version: string): InstalledPackage => ({ id, version, repo: "https://r.test/", type: "theme", manifest: null, status: "ready" });

/** registerPackageKind 로 건 적용자를 잡아 두는 가짜 마켓 상태 */
function fake(ready: boolean, read: (id: string, path: string) => Promise<string>) {
  let applier: { apply(p: InstalledPackage[]): void | Promise<void> } | null = null;
  const m = {
    ready: () => ready,
    readPackageText: read,
    registerPackageKind: (_t: string, a: typeof applier) => {
      applier = a;
      return () => (applier = null);
    },
  } as unknown as MarketState;
  return { m, apply: (p: InstalledPackage[]) => applier!.apply(p) };
}

describe("registerThemeKind", () => {
  it("ready() 가 거짓이면 set 을 부르지 않는다(시작 캐시 유지)", async () => {
    const set = vi.fn();
    const f = fake(false, async () => "");
    registerThemeKind(f.m, set);
    await f.apply([pkg("@me/sea", "0.1.0")]);
    expect(set).not.toHaveBeenCalled();
  });

  it("참이면 sha 를 확인해 읽은 매니페스트로 부른다", async () => {
    const set = vi.fn();
    const read = vi.fn(async (id: string, path: string) => (path === "keyring-package.json" ? manifestText(id, "0.1.0") : ""));
    const f = fake(true, read);
    registerThemeKind(f.m, set);
    await f.apply([pkg("@me/sea", "0.1.0"), pkg("@me/paper", "0.1.0")]);
    const got = set.mock.calls.at(-1)![0] as ThemePackage[];
    expect(got.map((p) => p.id)).toEqual(["@me/sea", "@me/paper"]);
    expect(got[0]).toEqual({
      id: "@me/sea",
      version: "0.1.0",
      name: { en: "Sea" },
      colors: { light: { "--bg": "#eef6ff", "--accent": "#1d6fb8" }, dark: { "--bg": "#0d1b2a" } },
    });
    expect(read).toHaveBeenCalledWith("@me/sea", "keyring-package.json");
  });

  it("읽기에 실패한 패키지(sha 불일치)는 빠진다, 빈 목록이면 빈 배열", async () => {
    const set = vi.fn();
    const f = fake(true, async (id) => {
      if (id === "@me/fog") throw new KeyedError("market_hash_mismatch", { path: "keyring-package.json" });
      return manifestText(id, "0.1.0");
    });
    registerThemeKind(f.m, set);
    await f.apply([pkg("@me/fog", "0.1.0"), pkg("@me/sea", "0.1.0")]);
    expect((set.mock.calls.at(-1)![0] as ThemePackage[]).map((p) => p.id)).toEqual(["@me/sea"]);
    await f.apply([]);
    expect(set).toHaveBeenLastCalledWith([]);
  });
});
