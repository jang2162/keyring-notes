import { describe, expect, it } from "vitest";
import { alignEdited, EDITED_FIELD, editedOf, editedStamp, merge3, parseFrontmatter, stampEdited, withoutEdited } from "../src/index.js";

const T = "2026-10-30T09:12:33Z";

describe("editedStamp", () => {
  it("초 단위 UTC, Z 로 끝난다", () => {
    expect(editedStamp(new Date("2026-10-30T09:12:33.456Z"))).toBe(T);
  });
});

describe("stampEdited", () => {
  it("프런트매터가 없으면 만들어 적는다", () => {
    expect(stampEdited("A.md", "# 제목\n본문", T)).toBe(`---\nedited: ${T}\n---\n# 제목\n본문`);
  });

  it("다른 필드와 그 순서는 그대로 두고 edited 만 바꾼다", () => {
    const src = "---\nicon: 📁\ntags: [a, b]\nedited: 2026-01-01T00:00:00Z\n---\n본문";
    expect(stampEdited("A.md", src, T)).toBe(`---\nicon: 📁\ntags: [a, b]\nedited: ${T}\n---\n본문`);
  });

  it("사용자의 YAML 모양(들여쓰지 않은 목록·[a,b]·주석 앞 공백·빈 줄)은 그대로 두고 edited 한 줄만 더한다", () => {
    const src = "---\ntags:\n- a\n- b\nx:   1   # 메모\ny: [a,b]\n\nz: 2\n---\n본문\n";
    expect(stampEdited("A.md", src, T)).toBe(`---\ntags:\n- a\n- b\nx:   1   # 메모\ny: [a,b]\n\nz: 2\nedited: ${T}\n---\n본문\n`);
  });

  it("edited 줄이 있으면 그 자리의 값만 바꾼다(뒤 주석은 남긴다)", () => {
    const src = "---\na: [x,y]\nedited: 2026-01-01T00:00:00Z   # 앱이 적음\nb:  2\n---\n본문";
    expect(stampEdited("A.md", src, T)).toBe(`---\na: [x,y]\nedited: ${T}   # 앱이 적음\nb:  2\n---\n본문`);
  });

  it("CRLF 노트는 CRLF 로 적는다", () => {
    expect(stampEdited("A.md", "---\r\ntitle: a\r\n---\r\n본문\r\n", T)).toBe(`---\r\ntitle: a\r\nedited: ${T}\r\n---\r\n본문\r\n`);
    expect(stampEdited("A.md", "# 제목\r\n본문\r\n", T)).toBe(`---\r\nedited: ${T}\r\n---\r\n# 제목\r\n본문\r\n`);
    const crlf = `---\r\nedited: 2026-01-01T00:00:00Z\r\n---\r\n본문\r\n`;
    expect(stampEdited("A.md", crlf, T)).toBe(`---\r\nedited: ${T}\r\n---\r\n본문\r\n`);
  });

  it("BOM 으로 시작하는 노트는 BOM 을 지키고 프런트매터를 하나로 둔다", () => {
    expect(stampEdited("A.md", "\uFEFF---\ntitle: 제목\n---\n본문\n", T)).toBe(`\uFEFF---\ntitle: 제목\nedited: ${T}\n---\n본문\n`);
    expect(stampEdited("A.md", "\uFEFF본문", T)).toBe(`\uFEFF---\nedited: ${T}\n---\n본문`);
  });

  it("여러 줄 값처럼 한 줄로 바꿀 수 없는 edited 도 시각으로 바꾼다", () => {
    const out = stampEdited("A.md", "---\nedited:\n  - x\nk: 1\n---\n본문", T);
    expect(parseFrontmatter(out).data).toEqual({ edited: T, k: 1 });
  });

  it("줄로 고칠 수 없는 모양(따옴표 친 키)이어도 YAML 이 깨지지 않고 새 시각이 읽힌다", () => {
    const src = '---\n"edited": 2026-01-01T00:00:00Z\ntitle: 제목\ntags: [a]\n---\n본문';
    const out = stampEdited("A.md", src, T);
    const fm = parseFrontmatter(out);
    expect(fm.error).toBeUndefined();
    expect(fm.data).toEqual({ edited: T, title: "제목", tags: ["a"] });
    expect(out.endsWith("---\n본문")).toBe(true);
  });

  it("적은 값은 글자로 읽힌다", () => {
    expect(parseFrontmatter(stampEdited("A.md", "본문", T)).data).toEqual({ [EDITED_FIELD]: T });
  });

  it("YAML 이 깨진 노트는 그대로 돌려준다", () => {
    const broken = "---\na: [\n---\n본문";
    expect(stampEdited("A.md", broken, T)).toBe(broken);
  });

  it("공통 설정 파일과 첨부에는 적지 않는다", () => {
    expect(stampEdited("keyring-settings.md", "---\nlanguage: ko\n---\n", T)).toBe("---\nlanguage: ko\n---\n");
    expect(stampEdited("a.png", "bytes", T)).toBe("bytes");
  });
});

