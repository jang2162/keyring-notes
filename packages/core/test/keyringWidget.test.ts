import { describe, expect, it } from "vitest";
import { parseWidgetBlock, resolveWidgetState, serializeWidgetBlock, widgetOneLine, withWidgetState, type KeyringWidgetBlock } from "../src/index.js";

function block(body: string): KeyringWidgetBlock {
  const r = parseWidgetBlock(body);
  if (!r.ok) throw new Error(`parse failed: ${r.error}`);
  return r.block;
}

const SPEC_EXAMPLE = '{"widget": "keyring/dday@1", "display": "block", "editable": true, "state": {"targetDate": "2026-12-25", "label": "크리스마스"}}';

describe("keyring-widget 블록 파싱", () => {
  it("설계 예시", () => {
    const r = parseWidgetBlock(SPEC_EXAMPLE);
    expect(r).toEqual({
      ok: true,
      block: {
        widget: { id: "keyring/dday", version: 1 },
        display: "block",
        editable: true,
        state: { targetDate: "2026-12-25", label: "크리스마스" },
        extra: [],
      },
    });
  });

  it("엄격한 JSON — 주석·끝 쉼표·따옴표 없는 키는 json 오류", () => {
    for (const body of ['{"widget":"a/b@1", // x\n}', '{"widget":"a/b@1",}', '{widget:"a/b@1"}']) {
      expect(parseWidgetBlock(body)).toMatchObject({ ok: false, error: "json" });
    }
  });

  it("모양이 틀리면 종류별 오류", () => {
    expect(parseWidgetBlock("[]")).toMatchObject({ ok: false, error: "notObject" });
    expect(parseWidgetBlock("1")).toMatchObject({ ok: false, error: "notObject" });
    expect(parseWidgetBlock("{}")).toMatchObject({ ok: false, error: "noWidget" });
    for (const w of ['"dday"', '"a/b@0"', '"a/b@1.5"', '"A/b@1"', "1"]) {
      expect(parseWidgetBlock(`{"widget": ${w}}`)).toMatchObject({ ok: false, error: "badWidget" });
    }
    expect(parseWidgetBlock('{"widget": "a/b@1", "display": "wide"}')).toMatchObject({ ok: false, error: "badDisplay" });
    expect(parseWidgetBlock('{"widget": "a/b@1", "editable": "no"}')).toMatchObject({ ok: false, error: "badEditable" });
  });
});

describe("keyring-widget 블록 직렬화", () => {
  it("짧으면 한 줄 꼴", () => {
    expect(serializeWidgetBlock(block('{"widget":"a/b@1","state":{"n":1}}'))).toBe('{"widget": "a/b@1", "state": {"n": 1}}');
  });

  it("예약 키 순서, 모르는 키는 뒤에", () => {
    expect(serializeWidgetBlock(block('{"state":{"n":1},"x":2,"editable":false,"widget":"a/b@1"}'))).toBe(
      '{"widget": "a/b@1", "editable": false, "state": {"n": 1}, "x": 2}',
    );
  });

  it("80자(UTF-16) 경계", () => {
    const at = (label: string) => serializeWidgetBlock(block(JSON.stringify({ widget: "a/b@1", state: { label } })));
    expect('{"widget": "a/b@1", "state": {"label": ""}}'.length).toBe(43);
    const l37 = "x".repeat(37);
    expect(at(l37)).toBe(`{"widget": "a/b@1", "state": {"label": "${l37}"}}`);
    expect(at(l37).length).toBe(80);
    const l38 = "x".repeat(38);
    expect(at(l38)).toBe(JSON.stringify({ widget: "a/b@1", state: { label: l38 } }, null, 2));
    const ko = "가".repeat(37);
    expect(at(ko)).toBe(`{"widget": "a/b@1", "state": {"label": "${ko}"}}`);
  });

  it("설계 예시는 여러 줄", () => {
    expect(serializeWidgetBlock(block(SPEC_EXAMPLE))).toBe(
      '{\n  "widget": "keyring/dday@1",\n  "display": "block",\n  "editable": true,\n  "state": {\n    "targetDate": "2026-12-25",\n    "label": "크리스마스"\n  }\n}',
    );
  });

  it("없는 display·editable 은 쓰지 않고, 왕복이 같다", () => {
    const b = block('{"widget":"a/b@1","state":{"n":1}}');
    const s = serializeWidgetBlock(b);
    expect(s).not.toContain("display");
    expect(s).not.toContain("editable");
    expect(serializeWidgetBlock(block(s))).toBe(s);
    const long = serializeWidgetBlock(block(SPEC_EXAMPLE));
    expect(serializeWidgetBlock(block(long))).toBe(long);
  });

  it("widgetOneLine", () => {
    expect(widgetOneLine([1, { a: [] }, {}])).toBe('[1, {"a": []}, {}]');
  });

  it("정수꼴 키는 state 뒤에 남는다", () => {
    expect(serializeWidgetBlock(block('{"widget":"a/b@1","1":true,"state":{}}'))).toBe('{"widget": "a/b@1", "state": {}, "1": true}');
  });

  it("__proto__ 키가 조용히 지워지지 않는다", () => {
    const body = '{"widget":"a/b@1","__proto__":{"x":1},"state":{"__proto__":2}}';
    const once = serializeWidgetBlock(block(body));
    expect(once).toBe('{"widget": "a/b@1", "state": {"__proto__": 2}, "__proto__": {"x": 1}}');
    expect(serializeWidgetBlock(block(once))).toBe(once);
    const long = serializeWidgetBlock(withWidgetState(block(body), { __proto__: null, ...JSON.parse('{"__proto__": 2, "pad": "' + "x".repeat(60) + '"}') }, 1));
    expect(long).toContain('    "__proto__": 2,');
    expect(long).toContain('  "__proto__": {\n    "x": 1\n  }');
  });
});

describe("keyring-widget 판", () => {
  const b1 = block('{"widget":"a/b@1","state":{"n":1}}');

  it("migrate 가 있으면 올린다", () => {
    const def = { version: 2, migrate: (s: unknown, from: number) => ({ ...(s as object), from }) };
    expect(resolveWidgetState(b1, def)).toEqual({ kind: "ok", state: { n: 1, from: 1 }, migrated: true });
  });

  it("migrate 가 없으면 그대로(호환)", () => {
    expect(resolveWidgetState(b1, { version: 2 })).toEqual({ kind: "ok", state: { n: 1 }, migrated: false });
  });

  it("같은 판은 그대로, 높은 판은 tooNew", () => {
    expect(resolveWidgetState(b1, { version: 1, migrate: () => "no" })).toEqual({ kind: "ok", state: { n: 1 }, migrated: false });
    expect(resolveWidgetState(block('{"widget":"a/b@3"}'), { version: 2 })).toEqual({ kind: "tooNew" });
  });

  it("withWidgetState 는 상태와 판만 바꾼다", () => {
    const b = block('{"widget":"a/b@1","display":"inline","editable":false,"state":{"n":1},"x":2}');
    const next = withWidgetState(b, { n: 2 }, 2);
    expect(next).toEqual({ widget: { id: "a/b", version: 2 }, display: "inline", editable: false, state: { n: 2 }, extra: [["x", 2]] });
  });
});
