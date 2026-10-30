import { describe, expect, it } from "vitest";
import { isWorkspaceNote } from "./workspaceNote";

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
});
