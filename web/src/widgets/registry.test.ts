import { beforeEach, describe, expect, it } from "vitest";
import { parseWidgetBlock } from "@keyring-notes/core";
import {
  widgetPaletteItems,
  effectiveIsolation,
  findWidget,
  isFrameEntry,
  registerWidget,
  resetWidgetsForTest,
  resolveWidgetView,
  widgetInsertText,
  widgetList,
  widgetViewChange,
  type WidgetEntry,
} from "./registry";
import type { WidgetDefinition } from "./types";

const render = () => () => {};
function entry(def: Partial<WidgetDefinition> & { id: string }, more: Partial<WidgetEntry> = {}): WidgetEntry {
  return {
    def: { version: 1, isolation: "inline", display: "block", defaultState: () => ({}), title: { en: def.id }, ...def },
    builtIn: true,
    messages: "kw.test",
    load: async () => ({ render }),
    ...more,
  };
}

const X = entry({
  id: "t/x",
  version: 2,
  display: "inline",
  defaultState: () => ({ n: 0 }),
  migrate: (s, from) => ({ ...(s as object), from }),
});

beforeEach(() => {
  resetWidgetsForTest();
  registerWidget(X);
});

describe("레지스트리", () => {
  it("등록·찾기·목록", () => {
    expect(findWidget("t/x")).toBe(X);
    expect(findWidget("t/y")).toBeNull();
    const Y = entry({ id: "t/y" });
    registerWidget(Y);
    expect(widgetList()).toEqual([X, Y]);
  });

  it("앱 코드가 아니면 frame 으로 강제", () => {
    expect(effectiveIsolation(entry({ id: "t/z" }, { builtIn: false }))).toBe("frame");
    expect(effectiveIsolation(entry({ id: "t/z" }))).toBe("inline");
    expect(effectiveIsolation(entry({ id: "t/z", isolation: "frame" }))).toBe("frame");
  });

  it("같은 id 는 등록을 거부", () => {
    expect(() => registerWidget(entry({ id: "t/x" }))).toThrow();
    expect(widgetList()).toEqual([X]);
  });

  it("iframe 위젯: 코드 원천·제3자 글 자리", () => {
    const frame = async () => ({ kind: "text" as const, js: "" });
    const table = { en: { a: "A" } };
    const third: WidgetEntry = { def: entry({ id: "t/third" }).def, builtIn: false, messages: table, frame };
    registerWidget(third);
    expect(effectiveIsolation(third)).toBe("frame");
    expect(isFrameEntry(third)).toBe(true);
    // 제3자가 load 만 → 앱 창에서 돌 길이 없다
    expect(() => registerWidget(entry({ id: "t/g" }, { builtIn: false, messages: table }))).toThrow();
    // 제3자가 앱 메시지 앞머리 → 앱 글을 읽게 되므로 거부
    expect(() => registerWidget({ def: entry({ id: "t/h" }).def, builtIn: false, messages: "x.y", frame })).toThrow();
    // frame 인데 load 만
    expect(() => registerWidget(entry({ id: "t/f", isolation: "frame" }))).toThrow();
    // 내장 frame 위젯(1단계에서는 throw)
    const builtinFrame: WidgetEntry = { def: entry({ id: "t/bf", isolation: "frame" }).def, builtIn: true, messages: "kw.test", frame };
    registerWidget(builtinFrame);
    expect(isFrameEntry(builtinFrame)).toBe(true);
    expect(isFrameEntry(X)).toBe(false);
    // inline 인데 load 없음
    expect(() => registerWidget({ def: entry({ id: "t/i" }).def, builtIn: true, messages: "kw.test", frame } as WidgetEntry)).toThrow();
    // dataFile.ext 는 "." 로 시작
    const df = (ext: string) => ({ ext, initial: () => new Uint8Array([1]) });
    expect(() =>
      registerWidget({ def: entry({ id: "t/d", isolation: "frame", dataFile: df("json") }).def, builtIn: true, messages: "kw.test", frame }),
    ).toThrow();
    registerWidget({ def: entry({ id: "t/e", isolation: "frame", dataFile: df(".x.json") }).def, builtIn: true, messages: "kw.test", frame });
  });

  it("widgetInsertText", () => {
    const text = widgetInsertText(X.def);
    expect(text).toBe('```keyring-widget\n{"widget": "t/x@2", "display": "inline", "state": {"n": 0}}\n```');
    expect(parseWidgetBlock(text.split("\n")[1]!).ok).toBe(true);
  });
});

