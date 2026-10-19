import { describe, expect, it } from "vitest";
import { DEFAULT_VAULT_SETTINGS, type VaultSettings } from "@keyring-notes/core";
import { dropWorkspaceLayout, dropWorkspaceRefs, restoreWorkspaceRefs, workspaceAfterDelete, workspaceRefs } from "./workspaceDelete";

const settings = (s: Partial<VaultSettings>): VaultSettings => ({ ...DEFAULT_VAULT_SETTINGS, workspaces: {}, ui: {}, workspaceOrder: [], ...s });

describe("워크스페이스 삭제 뒤 지금 워크스페이스", () => {
  it("지금 것을 지우면 남은 목록의 첫 번째로 바꾼다", () => {
    expect(workspaceAfterDelete(["업무", "개인", "공부"], "업무", "업무")).toBe("개인");
    expect(workspaceAfterDelete(["업무", "개인", "공부"], "개인", "개인")).toBe("업무");
  });

  it("다른 것을 지우면 지금 것을 그대로 둔다", () => {
    expect(workspaceAfterDelete(["업무", "개인"], "업무", "개인")).toBe("업무");
  });

  it("마지막 하나를 지우면 비운다(워크스페이스가 없는 첫 화면)", () => {
    expect(workspaceAfterDelete(["업무"], "업무", "업무")).toBe("");
  });
});

describe("워크스페이스 삭제가 걷는 공통 설정", () => {
  const s = settings({
    workspaceOrder: ["개인", "업무", "공부"],
    workspaces: { 업무: { templateFolder: "틀", daily: { enabled: false } }, 개인: { attachmentFolder: "첨부" } },
  });

  it("워크스페이스별 설정과 순서에서 그 이름을 뺀다", () => {
    expect(dropWorkspaceRefs(s, "업무")).toEqual([
      [["workspaces", "업무"], null],
      [
        ["vault", "workspaceOrder"],
        ["개인", "공부"],
      ],
    ]);
  });

  it("가리키는 것이 없으면 아무것도 바꾸지 않는다", () => {
    expect(dropWorkspaceRefs(s, "없음")).toEqual([]);
    expect(dropWorkspaceRefs(settings({}), "업무")).toEqual([]);
  });

  it("되돌리면 설정과 순서의 자리를 되살린다", () => {
    const saved = workspaceRefs(s, "업무");
    expect(saved).toEqual({ settings: { templateFolder: "틀", daily: { enabled: false } }, orderIndex: 1 });
    // 지운 뒤의 설정에서(그 사이 다른 워크스페이스가 순서 끝에 더해졌어도) 같은 자리로
    const after = settings({ workspaceOrder: ["개인", "공부", "새것"], workspaces: { 개인: { attachmentFolder: "첨부" } } });
    expect(restoreWorkspaceRefs(after, "업무", saved)).toEqual([
      [["workspaces", "업무"], { templateFolder: "틀", daily: { enabled: false } }],
      [
        ["vault", "workspaceOrder"],
        ["개인", "업무", "공부", "새것"],
      ],
    ]);
  });

  it("순서에 없던 워크스페이스는 되돌려도 순서에 넣지 않는다", () => {
    const saved = workspaceRefs(settings({ workspaceOrder: ["개인"] }), "업무");
    expect(saved).toEqual({ orderIndex: -1 });
    expect(restoreWorkspaceRefs(settings({ workspaceOrder: ["개인"] }), "업무", saved)).toEqual([]);
  });
});

describe("워크스페이스 삭제가 걷는 이 기기 배치", () => {
  it("그 워크스페이스의 칸 배치만 뺀다", () => {
    const layouts = { 업무: 1, 개인: 2, "*": 3 };
    expect(dropWorkspaceLayout(layouts, "업무")).toEqual({ 개인: 2, "*": 3 });
    expect(dropWorkspaceLayout(layouts, "없음")).toBe(layouts);
  });
});
