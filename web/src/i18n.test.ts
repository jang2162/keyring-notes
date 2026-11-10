import { checkPack, type LanguagePack } from "@keyring-notes/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

type I18n = typeof import("./i18n");

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

let store = memoryStorage();

async function load(opts: { langs?: string[]; storage?: Record<string, string> } = {}): Promise<I18n> {
  vi.resetModules();
  store = memoryStorage(opts.storage);
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("navigator", { languages: opts.langs ?? ["en-US"], language: (opts.langs ?? ["en-US"])[0] });
  return import("./i18n");
}

function pack(id: string, messages: Record<string, string>, name = id): LanguagePack {
  const r = checkPack({ meta: { id, name, base: "en" }, messages }, 100);
  if ("error" in r) throw new Error(r.error);
  return r.pack;
}

function entry(pkgId: string, p: LanguagePack) {
  const r = checkPack(p, 100);
  if ("error" in r) throw new Error(r.error);
  return { pkgId, pack: r.pack, report: r.report };
}

const jaMarket = pack("ja", { "settings.title": "設定(マーケット)" }, "日本語");

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("마켓 언어 층", () => {
  it("마켓 ja 를 고르면 그 팩의 글, 없는 키는 영어, missingPack 없음", async () => {
    const i = await load();
    i.setMarketPacks([entry("@me/ja", jaMarket)]);
    i.setLanguagePref("ja");
    expect(i.language()).toBe("ja");
    expect(i.t("settings.title")).toBe("設定(マーケット)");
    expect(i.t("common.cancel")).toBe("Cancel");
    expect(i.missingPack()).toBeNull();
    expect(i.languages().filter((l) => l.id === "ja")).toEqual([
      expect.objectContaining({ id: "ja", source: "market", pkgId: "@me/ja", official: false, name: "日本語" }),
    ]);
  });

  it("이 기기 언어팩이 같은 ja 면 이 기기 것이 이기고 목록에 하나, shadows 에 마켓 id", async () => {
    const i = await load();
    i.putPack(pack("ja", { "settings.title": "設定(この端末)" }));
    i.setMarketPacks([entry("@me/ja", jaMarket)]);
    i.setLanguagePref("ja");
    expect(i.t("settings.title")).toBe("設定(この端末)");
    const ja = i.languages().filter((l) => l.id === "ja");
    expect(ja).toHaveLength(1);
    expect(ja[0]).toMatchObject({ source: "device", shadows: "@me/ja" });
  });

  it("마켓 패키지 둘이 ja 면 앞 것(잠금 순서), 뒤 것은 충돌로", async () => {
    const i = await load();
    i.setMarketPacks([entry("@me/ja", jaMarket), entry("@you/ja2", pack("ja", { "settings.title": "二番目" }))]);
    i.setLanguagePref("ja");
    expect(i.t("settings.title")).toBe("設定(マーケット)");
    expect(i.marketLanguageConflicts()).toEqual([{ lang: "ja", used: "@me/ja", ignored: ["@you/ja2"] }]);
    expect(i.marketPackReport("@you/ja2")).not.toBeNull();
  });

  it("마켓 층을 비우면 missingPack 이 ja, 기준 언어로", async () => {
    const i = await load();
    i.setMarketPacks([entry("@me/ja", jaMarket)]);
    i.setLanguagePref("ja");
    i.setMarketPacks([]);
    expect(i.missingPack()).toBe("ja");
    expect(i.language()).toBe("en");
    expect(i.t("settings.title")).toBe("Settings");
  });

  it("시스템 언어가 ja 인 기기: 마켓 ja 가 오는 순간 ja, 빠지면 en, 직접 고른 ko 는 그대로", async () => {
    const i = await load({ langs: ["ja-JP"] });
    i.setLanguagePref("");
    expect(i.language()).toBe("en");
    i.setMarketPacks([entry("@me/ja", jaMarket)]);
    expect(i.language()).toBe("ja");
    i.setMarketPacks([]);
    expect(i.language()).toBe("en");
    i.setLanguagePref("ko");
    i.setMarketPacks([entry("@me/ja", jaMarket)]);
    expect(i.language()).toBe("ko");
  });

  it("시작 캐시: 마켓 언어로 보이면 쓰고, 다음 시작에 다시 검사해 먼저 쓴다", async () => {
    const i = await load({ langs: ["ja-JP"] });
    i.setMarketPacks([entry("@me/ja", jaMarket)]);
    i.setLanguagePref("");
    const saved = store.map.get("keyring:langpack-market-cache")!;
    expect(JSON.parse(saved).pkgId).toBe("@me/ja");
    const again = await load({ langs: ["ja-JP"], storage: { "keyring:langpack-market-cache": saved } });
    expect(again.language()).toBe("ja");
    expect(again.t("settings.title")).toBe("設定(マーケット)");
    // 기본 언어로 보이게 되면 지운다
    again.setLanguagePref("ko");
    expect(store.map.has("keyring:langpack-market-cache")).toBe(false);
  });

  it("시작 캐시가 깨졌거나 공식 id 면 쓰지 않는다", async () => {
    const bad = JSON.stringify({ pkgId: "@me/ko", pack: { meta: { id: "ko", name: "x" }, messages: {} } });
    const i = await load({ langs: ["ja-JP"], storage: { "keyring:langpack-market-cache": bad } });
    expect(i.language()).toBe("en");
    const broken = await load({ storage: { "keyring:langpack-market-cache": "{" } });
    expect(broken.language()).toBe("en");
  });
});
