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
  notifyWidgetsChanged,
  onWidgetsChange,
  setMarketWidgets,
  setMissingWidgetResolver,
  widgetEntryKey,
  type FrameWidgetEntry,
  type MissingWidget,
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
    const third: WidgetEntry = { def: entry({ id: "@t/third" }).def, builtIn: false, messages: table, frame };
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

  it("widgetInsertText 에 상태를 주면 그것으로(데이터 파일 경로)", () => {
    const text = widgetInsertText(X.def, { file: "a/b.x.json" });
    const r = parseWidgetBlock(text.split("\n").slice(1, -1).join("\n"));
    expect(r.ok && r.block.state).toEqual({ file: "a/b.x.json" });
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

const frameCode = async () => ({ kind: "text" as const, js: "" });
function market(id: string, more: Partial<FrameWidgetEntry> & { version?: number } = {}): FrameWidgetEntry {
  const { version = 1, ...rest } = more;
  return {
    def: { id, version, isolation: "frame", display: "block", defaultState: () => ({ d: 1 }), title: { en: id } },
    builtIn: false,
    messages: {},
    frame: frameCode,
    ...rest,
  };
}

describe("받은 위젯 id 와 내장 id 는 겹치지 않는다", () => {
  it("받은 위젯이 내장 꼴 id 를 쓰거나 내장이 @ 꼴을 쓰면 거부", () => {
    expect(() => registerWidget(market("keyring/dday"))).toThrow();
    expect(() => registerWidget({ ...market("@me/x"), builtIn: true, messages: "kw.test" })).toThrow();
    registerWidget(market("@me/x"));
    expect(findWidget("@me/x")).not.toBeNull();
  });
});

describe("setMarketWidgets·onWidgetsChange", () => {
  let calls = 0;
  let off: () => void = () => {};
  beforeEach(() => {
    setMissingWidgetResolver(null);
    calls = 0;
    off();
    off = onWidgetsChange(() => calls++);
  });

  it("바뀐 것이 있을 때만 알리고, 내장은 건드리지 않는다", () => {
    const a = market("@me/a");
    const list = [a];
    setMarketWidgets(list);
    expect(calls).toBe(1);
    expect(findWidget("@me/a")).toBe(a);
    setMarketWidgets(list);
    setMarketWidgets([a]);
    expect(calls).toBe(1);
    const a2 = market("@me/a");
    setMarketWidgets([a2]);
    expect(calls).toBe(2);
    expect(findWidget("@me/a")).toBe(a2);
    setMarketWidgets([]);
    expect(calls).toBe(3);
    expect(findWidget("@me/a")).toBeNull();
    expect(widgetList()).toEqual([X]);
  });

  it("내장 → 받은 것 순서, 받은 것은 넘긴 순서", () => {
    const a = market("@me/a");
    const b = market("@me/b");
    setMarketWidgets([b, a]);
    expect(widgetList()).toEqual([X, b, a]);
  });

  it("registerWidget 과 같이 거부하고, 하나라도 틀리면 아무것도 바꾸지 않는다", () => {
    const a = market("@me/a");
    setMarketWidgets([a]);
    const bad: FrameWidgetEntry[][] = [
      [market("@me/b"), market("@me/b")],
      [market("keyring/dday")],
      [{ ...market("@me/x"), builtIn: true, messages: "kw.test" }],
      [{ ...market("@me/x"), messages: "kw.dday" }],
      [{ ...market("@me/x"), frame: undefined as unknown as FrameWidgetEntry["frame"] }],
      [market("@me/x", { def: { ...market("@me/x").def, dataFile: { ext: "sketch", initial: () => new Uint8Array([1]) } } })],
      [market("t/x")],
    ];
    for (const list of bad) expect(() => setMarketWidgets(list), list[0]!.def.id).toThrow();
    expect(findWidget("@me/a")).toBe(a);
    expect(calls).toBe(1);
  });

  it("notifyWidgetsChanged 는 알리기만, 끊으면 오지 않는다", () => {
    notifyWidgetsChanged();
    expect(calls).toBe(1);
    off();
    notifyWidgetsChanged();
    expect(calls).toBe(1);
  });

  it("widgetEntryKey: 내장은 id, 받은 위젯은 pkgKey", () => {
    expect(widgetEntryKey(X)).toBe("t/x");
    expect(widgetEntryKey(market("@me/a", { pkgKey: "@me/a@1.0.0#k" }))).toBe("@me/a@1.0.0#k");
  });
});

describe("없는 위젯의 까닭", () => {
  beforeEach(() => setMissingWidgetResolver(null));
  const v = (body: string) => resolveWidgetView(body);

  it("판정기 없음 → kw.notFound, 단추 없음", () => {
    expect(v('{"widget":"@me/a@1"}')).toEqual({ kind: "error", key: "kw.notFound", vars: { id: "@me/a" } });
  });

  it("판정기의 답마다 글 키·단추·까닭", () => {
    const answer: { a: MissingWidget } = { a: { kind: "notFound", install: true } };
    setMissingWidgetResolver(() => answer.a);
    expect(v('{"widget":"@me/a@1"}')).toEqual({ kind: "error", key: "kw.notFound", vars: { id: "@me/a" }, action: { kind: "install", id: "@me/a" } });
    answer.a = { kind: "notFound", install: false };
    expect(v('{"widget":"@me/a@1"}')).toEqual({ kind: "error", key: "kw.notFound", vars: { id: "@me/a" } });
    answer.a = { kind: "pending" };
    expect(v('{"widget":"@me/a@1"}')).toEqual({ kind: "error", key: "kw.pending" });
    answer.a = { kind: "incompatible" };
    expect(v('{"widget":"@me/a@1"}')).toEqual({ kind: "error", key: "kw.needsAppUpdate" });
    answer.a = { kind: "failed", error: { code: "market_scope_reserved", params: { id: "@me/a" } } };
    expect(v('{"widget":"@me/a@1"}')).toEqual({
      kind: "error",
      key: "kw.packageFailed",
      error: { code: "market_scope_reserved", params: { id: "@me/a" } },
      action: { kind: "market", id: "@me/a" },
    });
  });
});

describe("받은 위젯의 상태 판", () => {
  it("부모가 migrate 하지 않고 블록 판을 from 으로, state 가 없으면 기본 상태와 위젯 판", () => {
    const c = market("@me/c", { version: 2 });
    setMarketWidgets([c]);
    expect(resolveWidgetView('{"widget":"@me/c@1","state":{"n":1}}')).toMatchObject({ kind: "widget", entry: c, state: { n: 1 }, from: 1 });
    expect(resolveWidgetView('{"widget":"@me/c@1"}')).toMatchObject({ kind: "widget", state: { d: 1 }, from: 2 });
    expect(resolveWidgetView('{"widget":"@me/c@3"}')).toEqual({ kind: "error", key: "kw.tooNew" });
  });

  it("내장은 부모가 올리므로 from 이 def.version", () => {
    expect(resolveWidgetView('{"widget":"t/x@1","state":{"n":1}}')).toMatchObject({ kind: "widget", from: 2 });
  });

  it("항목 객체가 바뀌면 remount(판 교체)", () => {
    setMarketWidgets([market("@me/c")]);
    const before = resolveWidgetView('{"widget":"@me/c@1"}');
    setMarketWidgets([market("@me/c")]);
    expect(widgetViewChange(before, resolveWidgetView('{"widget":"@me/c@1"}'))).toBe("remount");
  });
});
