import { describe, expect, it } from "vitest";
import { linkMentions, LocalVault, MemoryStore, mentionNames, unlinkedMentions, withoutEdited } from "../src/index.js";

describe("연결되지 않은 언급", () => {
  it("이름(파일·title·aliases)을 찾되 링크·코드·주석·프런트매터 안은 뺀다", () => {
    const names = mentionNames("경제/기준금리.md", { title: "기준 금리", aliases: ["policy rate", "금리"] });
    expect(names).toEqual(["policy rate", "기준 금리", "기준금리", "금리"]);
    const doc = [
      "---",
      "title: 기준금리 메모",
      "---",
      "오늘 기준금리는 동결. [[기준금리]] 참고, `기준금리` 코드.",
      "%%기준금리%% 주석, [기준금리](x.md) 링크",
      "Policy rate rose. policy rates? 금리가 올랐다",
      "```",
      "기준금리",
      "```",
    ].join("\n");
    const ms = unlinkedMentions(doc, names);
    expect(ms.map((m) => [m.line, m.text])).toEqual([
      [4, "기준금리"],
      [6, "Policy rate"],
      [6, "금리"],
    ]);
  });

  it("언급을 링크로: 같은 글자면 [[이름]], 다르면 [[이름|글자]]", () => {
    const doc = "기준금리와 Policy rate, 그리고 기준금리.";
    const ms = unlinkedMentions(doc, ["기준금리", "policy rate"]);
    expect(linkMentions(doc, ms, "기준금리")).toBe("[[기준금리]]와 [[기준금리|Policy rate]], 그리고 [[기준금리]].");
    // 그 사이 바뀐 자리는 건너뛴다
    expect(linkMentions("바뀐 글", ms, "기준금리")).toBe("바뀐 글");
  });
});

describe("연결되지 않은 언급(로컬 볼트)", () => {
  it("다른 문서에서 찾고, 링크로 바꾸면 사라진다", async () => {
    const store = new MemoryStore();
    const v = new LocalVault(store);
    await v.open();
    await v.write("경제/기준금리.md", "# 기준금리\n", null);
    const note = await v.write("일기/오늘.md", "기준금리 동결\n", null);
    await v.write("일기/무관.md", "날씨\n", null);
    const r = await v.mentions("경제/기준금리.md");
    expect(r.docs.map((d) => [d.path, d.mentions.length])).toEqual([["일기/오늘.md", 1]]);
    await v.write("일기/오늘.md", linkMentions(note.content, r.docs[0].mentions, "기준금리"), r.docs[0].hash);
    // 저장하면 수정 시각(edited)이 함께 적힌다 — 본문만 본다
    expect(withoutEdited((await v.read("일기/오늘.md")).content)).toBe("[[기준금리]] 동결\n");
    expect((await v.mentions("경제/기준금리.md")).docs).toEqual([]);
  });
});
