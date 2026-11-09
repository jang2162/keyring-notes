import { describe, expect, it } from "vitest";
import { focusOutAction, widgetKeyAction, WidgetSession, type SessionHost } from "./session";

function host(writeOk = true) {
  const calls: [string, unknown?][] = [];
  const h: SessionHost = {
    write: (s) => (calls.push(["write", s]), writeOk),
    startEdit: (d) => void calls.push(["startEdit", d]),
    setDraft: (d) => void calls.push(["setDraft", d]),
    endEdit: () => void calls.push(["endEdit"]),
    changed: (c) => void calls.push(["changed", c]),
  };
  const of = (name: string) => calls.filter(([n]) => n === name);
  return { h, calls, of };
}

function session(init: Partial<ConstructorParameters<typeof WidgetSession>[0]> = {}, writeOk = true) {
  const x = host(writeOk);
  const s = new WidgetSession({ state: { n: 1, m: 0 }, editable: true, readOnly: false, ...init }, x.h);
  return { s, ...x };
}

describe("보기 모드 상호작용", () => {
  it("setState 는 얕은 병합으로 곧바로 한 번 쓴다", () => {
    const { s, of } = session();
    s.setState({ n: 2 });
    expect(of("write")).toEqual([["write", { n: 2, m: 0 }]]);
    expect(s.state).toEqual({ n: 2, m: 0 });
  });

  it("__proto__ patch 도 own 키로 남는다", () => {
    const { s, of } = session();
    s.setState(JSON.parse('{"__proto__": 1}'));
    const written = of("write")[0]![1] as object;
    expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
  });

  it("쓰지 못하면 상태가 그대로", () => {
    const { s } = session({}, false);
    s.setState({ n: 2 });
    expect(s.state).toEqual({ n: 1, m: 0 });
  });

  it("editable false·readOnly 면 무시", () => {
    for (const init of [{ editable: false }, { readOnly: true }]) {
      const { s, of } = session(init);
      s.setState({ n: 2 });
      s.requestEdit();
      expect(of("write")).toEqual([]);
      expect(of("startEdit")).toEqual([]);
      expect(s.editing).toBe(false);
    }
  });

  it("만들기만으로는 쓰지 않는다", () => {
    const { calls } = session();
    expect(calls).toEqual([]);
  });
});

