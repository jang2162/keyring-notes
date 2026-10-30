import { describe, expect, it } from "vitest";
import { alignEdited, EDITED_FIELD, editedOf, editedStamp, merge3, parseFrontmatter, stampEdited } from "../src/index.js";

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
