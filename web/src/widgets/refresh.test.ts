import { describe, expect, it } from "vitest";
import type { Resume } from "./mount";
import { flushBeforeRefresh, refreshAction, resumePlan } from "./refresh";
import type { FrameWidgetEntry, WidgetView } from "./registry";

const entry = (): FrameWidgetEntry => ({
  def: { id: "@me/c", version: 1, isolation: "frame", display: "block", defaultState: () => ({}), title: { en: "C" } },
  builtIn: false,
  messages: {},
  frame: async () => ({ kind: "text", js: "" }),
});
const widget = (e: FrameWidgetEntry, display: "block" | "inline" = "block"): WidgetView => ({
  kind: "widget",
  entry: e,
  block: { widget: { id: "@me/c", version: 1 }, extra: [] },
  state: {},
  from: 1,
  editable: true,
  display,
});
const err = (key: string, more: Partial<Extract<WidgetView, { kind: "error" }>> = {}): WidgetView => ({ kind: "error", key, ...more });

describe("refreshAction — 레지스트리가 바뀌었을 때 그려진 블록", () => {
  const a = entry();
  it("같은 위젯이면 none, 항목이 바뀌면 수정 중이 아닐 때 now·수정 중이면 defer", () => {
    expect(refreshAction(widget(a), widget(a), { editing: false })).toBe("none");
    expect(refreshAction(widget(a), widget(entry()), { editing: false })).toBe("now");
    expect(refreshAction(widget(a), widget(entry()), { editing: true })).toBe("defer");
    expect(refreshAction(widget(a), widget(a, "inline"), { editing: false })).toBe("now");
  });

  it("위젯 → 제거(오류)는 수정 중이면 defer, 준비 중 → 위젯은 now", () => {
    expect(refreshAction(widget(a), err("kw.notFound", { vars: { id: "@me/c" }, action: { kind: "install", id: "@me/c" } }), { editing: true })).toBe("defer");
    expect(refreshAction(err("kw.pending"), widget(a), { editing: false })).toBe("now");
  });

  it("같은 오류면 none, key·vars·action·error 가 다르면 now", () => {
    const nf = () => err("kw.notFound", { vars: { id: "@me/c" }, action: { kind: "install", id: "@me/c" } });
    expect(refreshAction(nf(), nf(), { editing: false })).toBe("none");
    expect(refreshAction(err("kw.pending"), err("kw.needsAppUpdate"), { editing: false })).toBe("now");
    const pf = (code: string) => err("kw.packageFailed", { error: { code, params: {} }, action: { kind: "market", id: "@me/c" } });
    expect(refreshAction(pf("a"), pf("a"), { editing: false })).toBe("none");
    expect(refreshAction(pf("a"), pf("b"), { editing: false })).toBe("now");
    expect(refreshAction(nf(), err("kw.notFound", { vars: { id: "@me/c" } }), { editing: false })).toBe("now");
  });
});

describe("flushBeforeRefresh", () => {
  it("데이터 파일이 있고 자동 저장 켬일 때만", () => {
    expect(flushBeforeRefresh({ hasFile: true, autosave: true })).toBe(true);
    expect(flushBeforeRefresh({ hasFile: true, autosave: false })).toBe(false);
    expect(flushBeforeRefresh({ hasFile: false, autosave: true })).toBe(false);
  });
});

const resume = (stateFrom: number, entryKey = "@me/c@1.0.0#a"): Resume => ({ draft: { n: 1 }, base: { n: 1 }, focus: null, stateFrom, entryKey });

describe("resumePlan — 다시 붙는 위젯이 필드의 수정을 이어받는가", () => {
  it("이어받을 것이 없으면 none", () => {
    expect(resumePlan(null, { kind: "widget", version: 1 })).toBe("none");
    expect(resumePlan(null, { kind: "error" })).toBe("none");
  });

  it("지금 판정이 위젯이고 판이 초안의 판 이상이면 resume — 항목 키는 보지 않는다", () => {
    expect(resumePlan(resume(1), { kind: "widget", version: 1 })).toBe("resume");
    expect(resumePlan(resume(1, "@me/c@0.9.0#z"), { kind: "widget", version: 2 })).toBe("resume");
  });

  it("판이 초안보다 낮거나 지금 오류면 hold(쓰지도 끝내지도 않는다 — 사용자 결정 2026-11-11)", () => {
    expect(resumePlan(resume(2), { kind: "widget", version: 1 })).toBe("hold");
    expect(resumePlan(resume(1), { kind: "error" })).toBe("hold");
  });
});