describe("수정 모드", () => {
  it("초안만 바꾸고 포커스 아웃에 한 번 쓴다", () => {
    const { s, of } = session();
    s.requestEdit();
    expect(s.editing).toBe(true);
    expect(of("startEdit")).toEqual([["startEdit", { n: 1, m: 0 }]]);
    s.setState({ n: 2 });
    s.setState({ m: 3 });
    expect(of("write")).toEqual([]);
    expect(of("setDraft")).toEqual([
      ["setDraft", { n: 2, m: 0 }],
      ["setDraft", { n: 2, m: 3 }],
    ]);
    s.focusOut();
    expect(of("write")).toEqual([["write", { n: 2, m: 3 }]]);
    expect(of("endEdit")).toHaveLength(1);
    expect(s.editing).toBe(false);
    expect(s.state).toEqual({ n: 2, m: 3 });
    s.focusOut();
    expect(of("write")).toHaveLength(1);
    expect(of("endEdit")).toHaveLength(1);
  });

  it("두 번 requestEdit 해도 시작은 한 번", () => {
    const { s, of } = session();
    s.requestEdit();
    s.requestEdit();
    expect(of("startEdit")).toHaveLength(1);
  });

  it("바꾸지 않았거나 되돌렸으면 쓰지 않는다", () => {
    const a = session();
    a.s.requestEdit();
    a.s.focusOut();
    expect(a.of("write")).toEqual([]);
    expect(a.of("endEdit")).toHaveLength(1);
    const b = session();
    b.s.requestEdit();
    b.s.setState({ n: 5 });
    b.s.setState({ n: 1 });
    b.s.focusOut();
    expect(b.of("write")).toEqual([]);
  });

  it("Esc 는 초안을 버린다", () => {
    const { s, of } = session();
    expect(s.escape()).toBe(false);
    s.requestEdit();
    s.setState({ n: 7 });
    expect(s.escape()).toBe(true);
    expect(of("write")).toEqual([]);
    expect(of("endEdit")).toHaveLength(1);
    expect(s.state).toEqual({ n: 1, m: 0 });
    expect(s.editing).toBe(false);
  });

  it("exitEdit(true|false)", () => {
    const a = session();
    a.s.requestEdit();
    a.s.setState({ n: 2 });
    a.s.exitEdit(true);
    expect(a.of("write")).toEqual([["write", { n: 2, m: 0 }]]);
    const b = session();
    b.s.requestEdit();
    b.s.setState({ n: 2 });
    b.s.exitEdit(false);
    expect(b.of("write")).toEqual([]);
    expect(b.s.state).toEqual({ n: 1, m: 0 });
  });

  it("수정 중 바깥 변경은 초안을 지키고, 적용 때 초안을 쓴다", () => {
    const { s, of } = session();
    s.requestEdit();
    s.setState({ n: 2 });
    s.external({ n: 5 }, true);
    expect(s.state).toEqual({ n: 2, m: 0 });
    s.focusOut();
    expect(of("write")).toEqual([["write", { n: 2, m: 0 }]]);
  });

  it("보기 모드 바깥 변경은 상태만 바꾼다", () => {
    const { s, of } = session();
    s.external({ n: 5 }, true);
    expect(s.state).toEqual({ n: 5 });
    expect(of("write")).toEqual([]);
    s.external({ n: 5 }, false);
    s.setState({ n: 6 });
    expect(of("write")).toEqual([]);
  });

  it("수정 중 바깥에서 editable false 가 되면 쓰지 않고 끝낸다", () => {
    const { s, of } = session();
    s.requestEdit();
    s.setState({ n: 2 });
    s.external({ n: 1 }, false);
    expect(s.editing).toBe(false);
    expect(of("endEdit")).toHaveLength(1);
    s.focusOut();
    expect(of("write")).toEqual([]);
  });

  it("수정 중 블록이 사라지면 버리고 쓰지 않는다", () => {
    const { s, of } = session();
    s.requestEdit();
    s.setState({ n: 2 });
    s.gone();
    expect(of("endEdit")).toHaveLength(1);
    expect(s.editing).toBe(false);
    s.focusOut();
    expect(of("write")).toEqual([]);
  });

  it("resumeDraft 로 이어받으면 시작을 다시 부르지 않는다", () => {
    const { s, of } = session({ resumeDraft: { n: 4 } });
    expect(s.editing).toBe(true);
    expect(s.state).toEqual({ n: 4 });
    expect(of("startEdit")).toEqual([]);
    s.focusOut();
    expect(of("write")).toEqual([["write", { n: 4 }]]);
  });
});

describe("키·포커스 판정", () => {
  it("widgetKeyAction", () => {
    expect(widgetKeyAction({ key: "Escape", isComposing: false, keyCode: 27 })).toBe("escape");
    expect(widgetKeyAction({ key: "Escape", isComposing: true, keyCode: 27 })).toBeNull();
    expect(widgetKeyAction({ key: "Escape", isComposing: false, keyCode: 229 })).toBeNull();
    expect(widgetKeyAction({ key: "Enter", isComposing: false, keyCode: 13 })).toBeNull();
  });

  it("focusOutAction", () => {
    expect(focusOutAction({ rootConnected: true, relatedInside: false })).toBe("apply");
    expect(focusOutAction({ rootConnected: true, relatedInside: true })).toBe("ignore");
    expect(focusOutAction({ rootConnected: false, relatedInside: false })).toBe("ignore");
    expect(focusOutAction({ rootConnected: false, relatedInside: true })).toBe("ignore");
  });
});
