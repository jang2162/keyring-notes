import { describe, expect, it } from "vitest";
import { inlineImageUrl, isCommentBlock } from "./liveImage";

const r = (target: string) => (target === "없는.png" ? null : `vault/${target}`);
const u = (path: string) => `/raw/${path}`;

describe("줄 안 이미지 주소", () => {
  it("볼트 상대 경로는 해석해 원본 주소로", () => {
    expect(inlineImageUrl("img/a.png", r, u)).toBe("/raw/vault/img/a.png");
  });

  it("퍼센트 인코딩은 풀어서 찾는다", () => {
    expect(inlineImageUrl("my%20img.png", r, u)).toBe("/raw/vault/my img.png");
  });

  it("http(s) 는 그대로", () => {
    expect(inlineImageUrl("https://x/a.png", r, u)).toBe("https://x/a.png");
    expect(inlineImageUrl("http://x/a.png", r, u)).toBe("http://x/a.png");
  });

  it("허용하지 않는 주소와 못 찾은 파일은 그리지 않는다", () => {
    expect(inlineImageUrl("javascript:alert(1)", r, u)).toBeNull();
    expect(inlineImageUrl("JavaScript:alert(1)", r, u)).toBeNull();
    expect(inlineImageUrl("data:text/html,x", r, u)).toBeNull();
    expect(inlineImageUrl("없는.png", r, u)).toBeNull();
    expect(inlineImageUrl("", r, u)).toBeNull();
  });
});

describe("HTML 블록이 주석 하나뿐인가", () => {
  it("업로드 자리 표시 같은 주석만 있는 블록", () => {
    expect(isCommentBlock("<!-- uploading… -->")).toBe(true);
    expect(isCommentBlock("  <!-- a\nb -->  ")).toBe(true);
  });

  it("다른 HTML 이 섞이면 아니다", () => {
    expect(isCommentBlock("<div>a</div>")).toBe(false);
    expect(isCommentBlock("<!-- a -->\n<div/>")).toBe(false);
    expect(isCommentBlock("<!-- a --> <!-- b -->")).toBe(false);
  });
});
