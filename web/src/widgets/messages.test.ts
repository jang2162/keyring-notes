import { afterEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { widgetMessages } from "./messages";
import type { WidgetEntry } from "./registry";
import { widgetT } from "./widgetT";

const def = { id: "t/m", version: 1, isolation: "frame" as const, display: "block" as const, defaultState: () => ({}), title: { en: "m" } };
const frame = async () => ({ kind: "text" as const, js: "" });

afterEach(() => setLanguage("en"));

describe("위젯 글", () => {
  const table: WidgetEntry = {
    def,
    builtIn: false,
    messages: { en: { a: "A {n}", "c#one": "one", "c#other": "{count} cs" }, ko: { a: "가 {n}" } },
    frame,
  };

  it("제3자 표: 언어 → 앞 낱말 → en, 복수형, 없는 키는 그대로", () => {
    const chain = widgetMessages(table, "ko");
    expect(widgetT(chain, "a", { n: 1 })).toBe("가 1");
    expect(widgetT(chain, "c", { count: 2 })).toBe("2 cs");
    expect(widgetT(chain, "c", { count: 1 })).toBe("one");
    expect(widgetT(chain, "zz")).toBe("zz");
    expect(widgetT(widgetMessages(table, "ko-KR"), "a", { n: 3 })).toBe("가 3");
    expect(widgetT(widgetMessages(table, "ja"), "a", { n: 3 })).toBe("A 3");
  });

  it("앱 메시지 앞머리: 앞머리를 뗀 키만, 다른 앞머리가 섞이지 않는다", () => {
    setLanguage("ko");
    const chain = widgetMessages({ def, builtIn: true, messages: "kw.dday", frame }, "ko");
    expect(chain.length).toBeGreaterThan(0);
    expect(widgetT(chain, "date")).toBe("날짜");
    for (const step of chain) {
      expect(Object.keys(step.messages).length).toBeGreaterThan(0);
      expect(Object.keys(step.messages).every((k) => !k.startsWith("kw.") && !k.includes("errorJson"))).toBe(true);
    }
    expect(widgetT(chain, "editRaw")).toBe("editRaw");
    expect(chain.map((c) => c.locale)).toEqual(["ko", "en"]);
  });
});

describe("앱 메시지 앞머리 거르기 캐시", () => {
  const dday: WidgetEntry = { def, builtIn: true, messages: "kw.dday", frame };

  it("같은 언어면 다시 거르지 않고 같은 표를 준다(받는 쪽이 고칠 수 없게 얼려서)", () => {
    setLanguage("ko");
    const a = widgetMessages(dday, "ko");
    const b = widgetMessages(dday, "ko");
    expect(b[0]!.messages).toBe(a[0]!.messages);
    expect(Object.isFrozen(a[0]!.messages)).toBe(true);
  });

  it("언어를 바꾸고 돌아와도 그 언어의 글", () => {
    setLanguage("ko");
    expect(widgetT(widgetMessages(dday, "ko"), "date")).toBe("날짜");
    setLanguage("en");
    expect(widgetT(widgetMessages(dday, "en"), "date")).toBe("Date");
    expect(widgetMessages(dday, "en").map((c) => c.locale)).toEqual(["en"]);
    setLanguage("ko");
    expect(widgetT(widgetMessages(dday, "ko"), "date")).toBe("날짜");
  });

  it("같은 언어의 언어팩을 새로 받거나 마켓 판이 바뀌면 새 글(캐시가 낡지 않는다)", async () => {
    vi.resetModules();
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    try {
      const i18n = await import("../i18n");
      const { widgetMessages: fresh } = await import("./messages");
      const { checkPack } = await import("@keyring-notes/core");
      const pack = (date: string) => {
        const r = checkPack({ meta: { id: "ja", name: "日本語", base: "en" }, messages: { "kw.dday.date": date } }, 100);
        if ("error" in r) throw new Error(r.error);
        return r;
      };
      i18n.putPack(pack("日付A").pack);
      i18n.setLanguagePref("ja");
      expect(widgetT(fresh(dday, "ja"), "date")).toBe("日付A");
      i18n.putPack(pack("日付B").pack);
      expect(widgetT(fresh(dday, "ja"), "date")).toBe("日付B");
      i18n.removePack("ja");
      const m = pack("日付M");
      i18n.setMarketPacks([{ pkgId: "@me/ja", pack: m.pack, report: m.report }]);
      expect(widgetT(fresh(dday, "ja"), "date")).toBe("日付M");
      const m2 = pack("日付M2");
      i18n.setMarketPacks([{ pkgId: "@me/ja", pack: m2.pack, report: m2.report }]);
      expect(widgetT(fresh(dday, "ja"), "date")).toBe("日付M2");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
