import { describe, expect, it } from "vitest";
import { renamedPath, settleTitles, TitleDraft, titlePendingIn, type TitleHandle } from "./titleEdit";

const invalid = (name: string) => (!name.trim() ? "empty" : /[/:]/.test(name) ? "bad" : null);
const ok = () => Promise.resolve(true);

/** 칸 하나: 제목 칸의 draft 를 Workspace 가 보는 손잡이로 */
const paneOf = (draft: TitleDraft, shown: string, rename: (path: string, name: string) => Promise<boolean>): TitleHandle => ({
  titlePending: () => draft.pending(),
  commitTitle: async (p) => (draft.pending() === p ? draft.commit(shown, { invalid, rename }) : { kind: "none", path: p }),
});

describe("이름을 바꾼 경로", () => {
  it("같은 부모 아래 새 이름으로", () => {
    expect(renamedPath("W/A/Untitled 1.md", "Plan")).toBe("W/A/Plan.md");
    expect(renamedPath("W/Untitled.md", "Plan")).toBe("W/Plan.md");
    expect(renamedPath("Top.md", "Plan")).toBe("Plan.md");
  });
});

describe("제목 칸의 확정 안 한 입력", () => {
  it("원래와 다른 이름을 입력해 두었으면 기다려야 한다", () => {
    const d = new TitleDraft();
    expect(d.pending()).toBeNull();
    d.typed({ path: "W/Untitled 1.md", name: "Plan" });
    expect(d.pending()).toBe("W/Untitled 1.md");
  });

  it("원래 이름으로 되돌려 둔 입력은 기다리지 않는다", () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Untitled 1.md", name: "Untitled 1" });
    expect(d.pending()).toBeNull();
  });

  it("원래 이름 그대로면 이름을 바꾸지 않는다", async () => {
    const d = new TitleDraft();
    let calls = 0;
    d.typed({ path: "W/Old.md", name: "Old" });
    const o = await d.commit("W/Old.md", { invalid, rename: async () => (calls++, true) });
    expect(o).toEqual({ kind: "none", path: "W/Old.md" });
    expect(calls).toBe(0);
  });

  it("Esc 로 취소한 입력은 확정하지 않는다", async () => {
    const d = new TitleDraft();
    let calls = 0;
    d.typed({ path: "W/Old.md", name: "New" });
    d.cancel();
    expect(d.pending()).toBeNull();
    const o = await d.commit("W/Old.md", { invalid, rename: async () => (calls++, true) });
    expect(o.kind).toBe("none");
    expect(calls).toBe(0);
  });

  it("이름을 바꾸고 새 경로를 돌려준다", async () => {
    const d = new TitleDraft();
    const seen: string[] = [];
    d.typed({ path: "W/Untitled 1.md", name: "Plan" });
    const o = await d.commit("W/Untitled 1.md", { invalid, rename: async (p, n) => (seen.push(`${p}→${n}`), true) });
    expect(o).toEqual({ kind: "renamed", path: "W/Plan.md", from: "W/Untitled 1.md" });
    expect(seen).toEqual(["W/Untitled 1.md→Plan"]);
    expect(d.pending()).toBeNull();
  });

  it("보이는 노트의 잘못된 이름은 입력을 남긴다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "a/b" });
    const o = await d.commit("W/Old.md", { invalid, rename: ok });
    expect(o.kind).toBe("invalid");
    expect(d.pending()).toBe("W/Old.md");
  });

  it("다른 노트로 넘어간 칸의 잘못된 이름은 버린다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "a/b" });
    const o = await d.commit("W/Other.md", { invalid, rename: ok });
    expect(o.kind).toBe("dropped");
    expect(d.pending()).toBeNull();
  });

  it("이름 바꾸기가 실패하면 failed", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect((await d.commit("W/Old.md", { invalid, rename: async () => false })).kind).toBe("failed");
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect((await d.commit("W/Old.md", { invalid, rename: () => Promise.reject(new Error("x")) })).kind).toBe("failed");
  });

  it("이름 바꾸는 중에 다시 확정을 부르면(✕ 를 누르면 blur 가 먼저 난다) 두 번 바꾸지 않고 같은 결과를 기다린다", async () => {
    const d = new TitleDraft();
    let calls = 0;
    let finish!: (ok: boolean) => void;
    const rename = () => (calls++, new Promise<boolean>((r) => (finish = r)));
    d.typed({ path: "W/Old.md", name: "New" });
    const first = d.commit("W/Old.md", { invalid, rename });
    expect(d.pending()).toBe("W/Old.md");
    const second = d.commit("W/Old.md", { invalid, rename });
    finish(true);
    expect(await first).toEqual(await second);
    expect(calls).toBe(1);
    expect(d.pending()).toBeNull();
  });
});

describe("닫기 전 확정", () => {
  it("입력한 칸이 없으면 그 경로 그대로", async () => {
    const d = new TitleDraft();
    const panes = [paneOf(d, "W/A.md", ok), null];
    expect(titlePendingIn(panes, "W/A.md")).toBe(false);
    expect(await settleTitles(panes, "W/A.md")).toBe("W/A.md");
  });

  it("닫는 노트에 입력해 둔 제목을 확정하고 바뀐 경로를 돌려준다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Untitled 1.md", name: "Plan" });
    const panes = [paneOf(new TitleDraft(), "W/B.md", ok), paneOf(d, "W/Untitled 1.md", ok)];
    expect(titlePendingIn(panes, "W/Untitled 1.md")).toBe(true);
    expect(await settleTitles(panes, "W/Untitled 1.md")).toBe("W/Plan.md");
    expect(titlePendingIn(panes, "W/Untitled 1.md")).toBe(false);
  });

  it("다른 노트에 입력해 둔 제목은 건드리지 않는다", async () => {
    const d = new TitleDraft();
    let calls = 0;
    d.typed({ path: "W/B.md", name: "Bee" });
    expect(await settleTitles([paneOf(d, "W/B.md", async () => (calls++, true))], "W/A.md")).toBe("W/A.md");
    expect(calls).toBe(0);
    expect(d.pending()).toBe("W/B.md");
  });

  it("다른 노트를 기다리는 칸에는 확정을 부르지 않는다", async () => {
    const asked: string[] = [];
    const other: TitleHandle = { titlePending: () => "W/B.md", commitTitle: async (p) => (asked.push(p), { kind: "failed", path: p }) };
    expect(await settleTitles([other], "W/A.md")).toBe("W/A.md");
    expect(asked).toEqual([]);
  });

  it("같은 이름이 있어 못 바꾸면 null — 닫지 않는다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect(await settleTitles([paneOf(d, "W/Old.md", async () => false)], "W/Old.md")).toBeNull();
  });

  it("잘못된 이름이면 null — 닫지 않고 입력을 남긴다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "" });
    expect(await settleTitles([paneOf(d, "W/Old.md", ok)], "W/Old.md")).toBeNull();
    expect(d.pending()).toBe("W/Old.md");
  });
});
