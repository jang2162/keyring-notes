import { beforeEach, describe, expect, it } from "vitest";
import { parseWidgetBlock } from "@keyring-notes/core";
import {
  effectiveIsolation,
  findWidget,
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

  it("frame 위젯(1단계)·같은 id 는 등록을 거부", () => {
    expect(() => registerWidget(entry({ id: "t/f", isolation: "frame" }))).toThrow();
    expect(() => registerWidget(entry({ id: "t/g" }, { builtIn: false }))).toThrow();
    expect(() => registerWidget(entry({ id: "t/x" }))).toThrow();
    expect(widgetList()).toEqual([X]);
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
