import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentDeleteText, extOf, REF_LIST_MAX, sameKind } from "./attachmentManage";
import { setLanguage } from "./i18n";
import { bumpRawVersion, rawVersion, versioned } from "./rawVersion";

beforeEach(() => setLanguage("en"));

describe("첨부 교체: 같은 형식만", () => {
  it("확장자를 대소문자 없이 견준다", () => {
    expect(extOf("W/_첨부/그림 1.PNG")).toBe("png");
    expect(extOf("W/.hidden")).toBe("");
    expect(extOf("W/README")).toBe("");
    expect(sameKind("W/a.png", "new.PNG")).toBe(true);
    expect(sameKind("W/a.png", "new.jpg")).toBe(false);
    expect(sameKind("W/a.pdf", "a.pdf.png")).toBe(false);
    expect(sameKind("W/README", "LICENSE")).toBe(true);
    expect(sameKind("W/README", "a.txt")).toBe(false);
  });
});

describe("첨부 삭제 확인 글", () => {
  const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `W/n${i}.md`, title: `Note ${i}` }));

  it("가리키는 노트가 없으면 없다고, 서버는 휴지통 안내", () => {
    const s = attachmentDeleteText("a.png", [], false);
    expect(s).toContain('Delete the attachment "a.png"?');
    expect(s).toContain("No notes link to this attachment.");
    expect(s).toContain("restore it from the trash");
    expect(s).not.toContain("device vault");
  });

  it("노트 수와 이름을 보이고, 많으면 나머지는 「외 N개」, 기기 볼트는 휴지통에 남지 않는다고", () => {
    const s = attachmentDeleteText("a.png", refs(REF_LIST_MAX + 3), true);
    expect(s).toContain(`${REF_LIST_MAX + 3} notes link to this attachment`);
    expect(s).toContain("• Note 0");
    expect(s).toContain(`• Note ${REF_LIST_MAX - 1}`);
    expect(s).not.toContain(`• Note ${REF_LIST_MAX}`);
    expect(s).toContain("and 3 more");
    expect(s).toContain("does not go to the trash");
    expect(attachmentDeleteText("a.png", refs(1), false)).toContain("1 note links to this attachment");
  });
});

describe("교체 뒤 첨부 주소", () => {
  const imgs: { src: string; getAttribute(n: string): string; setAttribute(n: string, v: string): void }[] = [];
  const img = (src: string) => ({
    src,
    getAttribute() {
      return this.src;
    },
    setAttribute(_: string, v: string) {
      this.src = v;
    },
  });
  beforeEach(() => {
    imgs.length = 0;
    vi.stubGlobal("document", { querySelectorAll: () => imgs });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("판을 올리면 주소가 바뀌고, 이미 그려진 같은 주소의 그림만 새 주소로 바꿔 끼운다", () => {
    const path = "W/교체.png";
    const url = (p: string) => versioned(`/api/raw?path=${encodeURIComponent(p)}`, p);
    const before = url(path);
    expect(before).toBe(`/api/raw?path=${encodeURIComponent(path)}`);
    imgs.push(img(before), img(url("W/다른.png")));
    bumpRawVersion([path], url);
    expect(rawVersion(path)).toBe(1);
    expect(url(path)).toBe(`${before}&v=1`);
    expect(imgs.map((i) => i.src)).toEqual([`${before}&v=1`, url("W/다른.png")]);
    expect(window.dispatchEvent).toHaveBeenCalled();
    // 주소에 ? 가 없으면(앱의 파일 URL) ?v= 로
    expect(versioned("asset://localhost/W/교체.png", path)).toBe("asset://localhost/W/교체.png?v=1");
  });
});
