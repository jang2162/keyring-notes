import { beforeEach, describe, expect, it } from "vitest";
import { moreBadge } from "./bottomBarState";
import { setLanguage, t } from "./i18n";
import { moreEntrySpecs, moreStatusLines, moreStatusOf, saveAttention, type MoreInput } from "./moreMenu";

const server: MoreInput = {
  local: false,
  online: true,
  outboxCount: 0,
  pendingCount: 0,
  save: null,
  syncError: false,
  syncServer: null,
  dailyOn: true,
  update: false,
};
const local: MoreInput = { ...server, local: true, dailyOn: false };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

beforeEach(() => setLanguage("en"));

describe("saveAttention", () => {
  const base = { hasDoc: true, conflict: false, saving: false, failed: false, dirty: false, autosave: true };
  it("충돌·저장 실패는 자동 저장과 상관없이 알린다", () => {
    expect(saveAttention({ ...base, conflict: true })).toBe("conflict");
    expect(saveAttention({ ...base, failed: true, dirty: true })).toBe("failed");
  });
  it("자동 저장이 꺼져 있고 저장 안 한 변경이 있으면 unsaved, 켜져 있으면 평소 상태(편집 중)라 알리지 않는다", () => {
    expect(saveAttention({ ...base, dirty: true, autosave: false })).toBe("unsaved");
    expect(saveAttention({ ...base, dirty: true, autosave: true })).toBeNull();
  });
  it("문서가 없거나 저장 중이거나 저장한 상태면 없음", () => {
    expect(saveAttention({ ...base, hasDoc: false, conflict: true })).toBeNull();
    expect(saveAttention({ ...base, saving: true, dirty: true, autosave: false })).toBeNull();
    expect(saveAttention(base)).toBeNull();
  });
});

describe("moreStatusLines", () => {
  it("평소에는 줄이 없다", () => expect(moreStatusLines(server)).toEqual([]));

  it("자동 저장 끔 + 저장 안 함: 「저장 안 함」 줄(status.unsaved)", () => {
    expect(moreStatusLines({ ...server, save: "unsaved" })).toEqual([{ id: "save", text: t("status.unsaved"), kind: "" }]);
    expect(t("status.unsaved")).toBe("Unsaved");
  });

  it("충돌은 경고, 저장 실패는 오류", () => {
    expect(moreStatusLines({ ...server, save: "conflict" })[0]).toMatchObject({ id: "save", text: t("status.conflict"), kind: "warn" });
    expect(moreStatusLines({ ...server, save: "failed" })[0]).toMatchObject({ id: "save", text: t("status.failed"), kind: "error" });
  });

  it("서버 모드: 저장 → 오프라인(보낼 수) → 검토 대기 순서", () => {
    const lines = moreStatusLines({ ...server, save: "unsaved", online: false, outboxCount: 2, pendingCount: 3 });
    expect(ids(lines)).toEqual(["save", "offline", "review-waiting"]);
    expect(lines[1].text).toBe(t("status.offlineOutbox", { count: 2 }));
  });

  it("서버 모드 연결됨 + 보낼 변경: 「지금 보내기」 줄", () => {
    expect(moreStatusLines({ ...server, outboxCount: 1 })).toEqual([{ id: "outbox", text: t("status.sendNow", { count: 1 }), kind: "warn" }]);
  });

  it("로컬 모드: 오프라인·보낼 변경·검토 대기는 서버 모드 것이라 보이지 않고, 동기화 오류만", () => {
    expect(moreStatusLines({ ...local, online: false, outboxCount: 2, pendingCount: 3 })).toEqual([]);
    expect(moreStatusLines({ ...local, syncError: true })).toEqual([{ id: "sync", text: t("sync.failed"), kind: "error" }]);
    // 동기화 줄은 로컬 모드 것이다
    expect(moreStatusLines({ ...server, syncError: true })).toEqual([]);
  });
});

describe("moreEntrySpecs", () => {
  it("서버 모드·데일리 켬: 레일과 같은 순서, 로그아웃이 끝", () => {
    expect(ids(moreEntrySpecs(server))).toEqual(["daily", "tags", "attachments", "graph", "ingest", "review", "lint", "settings", "logout"]);
  });

  it("로컬 모드·데일리 끔: 가져오기·검토·로그아웃 없음, 동기화가 설정 앞", () => {
    expect(ids(moreEntrySpecs(local))).toEqual(["tags", "attachments", "graph", "lint", "sync", "settings"]);
  });

  it("검토 대기 수·업데이트 점·동기화 오류 점과 서버 이름", () => {
    const s = moreEntrySpecs({ ...server, pendingCount: 4, update: true });
    expect(s.find((e) => e.id === "review")?.badge).toBe(4);
    expect(s.find((e) => e.id === "settings")?.dot).toBe(true);
    const l = moreEntrySpecs({ ...local, syncError: true, syncServer: "notes.example" });
    expect(l.find((e) => e.id === "sync")).toMatchObject({ dot: true, label: t("sync.with", { server: "notes.example" }) });
    expect(moreEntrySpecs(local).find((e) => e.id === "sync")?.label).toBe(t("tool.device"));
  });
});

describe("moreStatusOf → moreBadge", () => {
  it("자동 저장 끔 + 저장 안 함은 점", () => {
    expect(moreBadge(moreStatusOf({ ...server, save: "unsaved" }))).toBe("dot");
    expect(moreBadge(moreStatusOf(server))).toBeNull();
  });
  it("로컬 모드는 서버 모드의 보낼 변경·검토 대기·오프라인을 세지 않는다", () => {
    expect(moreBadge(moreStatusOf({ ...local, online: false, outboxCount: 2, pendingCount: 3 }))).toBeNull();
    expect(moreBadge(moreStatusOf({ ...server, outboxCount: 2, pendingCount: 3 }))).toBe(5);
    // 동기화 오류 점도 로컬 모드 것이다
    expect(moreBadge(moreStatusOf({ ...server, syncError: true }))).toBeNull();
    expect(moreBadge(moreStatusOf({ ...local, syncError: true }))).toBe("dot");
  });
});
