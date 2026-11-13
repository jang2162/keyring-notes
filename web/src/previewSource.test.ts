import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  previewFoldSource,
  previewPlan,
  previewStep,
  previewTaskToggle,
  previewWidgetWrite,
  previewWrote,
  sameLineLayout,
  type PreviewPlan,
  type PreviewState,
} from "./previewSource";

function edState(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, doc.length, 5000);
  return s;
}
const apply = (s: EditorState, spec: ReturnType<typeof previewTaskToggle>) => (spec ? s.update(spec).state.doc.toString() : null);

describe("낡은 미리보기의 줄 대응", () => {
  const drawn = "# 할 일\n\n- [ ] one\n- [ ] two\n- [ ] three\n";
  it("체크 토글·한 줄 안 입력은 줄 대응이 같다 — 누름을 살린다", () => {
    expect(sameLineLayout(drawn, drawn.replace("[ ] one", "[x] one"))).toBe(true);
    expect(sameLineLayout(drawn, drawn.replace("[ ] one", "[x] one").replace("[ ] two", "[x] two"))).toBe(true);
    expect(sameLineLayout(drawn, drawn.replace("# 할 일", "# 오늘 할 일"))).toBe(true);
  });

  it("줄을 더하거나 지우면 줄 대응이 다르다 — 맞춘다", () => {
    expect(sameLineLayout(drawn, drawn.replace("# 할 일\n", "# 할 일\n\n새 줄\n"))).toBe(false);
    expect(sameLineLayout(drawn, drawn.replace("- [ ] two\n", ""))).toBe(false);
  });
});

describe("미리보기에서 쓰는 쪽의 검증", () => {
  it("체크박스: 그린 때의 줄과 같으면(체크 상태만 달라도) 바꾼다", () => {
    const s = edState("- [x] one\n- [ ] two");
    expect(apply(s, previewTaskToggle(s, 2, true, "- [ ] two"))).toBe("- [x] one\n- [x] two");
    expect(apply(s, previewTaskToggle(s, 1, false, "- [ ] one"))).toBe("- [ ] one\n- [ ] two");
  });

  it("체크박스: 그 줄이 그린 때와 다르면 쓰지 않는다(줄이 밀린 낡은 미리보기)", () => {
    const s = edState("- [ ] inserted\n- [ ] one\n- [ ] two");
    expect(previewTaskToggle(s, 1, true, "- [ ] one")).toBeNull();
    expect(previewTaskToggle(s, 9, true, "- [ ] one")).toBeNull();
  });

  it("위젯: 같은 위젯(id·데이터 파일)이면 상태를 쓰고, 다른 위젯 블록이면 쓰지 않는다", () => {
    const dday = '{"widget": "keyring/dday@1", "state": {"label": "A"}}';
    const other = '{"widget": "keyring/excalidraw@1", "state": {"file": "a.excalidraw.json"}}';
    const s = edState("```keyring-widget\n" + dday + "\n```\n\n```keyring-widget\n" + other + "\n```\n");
    const ok = previewWidgetWrite(s, 1, { label: "B" }, 1, '{"widget": "keyring/dday@1", "state": {"label": "옛"}}');
    expect(ok && s.update(ok).state.doc.toString()).toContain('"label": "B"');
    expect(previewWidgetWrite(s, 5, { label: "B" }, 1, dday)).toBeNull();
    expect(previewWidgetWrite(s, 5, {}, 1, '{"widget": "keyring/excalidraw@1", "state": {"file": "b.excalidraw.json"}}')).toBeNull();
  });
});

describe("미리보기 접기의 줄 번호", () => {
  it("나란히 보기에서 낡은 동안은 그린 본문으로 푼다, 그리지 않는 칸은 초안", () => {
    expect(previewFoldSource("# 옛\n\n## A", "# 옛\n\n새 줄\n\n## A")).toBe("# 옛\n\n## A");
    expect(previewFoldSource(null, "초안")).toBe("초안");
  });
});

/** 렌더를 차례로 돌린다: [계획, 문서, 본문] 마다 그린 본문(null = 안 그림)과 나중에 다시 그려야 하는가 */
function run(steps: [PreviewPlan, string, string][], start: PreviewState = { plan: "skip", key: "a", text: "" }) {
  let st = start;
  return steps.map(([plan, key, source]) => {
    const r = previewStep(st, plan, key, source);
    st = r.state;
    return [r.text, r.settleLater] as const;
  });
}

describe("미리보기 계획", () => {
  it("편집만 보이면 그리지 않고, 나란히 보기는 멈춘 뒤, 미리보기·과거 판은 바로", () => {
    expect(previewPlan("edit", false)).toBe("skip");
    expect(previewPlan("split", false)).toBe("settle");
    expect(previewPlan("preview", false)).toBe("now");
    expect(previewPlan("edit", true)).toBe("now");
    expect(previewPlan("split", true)).toBe("now");
  });
});

