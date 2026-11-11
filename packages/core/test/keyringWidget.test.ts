import { describe, expect, it } from "vitest";
import {
  formatWidgetRef,
  parseWidgetBlock,
  parseWidgetRef,
  resolveWidgetState,
  rewriteWidgetFileRefs,
  serializeWidgetBlock,
  widgetDataPath,
  widgetFileRefs,
  widgetOneLine,
  withWidgetState,
  type KeyringWidgetBlock,
} from "../src/index.js";

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

describe("위젯 ref — 내장 scope/name 과 받은 위젯 @scope/name", () => {
  it("받은 위젯 id 를 읽고 왕복한다, 내장 꼴은 그대로", () => {
    expect(parseWidgetRef("@me/clock@1")).toEqual({ id: "@me/clock", version: 1 });
    expect(formatWidgetRef(parseWidgetRef("@me/clock@12")!)).toBe("@me/clock@12");
    expect(parseWidgetRef("keyring/dday@1")).toEqual({ id: "keyring/dday", version: 1 });
  });
  it("@@·대문자·빈 scope·0판·판 없음·이름 앞 @ 는 거부", () => {
    for (const s of ["@@me/clock@1", "@me/Clock@1", "@/x@1", "@me/clock@0", "@me/clock", "me/@clock@1"]) expect(parseWidgetRef(s)).toBeNull();
  });
  it("받은 위젯 블록을 읽고 같은 글로 쓴다", () => {
    const body = '{"widget": "@me/clock@2", "state": {"count": 1}}';
    const r = parseWidgetBlock(body);
    expect(r).toEqual({ ok: true, block: { widget: { id: "@me/clock", version: 2 }, state: { count: 1 }, extra: [] } });
    expect(serializeWidgetBlock(block(body))).toBe(body);
  });
  it("받은 위젯 블록의 state.file 도 첨부 링크", () => {
    const c = '```keyring-widget\n{"widget": "@me/sketch@1", "state": {"file": "x/a.sketch"}}\n```\n';
    expect(widgetFileRefs(c)).toEqual(["x/a.sketch"]);
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

describe("keyring-widget 직렬화 — JSON 의미", () => {
  it("한 줄 꼴과 여러 줄 꼴이 같은 값(toJSON)을 쓴다", () => {
    const d = new Date(Date.UTC(2026, 11, 25));
    const short = serializeWidgetBlock(withWidgetState(block('{"widget":"a/b@1"}'), { d }, 1));
    expect(short).toBe('{"widget": "a/b@1", "state": {"d": "2026-12-25T00:00:00.000Z"}}');
    const long = serializeWidgetBlock(withWidgetState(block('{"widget":"a/b@1"}'), { d, pad: "x".repeat(60) }, 1));
    expect(JSON.parse(long).state.d).toBe("2026-12-25T00:00:00.000Z");
  });

  it("JSON 이 버리는 값은 두 꼴 모두 같게 버린다", () => {
    const st = { f: () => 1, u: undefined, a: [undefined, () => 1, NaN], s: Symbol("x") };
    const short = serializeWidgetBlock(withWidgetState(block('{"widget":"a/b@1"}'), st, 1));
    expect(short).toBe('{"widget": "a/b@1", "state": {"a": [null, null, null]}}');
    expect(JSON.parse(short).state).toEqual(JSON.parse(JSON.stringify(st)));
    // 바깥 층 값이 JSON 으로 없는 값이면 키째 빠진다(JSON.stringify 와 같이)
    expect(serializeWidgetBlock(withWidgetState(block('{"widget":"a/b@1"}'), () => 1, 1))).toBe('{"widget": "a/b@1"}');
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

  it("state 가 없으면 migrate 를 부르지 않는다", () => {
    let called = 0;
    const def = { version: 2, migrate: () => (called++, { x: 1 }) };
    expect(resolveWidgetState(block('{"widget":"a/b@1"}'), def)).toEqual({ kind: "ok", state: undefined, migrated: false });
    expect(called).toBe(0);
  });

  it("withWidgetState 는 상태와 판만 바꾼다", () => {
    const b = block('{"widget":"a/b@1","display":"inline","editable":false,"state":{"n":1},"x":2}');
    const next = withWidgetState(b, { n: 2 }, 2);
    expect(next).toEqual({ widget: { id: "a/b", version: 2 }, display: "inline", editable: false, state: { n: 2 }, extra: [["x", 2]] });
  });
});

describe("데이터 파일 경로(state.file)", () => {
  const EXT = ".excalidraw.json";
  it("정규형 볼트 경로이고 ext 로 끝나면 그 값", () => {
    expect(widgetDataPath({ file: "회의록/스케치-3f9a.excalidraw.json" }, EXT)).toBe("회의록/스케치-3f9a.excalidraw.json");
    expect(widgetDataPath({ file: "a/B.EXCALIDRAW.JSON" }, EXT)).toBe("a/B.EXCALIDRAW.JSON");
  });
  it.each([
    [{ file: "../밖.excalidraw.json" }],
    [{ file: "/abs.excalidraw.json" }],
    [{ file: ".h/x.excalidraw.json" }],
    [{ file: "a//b.excalidraw.json" }],
    [{ file: "a\\b.excalidraw.json" }],
    [{ file: "a/b.json" }],
    [{ file: ".excalidraw.json" }],
    [{ file: "" }],
    [{ file: 1 }],
    [{}],
    [null],
    ["x"],
  ])("아니면 null: %j", (state) => {
    expect(widgetDataPath(state, EXT)).toBeNull();
  });
  it("ext 없이는 정규형만 본다", () => {
    expect(widgetDataPath({ file: "a/b.json" })).toBe("a/b.json");
    expect(widgetDataPath({ file: "../b.json" })).toBeNull();
  });
});

describe("widgetFileRefs", () => {
  const blk = (file: string) => `{"widget": "a/b@1", "state": {"file": ${JSON.stringify(file)}}}`;
  it("펜스 둘·목록 안 들여쓴 펜스 → 문서 순서, 중복 없음", () => {
    const c = [
      "# 제목",
      "```keyring-widget",
      blk("x/a.excalidraw.json"),
      "```",
      "~~~keyring-widget",
      blk("x/b.excalidraw.json"),
      "~~~",
      "- 항목",
      "  ```keyring-widget",
      "  " + blk("x/c.excalidraw.json"),
      "  ```",
      "```keyring-widget",
      blk("x/a.excalidraw.json"),
      "```",
    ].join("\n");
    expect(widgetFileRefs(c)).toEqual(["x/a.excalidraw.json", "x/b.excalidraw.json", "x/c.excalidraw.json"]);
  });
  it("여러 줄 블록", () => {
    const c = '```keyring-widget\n{\n  "widget": "a/b@1",\n  "state": {"file": "x/a.json"}\n}\n```\n';
    expect(widgetFileRefs(c)).toEqual(["x/a.json"]);
  });
  it("다른 펜스·닫히지 않음·깨진 JSON·정규형 아님·프런트매터 안 → 없음", () => {
    expect(widgetFileRefs("```json\n" + blk("x/a.json") + "\n```\n")).toEqual([]);
    expect(widgetFileRefs("```keyring-widget\n" + blk("x/a.json") + "\n")).toEqual([]);
    expect(widgetFileRefs('```keyring-widget\n{"widget": "a/b@1", "state": {"file": "x/a.json"}\n```\n')).toEqual([]);
    expect(widgetFileRefs("```keyring-widget\n" + blk("../a.json") + "\n```\n")).toEqual([]);
    expect(widgetFileRefs("---\nx: |\n  ```keyring-widget\n  " + blk("x/a.json") + "\n  ```\n---\n본문\n")).toEqual([]);
  });
  it("JSON 이스케이프로 쓴 경로는 풀린 값", () => {
    const body = String.raw`{"widget": "a/b@1", "state": {"file": "\uc2a4\ucf00\uce58.excalidraw.json"}}`;
    expect(widgetFileRefs("```keyring-widget\n" + body + "\n```\n")).toEqual(["스케치.excalidraw.json"]);
  });
});

describe("rewriteWidgetFileRefs", () => {
  const FROM = "x/a.excalidraw.json";
  const TO = "y/b c.excalidraw.json";
  it("그 문자열만 바꾸고 줄·들여쓰기 그대로", () => {
    const body = '{\n  "widget": "a/b@1",\n  "state": {"file": "x/a.excalidraw.json", "n": 1}\n}';
    expect(rewriteWidgetFileRefs(body, FROM, TO)).toEqual({
      body: '{\n  "widget": "a/b@1",\n  "state": {"file": "y/b c.excalidraw.json", "n": 1}\n}',
      count: 1,
    });
  });
  it("이스케이프로 쓴 같은 값도 바꾼다", () => {
    const body = String.raw`{"widget": "a/b@1", "state": {"file": "x/\u0061.excalidraw.json"}}`;
    expect(rewriteWidgetFileRefs(body, FROM, TO)).toEqual({ body: '{"widget": "a/b@1", "state": {"file": "y/b c.excalidraw.json"}}', count: 1 });
  });
  it("state.file 이 from 이 아니면 모르는 키에 있어도 null", () => {
    const body = '{"widget": "a/b@1", "state": {"file": "z.excalidraw.json"}, "x": {"file": "x/a.excalidraw.json"}}';
    expect(rewriteWidgetFileRefs(body, FROM, TO)).toBeNull();
  });
  it("state.file 이 from 이면 모르는 키의 같은 값도 바꾸고 count 1", () => {
    const body = '{"widget": "a/b@1", "state": {"file": "x/a.excalidraw.json"}, "x": {"file": "x/a.excalidraw.json"}}';
    expect(rewriteWidgetFileRefs(body, FROM, TO)).toEqual({
      body: '{"widget": "a/b@1", "state": {"file": "y/b c.excalidraw.json"}, "x": {"file": "y/b c.excalidraw.json"}}',
      count: 1,
    });
  });
  it("깨진 JSON → null", () => {
    expect(rewriteWidgetFileRefs('{"widget": "a/b@1", "state": {"file": "x/a.excalidraw.json"}', FROM, TO)).toBeNull();
  });
});
