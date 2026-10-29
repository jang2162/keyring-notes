import { describe, expect, it } from "vitest";
import { needsSyncSetup, notePathOfHash, queryChoice, settingsBack, startsLocal, storedChoice, syncSetupState, type ModeChoice, type ModeInput } from "./mode";

const base: ModeInput = { tauri: false, installed: false, query: null, stored: null, pendingOutbox: false };
const run = (m: Partial<ModeInput>) => startsLocal({ ...base, ...m });

describe("서버 모드·로컬 모드 판정", () => {
  it("앱(Tauri)은 고른 것·대기열과 상관없이 늘 로컬", () => {
    for (const query of ["local", "server", null] as ModeChoice[])
      for (const pendingOutbox of [true, false]) expect(run({ tauri: true, installed: true, query, stored: "server", pendingOutbox })).toBe(true);
  });

  it("고른 적 없는 브라우저 탭은 서버 모드", () => {
    expect(run({})).toBe(false);
  });

  it("고른 적 없는 설치한 웹 앱은 로컬", () => {
    expect(run({ installed: true })).toBe(true);
  });

  it("설치한 웹 앱이어도 서버 모드 대기열이 남았으면 이번에는 서버 모드", () => {
    expect(run({ installed: true, pendingOutbox: true })).toBe(false);
  });

  it("고른 것은 설치 여부·대기열보다 이긴다", () => {
    for (const installed of [true, false])
      for (const pendingOutbox of [true, false]) {
        expect(run({ installed, pendingOutbox, stored: "server" })).toBe(false);
        expect(run({ installed, pendingOutbox, query: "server" })).toBe(false);
        expect(run({ installed, pendingOutbox, stored: "local" })).toBe(true);
        expect(run({ installed, pendingOutbox, query: "local" })).toBe(true);
      }
  });

  it("주소의 선택이 기억한 선택보다 이긴다", () => {
    expect(run({ installed: true, query: "server", stored: "local" })).toBe(false);
    expect(run({ query: "local", stored: "server" })).toBe(true);
  });
});

describe("모드 선택 읽기", () => {
  it("?local 은 로컬, ?local=0 만 서버, 없으면 고르지 않음", () => {
    expect(queryChoice("?local")).toBe("local");
    expect(queryChoice("?local=1")).toBe("local");
    expect(queryChoice("?a=1&local=0")).toBe("server");
    expect(queryChoice("")).toBeNull();
    expect(queryChoice("?solo=1")).toBeNull();
  });

  it("기억한 값은 local·server 만 고른 것으로 본다", () => {
    expect(storedChoice("local")).toBe("local");
    expect(storedChoice("server")).toBe("server");
    expect(storedChoice(null)).toBeNull();
    expect(storedChoice("web")).toBeNull();
  });
});

describe("처음 화면으로 동기화 연결 열기", () => {
  const setup = { kind: "browser" as const, solo: false, connected: false };

  it("브라우저 로컬 볼트가 동기화 없이 열리면 연다", () => {
    expect(needsSyncSetup(setup)).toBe(true);
  });

  it("앱 볼트·연결됨·새 창에서는 열지 않는다", () => {
    expect(needsSyncSetup({ ...setup, kind: "app" })).toBe(false);
    expect(needsSyncSetup({ ...setup, connected: true })).toBe(false);
    expect(needsSyncSetup({ ...setup, solo: true })).toBe(false);
  });

  it("주소가 노트면 닫을 때 그 노트로 돌아가게 state 에 남긴다", () => {
    expect(syncSetupState("#/Notes%2Fnote3.md")).toEqual({ back: "Notes/note3.md" });
    expect(settingsBack(syncSetupState("#/Notes%2Fnote3.md"))).toBe("Notes/note3.md");
  });

  it("빈 주소·설정 주소는 돌아갈 노트가 없다", () => {
    for (const h of ["", "#", "#/", "#/:settings/general"]) expect(syncSetupState(h)).toBeNull();
  });

  it("모양이 다른 state 는 돌아갈 노트로 보지 않는다", () => {
    for (const st of [null, undefined, "a.md", {}, { back: "" }, { back: 1 }]) expect(settingsBack(st)).toBeNull();
  });
});

describe("주소의 노트 경로", () => {
  it("인코딩을 풀고 ':' 로 시작하는 화면은 노트가 아니다", () => {
    expect(notePathOfHash("#/%EC%97%85%EB%AC%B4%2Fa.md")).toBe("업무/a.md");
    expect(notePathOfHash("#a.md")).toBe("a.md");
    expect(notePathOfHash("#/:settings")).toBeNull();
    expect(notePathOfHash("")).toBeNull();
  });
});
