import { describe, expect, it } from "vitest";
import {
  hasOwnNotes,
  needsSyncSetup,
  queryChoice,
  readMode,
  soloHref,
  startsLocal,
  storedChoice,
  syncSetupRedirect,
  type ModeChoice,
  type ModeEnv,
  type ModeInput,
} from "./mode";

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

describe("브라우저 상태로 모드 정하기", () => {
  const env = (m: Partial<ModeEnv> = {}): ModeEnv => ({ tauri: false, search: "", stored: null, installed: false, pending: async () => false, ...m });

  it("주소로 고른 것을 기억한다 — ?local=0 은 지우지 않고 server 로", async () => {
    expect(await readMode(env({ search: "?local=0", installed: true }))).toEqual({ local: false, remember: "server" });
    expect(await readMode(env({ search: "?local" }))).toEqual({ local: true, remember: "local" });
    expect(await readMode(env({ stored: "local" }))).toEqual({ local: true, remember: null });
  });

  it("기억한 server 는 설치한 웹 앱에서도 서버 모드", async () => {
    expect((await readMode(env({ stored: "server", installed: true }))).local).toBe(false);
  });

  it("설치한 웹 앱은 대기열이 남았으면 서버 모드, 비면 로컬", async () => {
    expect((await readMode(env({ installed: true, pending: async () => true }))).local).toBe(false);
    expect((await readMode(env({ installed: true, pending: async () => false }))).local).toBe(true);
  });

  it("대기열을 못 읽으면 남은 것으로 본다", async () => {
    expect((await readMode(env({ installed: true, pending: async () => Promise.reject(new Error("idb")) }))).local).toBe(false);
    expect(
      (
        await readMode(
          env({
            installed: true,
            pending: () => {
              throw new Error("idb");
            },
          }),
        )
      ).local,
    ).toBe(false);
  });

  it("대기열은 판정을 가를 때만 읽는다", async () => {
    let reads = 0;
    const pending = async () => (reads++, false);
    await readMode(env({ pending }));
    await readMode(env({ installed: true, stored: "server", pending }));
    await readMode(env({ installed: true, search: "?local", pending }));
    await readMode(env({ tauri: true, installed: true, pending }));
    expect(reads).toBe(0);
    await readMode(env({ installed: true, pending }));
    expect(reads).toBe(1);
  });

  it("새 창의 ?local 은 따르되 기억하지 않는다", async () => {
    expect(await readMode(env({ search: "?solo=1&local=1" }))).toEqual({ local: true, remember: null });
    expect(await readMode(env({ search: "?solo=1&local=0", installed: true }))).toEqual({ local: false, remember: null });
  });

  it("앱은 늘 로컬이고 아무것도 기억하지 않는다", async () => {
    expect(await readMode(env({ tauri: true, search: "?local=0" }))).toEqual({ local: true, remember: null });
  });
});

describe("새 창 주소", () => {
  it("부모 창의 모드를 실어 보낸다", () => {
    const local = new URL(soloHref("https://n.example/#/a.md", "업무/b.md", true));
    expect(local.searchParams.get("solo")).toBe("1");
    expect(local.searchParams.get("local")).toBe("1");
    expect(local.hash).toBe("#/" + encodeURIComponent("업무/b.md"));
    expect(new URL(soloHref("https://n.example/?local", "b.md", false)).searchParams.get("local")).toBe("0");
  });

  it("새 창 주소로 연 창은 부모와 같은 모드이고 기억은 그대로다", async () => {
    for (const parent of [true, false]) {
      const search = new URL(soloHref("https://n.example/", "b.md", parent)).search;
      const r = await readMode({ tauri: false, search, stored: null, installed: false, pending: async () => false });
      expect(r).toEqual({ local: parent, remember: null });
    }
  });
});

describe("사람이 쓴 노트가 있는지", () => {
  const none = () => false;

  it("볼트가 만드는 설정 파일·점 폴더·자동 생성 문서는 세지 않는다", () => {
    expect(hasOwnNotes([], none)).toBe(false);
    expect(hasOwnNotes(["keyring-settings.md"], none)).toBe(false);
    expect(hasOwnNotes([".keyring-app/x.md", "a/.hidden.md"], none)).toBe(false);
    expect(hasOwnNotes(["wiki/index.md"], (p) => p === "wiki/index.md")).toBe(false);
  });

  it("노트가 하나라도 있으면 있다", () => {
    expect(hasOwnNotes(["keyring-settings.md", "Notes/a.md"], none)).toBe(true);
    expect(hasOwnNotes(["sub/keyring-settings.md"], none)).toBe(true);
  });
});

describe("처음 화면으로 동기화 연결 열기", () => {
  const setup = { kind: "browser" as const, solo: false, connected: false, hasNotes: false };

  it("브라우저 로컬 볼트가 동기화 없이 비어 있으면 연다", () => {
    expect(needsSyncSetup(setup)).toBe(true);
  });

  it("앱 볼트·연결됨·새 창·노트가 있으면 열지 않는다", () => {
    expect(needsSyncSetup({ ...setup, kind: "app" })).toBe(false);
    expect(needsSyncSetup({ ...setup, connected: true })).toBe(false);
    expect(needsSyncSetup({ ...setup, solo: true })).toBe(false);
    expect(needsSyncSetup({ ...setup, hasNotes: true })).toBe(false);
  });

  it("주소가 노트여도 동기화 화면으로 바꾸고 그 노트를 돌아갈 곳으로 남긴다", () => {
    expect(syncSetupRedirect({ ...setup, hash: "#/Notes%2Fnote3.md", state: null })).toEqual({
      url: "#/:settings/device",
      state: { back: "Notes/note3.md" },
    });
    expect(syncSetupRedirect({ ...setup, hash: "", state: null })).toEqual({ url: "#/:settings/device", state: null });
  });

  it("동기화 화면에서 새로 고침하면 돌아갈 노트를 이어받는다", () => {
    expect(syncSetupRedirect({ ...setup, hash: "#/:settings/device", state: { back: "Notes/note2.md" } })?.state).toEqual({ back: "Notes/note2.md" });
  });

  it("열지 않을 때는 주소를 건드리지 않는다", () => {
    expect(syncSetupRedirect({ ...setup, hasNotes: true, hash: "#/a.md", state: null })).toBeNull();
  });
});
