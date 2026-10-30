import { describe, expect, it } from "vitest";
import { bootOpen, isWorkspaceNote, withoutWorkspaceBacklinks } from "./workspaceNote";

describe("워크스페이스 루트 노트", () => {
  it("볼트 맨 위의 마크다운은 워크스페이스 노트다", () => {
    expect(isWorkspaceNote("개인.md")).toBe(true);
    expect(isWorkspaceNote("Work.MD")).toBe(true);
  });

  it("워크스페이스 안의 노트·맨 위의 다른 파일·공통 설정 파일은 아니다", () => {
    expect(isWorkspaceNote("개인/메모.md")).toBe(false);
    expect(isWorkspaceNote("cover.png")).toBe(false);
    expect(isWorkspaceNote("keyring-settings.md")).toBe(false);
  });

  it("첫 로드 주소가 워크스페이스 노트면 열지 않고 막는다", () => {
    expect(bootOpen("개인.md")).toBe("blocked");
    expect(bootOpen("개인/메모.md")).toBe("open");
    expect(bootOpen(null)).toBe(null);
  });

  it("백링크에서 워크스페이스 노트만 뺀다(이 노트가 인용한 출처는 그대로)", () => {
    const refs = {
      path: "개인/메모.md",
      sources: [{ target: "개인", path: "개인.md" }],
      linkedBy: [
        { path: "개인.md", title: "개인" },
        { path: "개인/회의.md", title: "회의" },
      ],
      citedBy: [
        { path: "업무.md", title: "업무" },
        { path: "업무/일정.md", title: "일정" },
      ],
    };
    expect(withoutWorkspaceBacklinks(refs)).toEqual({
      ...refs,
      linkedBy: [{ path: "개인/회의.md", title: "회의" }],
      citedBy: [{ path: "업무/일정.md", title: "일정" }],
    });
  });
});