describe("resolveWidgetView", () => {
  it("올린 상태와 정의 기본값", () => {
    expect(resolveWidgetView('{"widget":"t/x@1","state":{"n":1}}')).toMatchObject({
      kind: "widget",
      entry: X,
      state: { n: 1, from: 1 },
      editable: true,
      display: "inline",
    });
    expect(resolveWidgetView('{"widget":"t/x@2","display":"block","editable":false,"state":{"n":1}}')).toMatchObject({
      display: "block",
      editable: false,
      state: { n: 1 },
    });
  });

  it("state 가 없으면 defaultState", () => {
    expect(resolveWidgetView('{"widget":"t/x@2"}')).toMatchObject({ kind: "widget", state: { n: 0 } });
  });

  it("state 가 없으면 migrate 를 부르지 않는다", () => {
    registerWidget(entry({ id: "t/m", version: 2, defaultState: () => ({ d: "" }), migrate: (st) => ({ d: (st as { d: string }).d.trim() }) }));
    expect(resolveWidgetView('{"widget":"t/m@1"}')).toMatchObject({ kind: "widget", state: { d: "" } });
  });

  it("migrate·defaultState 가 던지면 예외 대신 오류 보기", () => {
    registerWidget(entry({ id: "t/m", version: 2, migrate: (st) => ({ d: (st as { d: string }).d.trim() }) }));
    expect(resolveWidgetView('{"widget":"t/m@1","state":{"d":1}}')).toEqual({ kind: "error", key: "kw.migrateFailed" });
    registerWidget(
      entry({
        id: "t/d",
        defaultState: () => {
          throw new Error("x");
        },
      }),
    );
    expect(resolveWidgetView('{"widget":"t/d@1"}')).toEqual({ kind: "error", key: "kw.migrateFailed" });
  });

  it("오류 종류마다 글 키", () => {
    expect(resolveWidgetView("{")).toEqual({ kind: "error", key: "kw.errorJson" });
    expect(resolveWidgetView("[]")).toEqual({ kind: "error", key: "kw.errorNotObject" });
    expect(resolveWidgetView("{}")).toEqual({ kind: "error", key: "kw.errorNoWidget" });
    expect(resolveWidgetView('{"widget":"x"}')).toEqual({ kind: "error", key: "kw.errorField", vars: { key: "widget" } });
    expect(resolveWidgetView('{"widget":"t/x@2","display":"wide"}')).toEqual({ kind: "error", key: "kw.errorField", vars: { key: "display" } });
    expect(resolveWidgetView('{"widget":"t/x@2","editable":"no"}')).toEqual({ kind: "error", key: "kw.errorField", vars: { key: "editable" } });
    expect(resolveWidgetView('{"widget":"t/y@1"}')).toEqual({ kind: "error", key: "kw.notFound", vars: { id: "t/y" } });
    expect(resolveWidgetView('{"widget":"t/x@3"}')).toEqual({ kind: "error", key: "kw.tooNew" });
  });
});

describe("widgetViewChange", () => {
  const v = (body: string) => resolveWidgetView(body);
  it("같은 위젯의 상태·editable 만 다르면 external", () => {
    expect(widgetViewChange(v('{"widget":"t/x@2","state":{"n":1}}'), v('{"widget":"t/x@2","state":{"n":2}}'))).toBe("external");
    expect(widgetViewChange(v('{"widget":"t/x@2"}'), v('{"widget":"t/x@2","editable":false}'))).toBe("external");
  });

  it("id·판정 종류·display 가 바뀌면 remount", () => {
    registerWidget(entry({ id: "t/y" }));
    expect(widgetViewChange(v('{"widget":"t/x@2"}'), v('{"widget":"t/y@1"}'))).toBe("remount");
    expect(widgetViewChange(v('{"widget":"t/x@2"}'), v("{"))).toBe("remount");
    expect(widgetViewChange(v("{"), v('{"widget":"t/x@2"}'))).toBe("remount");
    expect(widgetViewChange(v("{"), v("[]"))).toBe("remount");
    expect(widgetViewChange(v('{"widget":"t/x@2"}'), v('{"widget":"t/x@2","display":"block"}'))).toBe("remount");
  });
});

describe("widgetPaletteItems", () => {
  it("언어별 이름·id·넣기", () => {
    resetWidgetsForTest();
    const A = entry({ id: "t/a", title: { en: "X", ko: "엑스" } });
    const B = entry({ id: "t/b", title: { en: "Y" } });
    registerWidget(A);
    registerWidget(B);
    const got: string[] = [];
    const items = widgetPaletteItems("ko", (text) => got.push(text));
    expect(items.map((i) => i.label)).toEqual(["엑스", "Y"]);
    expect(items.map((i) => i.detail)).toEqual(["t/a", "t/b"]);
    items[0]!.run();
    expect(got).toEqual([widgetInsertText(A.def)]);
  });
});
