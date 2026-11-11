import { describe, expect, it } from "vitest";
import { focusOutAction, pinFile, widgetKeyAction, WidgetSession, type SessionHost } from "./session";

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

  it("초안을 바꾸지 않았으면 바깥 변경 뒤 포커스 아웃이 쓰지 않는다(바깥 변경을 되돌리지 않는다)", () => {
    const { s, of } = session({ state: { n: 1 } });
    s.requestEdit();
    s.external({ n: 5 }, true);
    s.focusOut();
    expect(of("write")).toEqual([]);
    expect(s.state).toEqual({ n: 5 });
  });

  it("바꿨다 시작 상태로 되돌린 초안도 바깥 변경 뒤 쓰지 않는다", () => {
    const { s, of } = session({ state: { n: 1 } });
    s.requestEdit();
    s.setState({ n: 2 });
    s.setState({ n: 1 });
    s.external({ n: 5 }, true);
    s.focusOut();
    expect(of("write")).toEqual([]);
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

  it("resumeDraft 가 있어도 고칠 수 없으면 수정 상태를 남기지 않는다", () => {
    for (const init of [{ editable: false }, { readOnly: true }]) {
      const { s, of } = session({ ...init, resumeDraft: { n: 4 } });
      expect(s.editing).toBe(false);
      expect(of("endEdit")).toHaveLength(1);
      expect(of("write")).toEqual([]);
    }
  });

  it("이어받을 때 「바뀌었는가」는 수정을 시작한 때 상태(resumeBase)로 본다 — 그사이 바깥 변경을 되돌리지 않는다", () => {
    const a = session({ state: { n: 5 }, resumeDraft: { n: 1 }, resumeBase: { n: 1 } });
    a.s.focusOut();
    expect(a.of("write")).toEqual([]);
    const b = session({ state: { n: 5 }, resumeDraft: { n: 2 }, resumeBase: { n: 1 } });
    b.s.focusOut();
    expect(b.of("write")).toEqual([["write", { n: 2 }]]);
  });

  it("editBase 는 수정을 시작한 때 상태 — 바깥 변경에도 그대로(다시 그릴 때 넘긴다)", () => {
    const { s } = session({ state: { n: 1 } });
    expect(s.editBase).toBeUndefined();
    s.requestEdit();
    s.external({ n: 5 }, true);
    expect(s.editBase).toEqual({ n: 1 });
    const r = session({ state: { n: 5 }, resumeDraft: { n: 2 }, resumeBase: { n: 1 } });
    expect(r.s.editBase).toEqual({ n: 1 });
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

/** 판까지 적는 호스트 — 편집기 필드(draft·base·stateFrom)도 흉내 낸다 */
function fieldHost() {
  const writes: unknown[] = [];
  const drafts: unknown[][] = [];
  const field: { draft?: unknown; base?: unknown; stateFrom?: number } = {};
  const h: SessionHost = {
    write: (s) => (writes.push(s), true),
    startEdit: (d, from) => Object.assign(field, { draft: d, base: d, stateFrom: from }),
    setDraft: (d, from, base) => {
      drafts.push(base === undefined ? [d, from] : [d, from, base]);
      Object.assign(field, { draft: d, stateFrom: from }, base === undefined ? {} : { base });
    },
    endEdit: () => {
      for (const k of Object.keys(field)) delete (field as Record<string, unknown>)[k];
    },
    changed: () => {},
  };
  return { h, writes, drafts, field };
}

describe("상태의 판(받은 위젯의 migrate)", () => {
  it("올린 상태를 받아도 쓰지 않고, 다음 setState 에 위젯 판으로 쓴다", () => {
    const x = fieldHost();
    const s = new WidgetSession({ state: { n: 1 }, editable: true, readOnly: false, version: 2, from: 1 }, x.h);
    expect(s.stateFrom).toBe(1);
    s.adoptMigrated({ count: 1 });
    expect(s.state).toEqual({ count: 1 });
    expect(s.stateFrom).toBe(2);
    expect(x.writes).toEqual([]);
    s.setState({ count: 4 });
    expect(x.writes).toEqual([{ count: 4 }]);
  });

  it("수정 중 바깥에서 옛 판 상태가 와도 초안을 다시 올리지 않고, 바꾸지 않고 끝내면 쓰지 않는다", () => {
    const x = fieldHost();
    const s = new WidgetSession({ state: { n: 1 }, editable: true, readOnly: false, version: 2, from: 1 }, x.h);
    s.adoptMigrated({ count: 1 });
    s.requestEdit();
    expect(s.stateFrom).toBe(2);
    expect(x.field.stateFrom).toBe(2);
    s.external({ n: 5 }, true, 1);
    expect(s.stateFrom).toBe(2);
    expect(s.state).toEqual({ count: 1 });
    s.focusOut();
    expect(x.writes).toEqual([]);
    // 끝난 뒤는 기준의 판 — 호스트가 이것으로 다시 보내 올린다
    expect(s.stateFrom).toBe(1);
    expect(s.state).toEqual({ n: 5 });
  });

  it("바꾼 초안은 바깥 변경이 와도 지키고 끝낼 때 쓴다", () => {
    const x = fieldHost();
    const s = new WidgetSession({ state: { count: 1 }, editable: true, readOnly: false, version: 2, from: 2 }, x.h);
    s.requestEdit();
    s.setState({ count: 9 });
    s.external({ n: 5 }, true, 1);
    s.focusOut();
    expect(x.writes).toEqual([{ count: 9 }]);
  });

  it("옛 판 초안을 이어받아 올림: 시작 때와 같았으면 필드 base 도 바꾸고 쓰지 않음, 달랐으면 올린 초안을 씀", () => {
    const same = fieldHost();
    const a = new WidgetSession(
      { state: { n: 1 }, editable: true, readOnly: false, version: 2, from: 1, resumeDraft: { n: 1 }, resumeBase: { n: 1 }, resumeFrom: 1 },
      same.h,
    );
    expect(a.stateFrom).toBe(1);
    a.adoptMigrated({ count: 1 });
    expect(a.stateFrom).toBe(2);
    expect(same.drafts).toEqual([[{ count: 1 }, 2, { count: 1 }]]);
    a.focusOut();
    expect(same.writes).toEqual([]);

    const diff = fieldHost();
    const b = new WidgetSession(
      { state: { n: 1 }, editable: true, readOnly: false, version: 2, from: 1, resumeDraft: { n: 7 }, resumeBase: { n: 1 }, resumeFrom: 1 },
      diff.h,
    );
    b.adoptMigrated({ count: 7 });
    expect(diff.drafts).toEqual([[{ count: 7 }, 2]]);
    b.focusOut();
    expect(diff.writes).toEqual([{ count: 7 }]);
  });

  it("이어받아 올린 뒤 한 번 더 다시 그려지고 바꾸지 않고 끝내면 쓰지 않는다", () => {
    const x = fieldHost();
    Object.assign(x.field, { draft: { n: 1 }, base: { n: 1 }, stateFrom: 1 });
    const first = new WidgetSession(
      {
        state: { n: 1 },
        editable: true,
        readOnly: false,
        version: 2,
        from: 1,
        resumeDraft: x.field.draft,
        resumeBase: x.field.base,
        resumeFrom: x.field.stateFrom,
      },
      x.h,
    );
    first.adoptMigrated({ count: 1 });
    expect(x.field).toEqual({ draft: { count: 1 }, base: { count: 1 }, stateFrom: 2 });
    const second = new WidgetSession(
      {
        state: { n: 1 },
        editable: true,
        readOnly: false,
        version: 2,
        from: 1,
        resumeDraft: x.field.draft,
        resumeBase: x.field.base,
        resumeFrom: x.field.stateFrom,
      },
      x.h,
    );
    expect(second.stateFrom).toBe(2);
    second.focusOut();
    expect(x.writes).toEqual([]);
  });

  it("pinFile: setState·adoptMigrated·수정 중 초안의 file 은 블록 값, 블록에 없으면 키를 뺀다", () => {
    const x = fieldHost();
    const pin = (st: unknown) => pinFile(st, "a/s-1.sketch");
    const s = new WidgetSession({ state: { file: "a/s-1.sketch" }, editable: true, readOnly: false, version: 1, from: 1, pinFile: pin }, x.h);
    s.setState({ file: "b/x.sketch", k: 1 });
    expect(x.writes).toEqual([{ file: "a/s-1.sketch", k: 1 }]);
    s.adoptMigrated({ count: 1, file: "b/x.sketch" });
    expect(s.state).toEqual({ count: 1, file: "a/s-1.sketch" });
    s.requestEdit();
    s.setState({ file: "c/y.sketch" });
    expect((s.state as { file: string }).file).toBe("a/s-1.sketch");

    const y = fieldHost();
    const t = new WidgetSession({ state: {}, editable: true, readOnly: false, pinFile: (st) => pinFile(st, undefined) }, y.h);
    t.setState({ file: "b/x.json" });
    expect(y.writes).toEqual([{}]);
  });

  it("pinFile 은 객체가 아니면 그대로", () => {
    expect(pinFile(3, "a")).toBe(3);
    expect(pinFile(null, "a")).toBeNull();
    expect(pinFile([1], "a")).toEqual([1]);
    expect(pinFile({ a: 1 }, "f")).toEqual({ a: 1, file: "f" });
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
