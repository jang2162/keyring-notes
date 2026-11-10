import { describe, expect, it, vi } from "vitest";
import { registerLanguageKind } from "./i18nMarket";
import type { InstalledPackage, MarketState } from "./market/state";

const jaText = (
  import.meta.glob("../../server/test/fixtures/market/packages/me/ja/0.1.0/messages.json", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >
)["../../server/test/fixtures/market/packages/me/ja/0.1.0/messages.json"]!;

const pkg = (id: string): InstalledPackage => ({ id, version: "0.1.0", repo: "https://r.test/", type: "language", manifest: null, status: "ready" });

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

type Entry = {
  pkgId: string;
  pack: { meta: { id: string }; messages: Record<string, string> };
  report: { htmlLike: string[]; unknown: string[]; placeholderMismatch: string[] };
};

describe("registerLanguageKind", () => {
  it("ready() 가 거짓이면 set 을 부르지 않는다", async () => {
    const set = vi.fn();
    const f = fake(false, async () => jaText);
    registerLanguageKind(f.m, set);
    await f.apply([pkg("@me/ja")]);
    expect(set).not.toHaveBeenCalled();
  });

  it("픽스처 @me/ja: 자리 틀린 키·기준에 없는 키는 버리고, HTML 같은 값은 글자 그대로", async () => {
    const set = vi.fn();
    const read = vi.fn(async () => jaText);
    const f = fake(true, read);
    registerLanguageKind(f.m, set);
    await f.apply([pkg("@me/ja")]);
    expect(read).toHaveBeenCalledWith("@me/ja", "messages.json");
    const [e] = set.mock.calls.at(-1)![0] as Entry[];
    expect(e!.pkgId).toBe("@me/ja");
    expect(e!.pack.meta.id).toBe("ja");
    expect(e!.pack.messages["lang.pack.added"]).toBeUndefined();
    expect(e!.pack.messages["zz.notInBase"]).toBeUndefined();
    expect(e!.pack.messages["common.save"]).toBe("<b>保存</b>");
    expect(e!.report.placeholderMismatch).toEqual(["lang.pack.added"]);
    expect(e!.report.unknown).toEqual(["zz.notInBase"]);
    expect(e!.report.htmlLike).toEqual(["common.save"]);
  });

  it("공식 id(ko)·읽기 실패·깨진 JSON 패키지는 빠진다", async () => {
    const set = vi.fn();
    const f = fake(true, async (id) => {
      if (id === "@me/ko") return JSON.stringify({ meta: { id: "ko", name: "x" }, messages: {} });
      if (id === "@me/bad") return "{";
      if (id === "@me/gone") throw new Error("market_hash_mismatch");
      return jaText;
    });
    registerLanguageKind(f.m, set);
    await f.apply([pkg("@me/ko"), pkg("@me/bad"), pkg("@me/gone"), pkg("@me/ja")]);
    expect((set.mock.calls.at(-1)![0] as Entry[]).map((e) => e.pkgId)).toEqual(["@me/ja"]);
  });
});
