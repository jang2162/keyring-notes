import { describe, expect, it } from "vitest";
import { checkWidgetMessages, WIDGET_MESSAGE_KEY_RE, WIDGET_MESSAGE_LIMITS } from "../src/index.js";

describe("checkWidgetMessages", () => {
  it("올바른 키·복수형 꼬리는 그대로", () => {
    expect(checkWidgetMessages({ title: "Clock", "count#one": "{n} tick" })).toEqual({
      messages: { title: "Clock", "count#one": "{n} tick" },
      dropped: [],
    });
  });

  it("꼴이 틀린 키·글자 아닌 값·2000자 넘는 값은 dropped", () => {
    const r = checkWidgetMessages({ "bad key": "x", a: 3, b: "y".repeat(2001), "<b>": "z" });
    expect(r).toEqual({ messages: {}, dropped: ["bad key", "a", "b", "<b>"] });
    expect(checkWidgetMessages({ b: "y".repeat(2000) })!.dropped).toEqual([]);
  });

  it("1000개를 넘는 뒤쪽 키는 dropped", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 1001; i++) raw[`k${i}`] = "v";
    const r = checkWidgetMessages(raw)!;
    expect(Object.keys(r.messages)).toHaveLength(WIDGET_MESSAGE_LIMITS.keys);
    expect(r.dropped).toEqual(["k1000"]);
  });

  it("객체가 아니면 null", () => {
    expect(checkWidgetMessages([])).toBeNull();
    expect(checkWidgetMessages("x")).toBeNull();
    expect(checkWidgetMessages(null)).toBeNull();
  });

  it("HTML 같은 값도 글자로 남긴다(앱은 HTML 로 해석하지 않는다)", () => {
    expect(checkWidgetMessages({ x: "<img src=x onerror=alert(1)>" })!.messages.x).toBe("<img src=x onerror=alert(1)>");
  });

  it("키 꼴", () => {
    for (const k of ["a", "_x", "a.b-c_d", "x#other", "a".repeat(100)]) expect(WIDGET_MESSAGE_KEY_RE.test(k), k).toBe(true);
    for (const k of ["", "-a", ".a", "a b", "a#lots", "a#", "a".repeat(101), "가"]) expect(WIDGET_MESSAGE_KEY_RE.test(k), k).toBe(false);
  });
});
