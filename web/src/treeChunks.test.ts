import { describe, expect, it } from "vitest";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { matchChunks, topChunks, type TopChunk } from "./treeChunks";

/** 끝까지 파싱한 상태(처음 상태는 앞 3,000 자만 파싱한다 — 더 시킨 뒤 빈 트랜잭션으로 그 트리를 받는다) */
function md(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, doc.length, 5000);
  return s.update({}).state;
}

describe("최상위 덩어리", () => {
  it("겹치지 않고 문서 순서이며, 최상위 노드가 모두 어느 덩어리 안에 든다", () => {
    const doc = Array.from({ length: 300 }, (_, i) => `## 제목 ${i}\n\n글 ${i}\n\n- a\n- b`).join("\n\n");
    const s = md(doc);
    const chunks = topChunks(syntaxTree(s));
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.from).toBeGreaterThanOrEqual(chunks[i - 1]!.to);
    const c = syntaxTree(s).cursor();
    c.firstChild();
    let n = 0;
    do {
      expect(chunks.some((k) => k.from <= c.from && c.to <= k.to)).toBe(true);
      n++;
    } while (c.nextSibling());
    expect(n).toBe(900);
  });

  it("가운데 한 글자를 고치면 그 덩어리(와 파서가 늘 다시 만드는 문서 끝)만 다시 쓰이지 않는다", () => {
    const doc = Array.from({ length: 400 }, (_, i) => `글 ${i}\n\n\`\`\`js\nv${i}\n\`\`\``).join("\n\n");
    const s = md(doc);
    const at = doc.indexOf("글 200") + 2;
    const tr = s.update({ changes: { from: at, insert: "x" } });
    const prev = topChunks(syntaxTree(s));
    const next = topChunks(syntaxTree(tr.state));
    const match = matchChunks(prev, next, tr.changes, s.doc);
    const unmatched = [...match.keys()].filter((j) => match[j]! < 0);
    expect(unmatched.length).toBeLessThanOrEqual(3);
    expect(unmatched.some((j) => next[j]!.from <= at && at <= next[j]!.to)).toBe(true);
  });
});

describe("덩어리 짝 맞추기", () => {
  // 손으로 만든 덩어리 — 파서가 무엇을 다시 쓰든 계약만 본다
  const doc = Text.of(["aaaa", "  bbbb", "cccc", "dddd"]); // 줄 처음: 0, 5, 12, 17
  const A = { name: "A" };
  const B = { name: "B" };
  const C = { name: "C" };
  const prev: TopChunk[] = [
    { node: A, from: 0, to: 4 },
    { node: B, from: 7, to: 11 }, // 들여쓴 줄의 글자 부분만
    { node: C, from: 17, to: 21 },
  ];

  it("같은 객체·같은 자리(옮긴 뒤)·걸친 줄을 안 고쳤으면 짝이다", () => {
    const changes = ChangeSet.of({ from: 14, insert: "xx" }, doc.length); // cccc 안
    const next = [prev[0]!, prev[1]!, { node: C, from: 19, to: 23 }];
    expect([...matchChunks(prev, next, changes, doc)]).toEqual([0, 1, 2]);
  });

  it("자리가 같아도 다른 객체면 짝이 아니다", () => {
    const changes = ChangeSet.empty(doc.length);
    const next = [prev[0]!, { node: { name: "B'" }, from: 7, to: 11 }, prev[2]!];
    expect([...matchChunks(prev, next, changes, doc)]).toEqual([0, -1, 2]);
  });

  it("같은 객체여도 덩어리가 걸친 줄의 덩어리 밖(들여쓰기·줄 끝)을 고쳤으면 짝이 아니다", () => {
    const indent = ChangeSet.of({ from: 5, to: 6 }, doc.length); // "  bbbb" → " bbbb"
    expect([...matchChunks(prev, [prev[0]!, { node: B, from: 6, to: 10 }, { node: C, from: 16, to: 20 }], indent, doc)]).toEqual([0, -1, 2]);
    const tail = ChangeSet.of({ from: 4, insert: "!" }, doc.length); // aaaa 끝 뒤
    expect([...matchChunks(prev, [prev[0]!, { node: B, from: 8, to: 12 }, { node: C, from: 18, to: 22 }], tail, doc)]).toEqual([-1, 1, 2]);
  });

  it("지운 범위에 든 덩어리는 짝이 없고, 그 뒤 덩어리는 옮긴 자리로 짝을 찾는다", () => {
    const changes = ChangeSet.of({ from: 5, to: 12 }, doc.length); // 둘째 줄을 지운다
    expect([...matchChunks(prev, [prev[0]!, { node: B, from: 5, to: 5 }, { node: C, from: 10, to: 14 }], changes, doc)]).toEqual([0, -1, 2]);
    // 지운 범위가 줄 처음에서 끝나면 그 줄도 고친 줄로 본다(안전한 쪽으로 — 다시 볼 뿐이다)
    const joined = ChangeSet.of({ from: 5, to: 17 }, doc.length);
    expect([...matchChunks(prev, [prev[0]!, { node: C, from: 5, to: 9 }], joined, doc)]).toEqual([0, -1]);
  });
});
