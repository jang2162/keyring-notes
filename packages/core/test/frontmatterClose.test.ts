import { describe, expect, it } from "vitest";
import { parseFrontmatter, replaceSettingsObject, setFrontmatterField, setVaultSetting, stampEdited, withoutEdited } from "../src/index.js";

const STAMP = "2026-11-13T00:00:00Z";

/** 프런트매터 블록과 본문의 경계가 걸린 문서들. data 는 읽은 값, body 는 블록 뒤에 남아야 하는 글 */
const CASES: { name: string; doc: string; data: Record<string, unknown> | null; body: string }[] = [
  {
    name: "값이 ... 로 끝남",
    doc: "---\ntitle: 생각 중...\ntags: [a, b]\nrank: m\n---\n본문\n",
    data: { title: "생각 중...", tags: ["a", "b"], rank: "m" },
    body: "본문\n",
  },
  {
    name: "값이 --- 로 끝남",
    doc: "---\ntitle: 끝---\ntags: [a, b]\nrank: m\n---\n본문\n",
    data: { title: "끝---", tags: ["a", "b"], rank: "m" },
    body: "본문\n",
  },
  {
    name: "값이 --- 와 뒤 공백으로 끝남",
    doc: "---\ntitle: 끝 --- \nrank: m\n---\n본문\n",
    data: { title: "끝 ---", rank: "m" },
    body: "본문\n",
  },
  {
    name: "값 중간에 --- 가 있음",
    doc: "---\ntitle: 앞 --- 뒤\nrank: m\n---\n본문\n",
    data: { title: "앞 --- 뒤", rank: "m" },
    body: "본문\n",
  },
  {
    name: "들여쓴 --- 줄(여러 줄 값의 일부)",
    doc: "---\nnote: |\n  위\n  ---\n  아래\nrank: m\n---\n본문\n",
    data: { note: "위\n---\n아래\n", rank: "m" },
    body: "본문\n",
  },
  { name: "빈 프런트매터", doc: "---\n---\n본문\n", data: {}, body: "본문\n" },
  {
    name: "CRLF 에 값이 ... 로 끝남",
    doc: "---\r\ntitle: 생각 중...\r\nrank: m\r\n---\r\n본문\r\n",
    data: { title: "생각 중...", rank: "m" },
    body: "본문\r\n",
  },
  { name: "닫는 줄이 ...", doc: "---\ntitle: x\nrank: m\n...\n본문\n", data: { title: "x", rank: "m" }, body: "본문\n" },
  { name: "닫는 줄 뒤 공백", doc: "---\ntitle: x\nrank: m\n--- \t\n본문\n", data: { title: "x", rank: "m" }, body: "본문\n" },
  { name: "닫는 줄이 글의 끝", doc: "---\ntitle: x\nrank: m\n---", data: { title: "x", rank: "m" }, body: "" },
  { name: "BOM 뒤 프런트매터", doc: "\uFEFF---\ntitle: 생각 중...\nrank: m\n---\n본문\n", data: { title: "생각 중...", rank: "m" }, body: "본문\n" },
  { name: "프런트매터 없음", doc: "# 글\n\n본문 ---\n...\n", data: null, body: "# 글\n\n본문 ---\n...\n" },
  { name: "닫는 줄이 없음", doc: "---\ntitle: 생각 중...\n본문\n", data: null, body: "---\ntitle: 생각 중...\n본문\n" },
];

/** 편집 결과: 본문이 그대로 뒤에 붙어 있고, 다시 읽으면 원래 키에 바꾼 것만 달라져 있다 */
function expectEdited(out: string, c: (typeof CASES)[number], changed: Record<string, unknown>, removed: string[] = []) {
  expect(out.endsWith(c.body)).toBe(true);
  const want: Record<string, unknown> = { ...c.data, ...changed };
  for (const k of removed) delete want[k];
  const head = out.slice(0, out.length - c.body.length);
  if (Object.keys(want).length === 0 && head === "") return; // 마지막 키를 지우면 블록째 없어진다
  expect(parseFrontmatter(out).data).toEqual(want);
  // 블록 뒤가 정확히 본문이다 — 블록이 일찍 닫혀 뒤 속성이 본문으로 밀려나지 않았다
  expect(out.split("\n").slice(parseFrontmatter(out).lines).join("\n")).toBe(c.body);
}

describe("프런트매터의 닫는 구분선 — 줄 전체가 --- 나 ... 일 때만", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it("읽기", () => {
        const fm = parseFrontmatter(c.doc);
        expect(fm.data).toEqual(c.data);
        expect(fm.error).toBeUndefined();
        expect(c.doc.split("\n").slice(fm.lines).join("\n")).toBe(c.body);
      });
      it("필드 더하기", () => expectEdited(setFrontmatterField(c.doc, "icon", "x"), c, { icon: "x" }));
      it("필드 바꾸기", () => expectEdited(setFrontmatterField(c.doc, "rank", "z"), c, { rank: "z" }));
      it("필드 지우기", () => expectEdited(setFrontmatterField(c.doc, "rank", null), c, {}, ["rank"]));
      it("공통 설정 키 쓰기", () => {
        // 설정 편집은 BOM 을 다루지 않는다(설정 파일은 앱이 쓴다)
        if (c.doc.startsWith("\uFEFF")) return;
        expectEdited(setVaultSetting(c.doc, ["daily", "folder"], "일기"), c, { daily: { folder: "일기" } });
        expectEdited(setVaultSetting(c.doc, ["rank"], null), c, {}, ["rank"]);
      });
      it("설정 객체 바꿔 쓰기", () => {
        if (c.doc.startsWith("\uFEFF")) return;
        const out = replaceSettingsObject(c.doc, { a: 1 });
        expect(out.endsWith(c.body)).toBe(true);
        expect(out.slice(0, out.length - c.body.length)).toBe("---\na: 1\n---\n");
      });
      it("수정 시각 적기·빼기", () => {
        const out = stampEdited("a.md", c.doc, STAMP);
        expectEdited(out, c, { edited: STAMP });
        // 시각만으로 만든 블록은 뺄 때 블록째 없어진다
        expect(withoutEdited(out)).toBe(c.data && Object.keys(c.data).length === 0 ? c.body : c.doc);
      });
    });
  }

  it("값 끝의 ... 뒤 속성이 본문으로 밀려나지 않는다(글자 그대로)", () => {
    const doc = "---\ntitle: 생각 중...\ntags: [a, b]\nrank: m\n---\n본문\n";
    expect(setFrontmatterField(doc, "icon", "x")).toBe("---\ntitle: 생각 중...\ntags: [a, b]\nrank: m\nicon: x\n---\n본문\n");
    expect(setFrontmatterField(doc, "rank", null)).toBe("---\ntitle: 생각 중...\ntags: [a, b]\n---\n본문\n");
  });

  it("공통 설정 파일의 뒤 키가 본문으로 밀려나지 않는다(글자 그대로)", () => {
    const doc = "---\nkeyring: settings\ndaily:\n  format: 오늘...\ntheme: dark\n---\n설명\n";
    expect(setVaultSetting(doc, ["lang"], "ko")).toBe("---\nkeyring: settings\ndaily:\n  format: 오늘...\ntheme: dark\nlang: ko\n---\n설명\n");
  });
});