describe("previewStep", () => {
  it("편집 전용 칸은 본문이 바뀌어도 그리지 않는다", () => {
    expect(
      run([
        ["skip", "a", "1"],
        ["skip", "a", "12"],
        ["skip", "a", "123"],
      ]),
    ).toEqual([
      [null, false],
      [null, false],
      [null, false],
    ]);
  });

  it("편집 → 나란히·미리보기로 바꾼 직후는 최신 본문을 바로 그린다", () => {
    expect(
      run([
        ["skip", "a", "1"],
        ["skip", "a", "12"],
        ["settle", "a", "12"],
      ]),
    ).toEqual([
      [null, false],
      [null, false],
      ["12", false],
    ]);
    expect(
      run([
        ["skip", "a", "12"],
        ["now", "a", "12"],
      ]),
    ).toEqual([
      [null, false],
      ["12", false],
    ]);
  });

  it("나란히 보기: 치는 동안은 그린 본문을 두고 다시 그릴 일만 남긴다, 멈추면(같은 본문) 남길 일이 없다", () => {
    const start: PreviewState = { plan: "settle", key: "a", text: "1" };
    expect(
      run(
        [
          ["settle", "a", "12"],
          ["settle", "a", "123"],
        ],
        start,
      ),
    ).toEqual([
      ["1", true],
      ["1", true],
    ]);
    expect(run([["settle", "a", "1"]], start)).toEqual([["1", false]]);
  });

  it("나란히 보기에서 다른 문서(키)가 오면 기다리지 않는다", () => {
    expect(run([["settle", "b", "다른 문서"]], { plan: "settle", key: "a", text: "옛" })).toEqual([["다른 문서", false]]);
  });

  it("나란히 → 편집 → 나란히: 그 사이 바뀐 본문을 바로 그린다", () => {
    expect(
      run([
        ["settle", "a", "1"],
        ["skip", "a", "12"],
        ["skip", "a", "123"],
        ["settle", "a", "123"],
      ]),
    ).toEqual([
      ["1", false],
      [null, false],
      [null, false],
      ["123", false],
    ]);
  });

  it("나란히 보기: 미리보기에서 시작한 쓰기가 줄 수를 바꾸면 그 쓰기가 낸 본문을 기다리지 않고 그린다, 그 뒤 치는 글은 다시 기다린다", () => {
    // 위젯이 한 줄 JSON 을 여러 줄로 펴면 줄 수가 바뀐다 — 기다리면 그사이 미리보기 누름이 맞추느라 무시된다
    const drawn = '```keyring-widget\n{"label": "A"}\n```\n- [ ] one';
    const written = '```keyring-widget\n{\n  "label": "B"\n}\n```\n- [ ] one';
    const wrote = previewWrote({ plan: "settle", key: "a", text: drawn });
    // 쓰기가 낸 초안이 아직 오지 않은 렌더(같은 본문)는 그대로
    expect(run([["settle", "a", drawn]], wrote)).toEqual([[drawn, false]]);
    expect(
      run(
        [
          ["settle", "a", written],
          ["settle", "a", written + "x"],
        ],
        wrote,
      ),
    ).toEqual([
      [written, false],
      [written, true],
    ]);
  });

  it("나란히 보기: 줄 수가 같은 쓰기(체크 토글)는 기다린다 — 표시는 내리고, 그 뒤 줄이 바뀌어도 바로 그리지 않는다", () => {
    // 줄 수가 같으면 다음 누름이 그대로 산다. 바로 그리면 큰 문서에서 전체 렌더가 누름에 붙어 체크 표시가 늦다
    const drawn = "# T\n- [ ] one\n- [ ] two";
    const toggled = "# T\n- [x] one\n- [ ] two";
    expect(
      run(
        [
          ["settle", "a", toggled],
          ["settle", "a", toggled + "\nnew line"],
        ],
        previewWrote({ plan: "settle", key: "a", text: drawn }),
      ),
    ).toEqual([
      [drawn, true],
      [drawn, true],
    ]);
  });

  it("쓰기 표시는 나란히 보기에서만 남는다 — 편집 전용 칸은 여전히 그리지 않는다", () => {
    const skip: PreviewState = { plan: "skip", key: "a", text: "" };
    expect(previewWrote(skip)).toBe(skip);
    expect(run([["skip", "a", "12"]], previewWrote(skip))).toEqual([[null, false]]);
  });

  it("미리보기만 보이는 칸은 늘 지금 본문", () => {
    expect(
      run([
        ["now", "a", "1"],
        ["now", "a", "12"],
      ]),
    ).toEqual([
      ["1", false],
      ["12", false],
    ]);
  });
});
