import { describe, expect, it } from "vitest";
import { chainMoves, rewriteLinks, type LinkRewriteContext } from "../src/index.js";

/** files: 이동 전 경로 목록, moves: [from, to] */
function ctx(files: string[], moves: [string, string][], fullPaths = false): LinkRewriteContext {
  const m = chainMoves(moves);
  const after = files.filter((f) => !m.has(f)).concat([...m.values()]);
  return { moves: m, before: files, after, fullPaths };
}

const rw = (content: string, c: LinkRewriteContext, path = "노트.md", oldPath = path) => rewriteLinks(content, oldPath, path, c)?.content ?? null;

describe("링크 자동 갱신", () => {
  const files = ["노트.md", "업무/계획.md", "업무/회의록.md", "그림.png"];

  it("최단 이름·전체 경로·.md 유지", () => {
    const c = ctx(files, [["업무/계획.md", "보관/2026 계획.md"]]);
    expect(rw("[[계획]] 그리고 [[업무/계획]] [[계획.md]]", c)).toBe("[[2026 계획]] 그리고 [[보관/2026 계획]] [[2026 계획.md]]");
  });

  it("#제목·#^블록·|별칭·임베드는 그대로 둔다", () => {
    const c = ctx(files, [["업무/계획.md", "보관/새계획.md"]]);
    expect(rw("[[계획#일정|일정 보기]] ![[계획#^abc]] [[계획|별칭]]", c)).toBe("[[새계획#일정|일정 보기]] ![[새계획#^abc]] [[새계획|별칭]]");
  });

  it("같은 이름이 있으면 해석이 맞는 만큼 경로를 붙인다", () => {
    const c = ctx([...files, "다른/새계획.md"], [["업무/계획.md", "보관/새계획.md"]]);
    expect(rw("[[계획]]", c)).toBe("[[보관/새계획]]");
  });

  it("fullPaths면 늘 전체 경로", () => {
    const c = ctx(files, [["업무/계획.md", "보관/새계획.md"]], true);
    expect(rw("[[계획]]", c)).toBe("[[보관/새계획]]");
  });

  it("가로채기: 이동한 문서가 더 얕은 같은 이름이 되면 원래 대상을 가리키게 고친다", () => {
    // [[회의록]]은 업무/회의록.md를 가리키다가, 다른 문서가 최상위 회의록.md로 오면 그쪽으로 해석된다
    const c = ctx([...files, "옛/메모.md"], [["옛/메모.md", "회의록.md"]]);
    expect(rw("[[회의록]] 참고", c)).toBe("[[업무/회의록]] 참고");
  });

  it("관련 없는 링크·깨진 링크·코드 블록·인라인 코드는 그대로", () => {
    const c = ctx(files, [["업무/계획.md", "보관/새계획.md"]]);
    expect(rw("[[회의록]] [[없는문서]]", c)).toBeNull();
    expect(rw("```\n[[계획]]\n```\n`[[계획]]` 과 [[계획]]", c)).toBe("```\n[[계획]]\n```\n`[[계획]]` 과 [[새계획]]");
  });

  it("같은 일괄 쓰기에서 지워진 대상은 건드리지 않는다", () => {
    const c: LinkRewriteContext = { moves: new Map([["업무/계획.md", "보관/새계획.md"]]), before: files, after: ["노트.md", "업무/회의록.md"] };
    expect(rw("[[계획]]", c)).toBeNull();
  });

  it("프런트매터 sources: 목록·인라인·흐름 목록, [[ ]]와 경로 값", () => {
    const c = ctx(files, [["업무/계획.md", "보관/새계획.md"]]);
    const doc = [
      "---",
      "title: 노트",
      "sources:",
      '  - "[[계획|계획서]]"',
      "  - 업무/계획.md",
      "  - https://example.com/계획",
      "related: [[계획]]",
      "---",
      "본문",
    ].join("\n");
    expect(rw(doc, c)).toBe(doc.replace('"[[계획|계획서]]"', '"[[새계획|계획서]]"').replace("  - 업무/계획.md", "  - 보관/새계획.md"));
    expect(rw("---\nsource: 업무/계획\n---\n", c)).toBe("---\nsource: 보관/새계획\n---\n");
    expect(rw('---\nsources: ["[[계획]]", 업무/계획.md]\n---\n', c)).toBe('---\nsources: ["[[새계획]]", 보관/새계획.md]\n---\n');
  });

  it("상대 경로 마크다운 링크: 다른 문서 쪽", () => {
    const c = ctx(files, [["업무/계획.md", "보관/2026 계획.md"]]);
    expect(rw("[계획](업무/계획.md) ![](그림.png) [밖](https://x.y/업무/계획.md) [앵커](#제목)", c)).toBe(
      "[계획](보관/2026%20계획.md) ![](그림.png) [밖](https://x.y/업무/계획.md) [앵커](#제목)",
    );
    expect(rw("[계획](<업무/계획.md#일정>)", c)).toBe("[계획](<보관/2026 계획.md#일정>)");
    expect(rw("[회의](업무/회의록.md)", c, "노트.md")).toBeNull();
    // 같은 폴더의 다른 문서에서
    expect(rw("[계획](계획.md \"제목\")", c, "업무/회의록.md")).toBe('[계획](../보관/2026%20계획.md "제목")');
  });

  it("이동한 문서 자신의 상대 링크를 새 위치 기준으로 다시 계산한다", () => {
    const c = ctx(files, [["업무/계획.md", "보관/깊이/계획.md"]]);
    const own = "[회의](회의록.md) ![](../그림.png) [[회의록]]";
    expect(rewriteLinks(own, "업무/계획.md", "보관/깊이/계획.md", c)?.content).toBe("[회의](../../업무/회의록.md) ![](../../그림.png) [[회의록]]");
  });

  it("인코딩된 경로·괄호", () => {
    const c = ctx([...files, "a (1).md"], [["a (1).md", "b (2).md"]]);
    expect(rw("[x](a%20%281%29.md)", c)).toBe("[x](b%20%282%29.md)");
  });

  it("연쇄 이동을 합친다", () => {
    expect([...chainMoves([["a.md", "b.md"], ["b.md", "c.md"], ["x.md", "y.md"]])]).toEqual([["a.md", "c.md"], ["x.md", "y.md"]]);
    const c = ctx(["a.md", "n.md"], [["a.md", "b.md"], ["b.md", "c.md"]]);
    expect(rw("[[a]]", c, "n.md")).toBe("[[c]]");
  });

  it("고친 링크 수를 센다", () => {
    const c = ctx(files, [["업무/계획.md", "보관/새계획.md"]]);
    expect(rewriteLinks("[[계획]] [[계획]] [x](업무/계획.md)", "노트.md", "노트.md", c)?.count).toBe(3);
  });
});

import { analyze, stripComments, wikilinkTargets } from "../src/index.js";

describe("주석 %%…%%", () => {
  it("한 줄·여러 줄 주석을 지우고 줄 수는 그대로, 코드 안은 그대로", () => {
    const doc = "앞 %%숨김 [[a]]%% 뒤\n%%\n여러 줄 #태그\n- [ ] 숨은 할 일\n%%\n`%%코드%%`\n```\n%%펜스%%\n```\n보임 [[b]] #보임";
    const out = stripComments(doc);
    expect(out.split("\n").length).toBe(doc.split("\n").length);
    expect(out).toContain("앞  뒤");
    expect(out).toContain("`%%코드%%`");
    expect(out).toContain("%%펜스%%");
    expect(out).not.toContain("숨김");
    expect(wikilinkTargets(doc)).toEqual(["b"]);
    const a = analyze("x.md", doc);
    expect(a.tags).toEqual(["보임"]);
    expect(a.tasks).toEqual([]);
    expect(a.links).toEqual(["b"]);
  });
});