describe("withoutEdited", () => {
  const samples = [
    "본문만",
    "# 제목\r\n본문\r\n",
    "---\ntags:\n- a\n---\n본문\n",
    "---\ny: [a,b]\nx:   1   # c\n\nz: 2\n---\n",
    "---\r\ntitle: a\r\n---\r\n본문\r\n",
    "\uFEFF---\ntitle: 제목\n---\n본문\n",
    "\uFEFF본문",
    "",
  ];
  it("적은 시각을 빼면 글자 그대로 원래 내용이다", () => {
    for (const x of samples) expect(withoutEdited(stampEdited("A.md", x, T))).toBe(x);
  });

  it("시각만 다른 두 판은 같은 내용이 된다", () => {
    for (const x of samples) expect(withoutEdited(stampEdited("A.md", x, T))).toBe(withoutEdited(stampEdited("A.md", x, "2027-01-01T00:00:00Z")));
  });

  it("YAML 이 깨졌으면 그대로", () => {
    const broken = "---\na: [\nedited: 1\n---\n본문";
    expect(withoutEdited(broken)).toBe(broken);
  });
});

describe("editedOf", () => {
  it("ISO 글자와 Date 를 ms 로, 나머지는 null", () => {
    expect(editedOf({ edited: T })).toBe(Date.parse(T));
    expect(editedOf({ edited: new Date(T) })).toBe(Date.parse(T));
    expect(editedOf({ edited: 3 })).toBeNull();
    expect(editedOf({ edited: "어제" })).toBeNull();
    expect(editedOf({})).toBeNull();
    expect(editedOf(null)).toBeNull();
  });
});

describe("alignEdited", () => {
  const T0 = "2026-10-30T09:00:00Z";
  const T1 = "2026-10-30T09:10:00Z";
  const T2 = "2026-10-30T09:20:00Z";
  const doc = (edited: string, first: string, second: string) => `---\nedited: ${edited}\n---\n${first}\n\n가운데\n\n${second}\n`;

  it("양쪽이 다른 문단을 고치고 각자 시각을 적었어도 합쳐지고, 더 늦은 시각이 남는다", () => {
    const base = doc(T0, "첫 문단", "둘째 문단");
    const a = doc(T1, "첫 문단 고침", "둘째 문단");
    const b = doc(T2, "첫 문단", "둘째 문단 고침");
    expect(merge3(base, a, b).ok).toBe(false);
    const m = merge3(...alignEdited(base, a, b));
    expect(m.ok).toBe(true);
    expect(m.ok && m.text).toBe(doc(T2, "첫 문단 고침", "둘째 문단 고침"));
  });

  it("CRLF 로 쓴 세 판도 줄 끝을 지키며 맞춰 합친다", () => {
    const crlf = (e: string, first: string, second: string) => doc(e, first, second).replace(/\n/g, "\r\n");
    const m = merge3(...alignEdited(crlf(T0, "첫 문단", "둘째 문단"), crlf(T1, "첫 문단 고침", "둘째 문단"), crlf(T2, "첫 문단", "둘째 문단 고침")));
    expect(m.ok && m.text).toBe(crlf(T2, "첫 문단 고침", "둘째 문단 고침"));
  });

  it("BOM 으로 시작하는 세 판도 맞춰 합친다(충돌 사본이 되지 않는다)", () => {
    const bom = (e: string, first: string, second: string) => "\uFEFF" + doc(e, first, second);
    const m = merge3(...alignEdited(bom(T0, "첫 문단", "둘째 문단"), bom(T1, "첫 문단 고침", "둘째 문단"), bom(T2, "첫 문단", "둘째 문단 고침")));
    expect(m.ok).toBe(true);
    expect(m.ok && m.text).toBe(bom(T2, "첫 문단 고침", "둘째 문단 고침"));
  });

  it("셋 다 시각이 없으면 그대로", () => {
    const v: [string, string, string] = ["a\n", "b\n", "c\n"];
    expect(alignEdited(...v)).toEqual(v);
  });

  it("이미 가장 늦은 시각인 판은 글자 그대로 둔다", () => {
    const base = doc(T0, "x", "y");
    const a = doc(T2, "x", "y");
    const [, a2] = alignEdited(base, a, doc(T1, "x", "y"));
    expect(a2).toBe(a);
  });
});
