import { afterEach, describe, expect, it } from "vitest";
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
