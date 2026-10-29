import { describe, expect, it } from "vitest";
import { notePathOfHash, replaceSettingsSection, settingsBack, settingsCloseTarget, syncSetupState } from "./settingsNav";

describe("주소의 노트 경로", () => {
  it("인코딩을 풀고 ':' 로 시작하는 화면은 노트가 아니다", () => {
    expect(notePathOfHash("#/%EC%97%85%EB%AC%B4%2Fa.md")).toBe("업무/a.md");
    expect(notePathOfHash("#a.md")).toBe("a.md");
    expect(notePathOfHash("#/:settings")).toBeNull();
    expect(notePathOfHash("")).toBeNull();
  });
});

describe("닫으면 돌아갈 노트", () => {
  it("주소가 노트면 그 노트", () => {
    expect(syncSetupState("#/Notes%2Fnote3.md", null)).toEqual({ back: "Notes/note3.md" });
    expect(syncSetupState("#/Notes%2Fnote3.md", { back: "old.md" })).toEqual({ back: "Notes/note3.md" });
  });

  it("주소가 노트가 아니면 보존된 state 를 이어받는다(새로 고침)", () => {
    expect(syncSetupState("#/:settings/device", { back: "Notes/note2.md" })).toEqual({ back: "Notes/note2.md" });
  });

  it("어디에도 없으면 없다", () => {
    for (const h of ["", "#", "#/", "#/:settings/general"]) expect(syncSetupState(h, null)).toBeNull();
    expect(syncSetupState("#/:settings/device", { back: "" })).toBeNull();
  });

  it("모양이 다른 state 는 돌아갈 노트로 보지 않는다", () => {
    for (const st of [null, undefined, "a.md", {}, { back: "" }, { back: 1 }]) expect(settingsBack(st)).toBeNull();
    expect(settingsBack({ back: "a.md" })).toBe("a.md");
  });
});

describe("설정을 닫을 때 갈 곳", () => {
  it("돌아갈 노트가 복원된 탭보다 먼저다", () => {
    expect(settingsCloseTarget({ restore: true, current: "Notes/note1.md", back: "Notes/note3.md" })).toEqual({
      hash: "#/Notes%2Fnote3.md",
      open: "Notes/note3.md",
    });
  });

  it("돌아갈 노트가 없으면 지금 노트, 그것도 없으면 홈", () => {
    expect(settingsCloseTarget({ restore: true, current: "a.md", back: null })).toEqual({ hash: "#/a.md", open: null });
    expect(settingsCloseTarget({ restore: true, current: null, back: null })).toEqual({ hash: "#", open: null });
    expect(settingsCloseTarget({ restore: true, current: null, back: "b.md" })).toEqual({ hash: "#/b.md", open: "b.md" });
  });

  it("이미 그 노트면 다시 열지 않는다", () => {
    expect(settingsCloseTarget({ restore: true, current: "b.md", back: "b.md" }).open).toBeNull();
  });

  it("곧 다른 노트를 여는 중이면(restore 아님) 주소만 비운다", () => {
    expect(settingsCloseTarget({ restore: false, current: "a.md", back: "b.md" })).toEqual({ hash: "#", open: null });
  });
});

describe("설정 묶음 바꾸기", () => {
  it("돌아갈 노트(state)를 남긴다", () => {
    const calls: [unknown, string][] = [];
    const h = { state: { back: "Notes/note1.md" }, replaceState: (s: unknown, _t: string, url?: string | URL | null) => void calls.push([s, String(url)]) };
    replaceSettingsSection(h, "general");
    expect(calls).toEqual([[{ back: "Notes/note1.md" }, "#/:settings/general"]]);
  });
});
