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

  it("이름 바꾸기가 실패하면 failed — 입력은 확정 대기로 남아 다음 확정이 다시 바꿔 본다", async () => {
    const d = new TitleDraft();
    const seen: string[] = [];
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect((await d.commit("W/Old.md", { invalid, rename: async (p, n) => (seen.push(`${p}→${n}`), false) })).kind).toBe("failed");
    expect(d.pending()).toBe("W/Old.md");
    expect((await d.commit("W/Old.md", { invalid, rename: (p, n) => (seen.push(`${p}→${n}`), Promise.reject(new Error("x"))) })).kind).toBe("failed");
    expect(d.pending()).toBe("W/Old.md");
    expect(seen).toEqual(["W/Old.md→Taken", "W/Old.md→Taken"]);
  });

  it("실패한 입력도 Esc 로 취소하면 남지 않는다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit("W/Old.md", { invalid, rename: async () => false });
    d.cancel();
    expect(d.pending()).toBeNull();
  });

  it("다른 노트로 넘어간 칸에서 실패한 입력은 버린다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect((await d.commit("W/Other.md", { invalid, rename: async () => false })).kind).toBe("failed");
    expect(d.pending()).toBeNull();
  });

  it("이름 바꾸는 중에 새로 입력했으면 실패해도 새 입력을 둔다", async () => {
    const d = new TitleDraft();
    let finish!: (ok: boolean) => void;
    d.typed({ path: "W/Old.md", name: "Taken" });
    const first = d.commit("W/Old.md", { invalid, rename: () => new Promise<boolean>((r) => (finish = r)) });
    d.typed({ path: "W/Old.md", name: "Fresh" });
    finish(false);
    expect((await first).kind).toBe("failed");
    const seen: string[] = [];
    await d.commit("W/Old.md", { invalid, rename: async (_p, n) => (seen.push(n), true) });
    expect(seen).toEqual(["Fresh"]);
  });

  it("칸이 사라질 때의 확정(shown 이 null)은 실패해도 입력을 남기지 않는다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect((await d.commit(null, { invalid, rename: async () => false })).kind).toBe("failed");
    expect(d.pending()).toBeNull();
    d.typed({ path: "W/Old.md", name: "a/b" });
    expect((await d.commit(null, { invalid, rename: ok })).kind).toBe("dropped");
    expect(d.pending()).toBeNull();
  });

  it("칸이 보이는 동안 실패해 남은 입력도, 칸이 사라질 때의 확정이 다시 실패하면 남지 않는다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit("W/Old.md", { invalid, rename: async () => false });
    expect(d.pending()).toBe("W/Old.md");
    await d.commit(null, { invalid, rename: async () => false });
    expect(d.pending()).toBeNull();
  });

  it("이름 바꾸는 중에 Esc 로 취소하면 실패해도 입력을 되살리지 않는다", async () => {
    const d = new TitleDraft();
    let finish!: (ok: boolean) => void;
    d.typed({ path: "W/Old.md", name: "Fresh" });
    const first = d.commit("W/Old.md", { invalid, rename: () => new Promise<boolean>((r) => (finish = r)) });
    d.cancel();
    finish(false);
    expect((await first).kind).toBe("failed");
    expect(d.pending()).toBeNull();
  });

  it("취소는 그 확정에만 — 다음 확정이 실패하면 다시 입력을 남긴다", async () => {
    const d = new TitleDraft();
    let finish!: (ok: boolean) => void;
    d.typed({ path: "W/Old.md", name: "Fresh" });
    const first = d.commit("W/Old.md", { invalid, rename: () => new Promise<boolean>((r) => (finish = r)) });
    d.cancel();
    finish(false);
    await first;
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit("W/Old.md", { invalid, rename: async () => false });
    expect(d.pending()).toBe("W/Old.md");
  });

  it("이름 바꾸는 중에 다시 확정을 부르면(탭 메뉴를 열면 blur 가 먼저 난다) 두 번 바꾸지 않고 같은 결과를 기다린다", async () => {
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

  it("같은 이름이 있어 못 바꾸면 null — 닫지 않고 입력을 남긴다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    expect(await settleTitles([paneOf(d, "W/Old.md", async () => false)], "W/Old.md")).toBeNull();
    expect(d.pending()).toBe("W/Old.md");
  });

  it("blur 확정이 먼저 실패한 뒤의 닫기(탭 메뉴)도 다시 확정하고 닫지 않는다", async () => {
    const d = new TitleDraft();
    let calls = 0;
    const taken = async () => (calls++, false);
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit("W/Old.md", { invalid, rename: taken });
    const panes = [paneOf(d, "W/Old.md", taken)];
    expect(titlePendingIn(panes, "W/Old.md")).toBe(true);
    expect(await settleTitles(panes, "W/Old.md")).toBeNull();
    expect(calls).toBe(2);
  });

  it("칸이 사라질 때 실패한 입력은 그 노트의 닫기를 막지 않는다", async () => {
    const d = new TitleDraft();
    let calls = 0;
    const taken = async () => (calls++, false);
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit("W/Old.md", { invalid, rename: taken });
    await d.commit(null, { invalid, rename: taken });
    const panes = [paneOf(d, "W/Old.md", taken)];
    expect(titlePendingIn(panes, "W/Old.md")).toBe(false);
    expect(await settleTitles(panes, "W/Old.md")).toBe("W/Old.md");
    expect(calls).toBe(2);
  });

  it("이름 바꾸는 중에 Esc 로 취소하고 실패했으면 닫기는 바꾸지 않고 그대로 닫는다", async () => {
    const d = new TitleDraft();
    let finish!: (ok: boolean) => void;
    const seen: string[] = [];
    d.typed({ path: "W/Untitled 2.md", name: "Fresh" });
    const first = d.commit("W/Untitled 2.md", { invalid, rename: () => new Promise<boolean>((r) => (finish = r)) });
    d.cancel();
    finish(false);
    await first;
    const panes = [paneOf(d, "W/Untitled 2.md", async (_p, n) => (seen.push(n), true))];
    expect(await settleTitles(panes, "W/Untitled 2.md")).toBe("W/Untitled 2.md");
    expect(seen).toEqual([]);
  });

  it("잘못된 이름이면 null — 닫지 않고 입력을 남긴다", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "" });
    expect(await settleTitles([paneOf(d, "W/Old.md", ok)], "W/Old.md")).toBeNull();
    expect(d.pending()).toBe("W/Old.md");
  });
});

describe("Esc 가 되돌릴 입력(이 칸이 이번에 입력한 노트)", () => {
  it("입력했으면 그 노트, 입력하지 않았으면 null", () => {
    const d = new TitleDraft();
    expect(d.cancel()).toBeNull();
    d.typed({ path: "W/Old.md", name: "Ol" });
    expect(d.cancel()).toBe("W/Old.md");
    expect(d.cancel()).toBeNull();
  });

  it("쳤다 지운 입력도 칸을 떠나기 전의 Esc 는 되돌린다", () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Oldx" });
    d.typed({ path: "W/Old.md", name: "Old" });
    expect(d.cancel()).toBe("W/Old.md");
  });

  it("확정이 끝나 남은 입력이 없으면 null — 원래 이름으로 확정·이름 바꾸기 성공·다른 노트로 넘어감·실패해도 버린 입력", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Old" });
    await d.commit("W/Old.md", { invalid, rename: ok });
    expect(d.cancel()).toBeNull();
    d.typed({ path: "W/Old.md", name: "New" });
    await d.commit("W/Old.md", { invalid, rename: ok });
    expect(d.cancel()).toBeNull();
    d.typed({ path: "W/Old.md", name: "a/b" });
    await d.commit("W/Other.md", { invalid, rename: ok });
    expect(d.cancel()).toBeNull();
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit(null, { invalid, rename: async () => false });
    expect(d.cancel()).toBeNull();
  });

  it("실패해 입력이 칸에 남았으면 그 노트", async () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Taken" });
    await d.commit("W/Old.md", { invalid, rename: async () => false });
    expect(d.cancel()).toBe("W/Old.md");
    d.typed({ path: "W/Old.md", name: "a/b" });
    await d.commit("W/Old.md", { invalid, rename: ok });
    expect(d.cancel()).toBe("W/Old.md");
  });

  it("칸이 다른 노트로 넘어갔다 돌아오면 null — 앞서 입력한 것은 이번 입력이 아니다", () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Untitled.md", name: "Untitled" });
    d.shows("W/Untitled.md");
    d.shows("W/Existing.md");
    d.shows("W/Untitled.md");
    expect(d.cancel()).toBeNull();
    d.typed({ path: "W/Untitled.md", name: "Untitled" });
    d.shows("W/Untitled.md");
    expect(d.cancel()).toBe("W/Untitled.md");
  });

  it("이름 바꾸는 중의 Esc 도 그 노트", () => {
    const d = new TitleDraft();
    d.typed({ path: "W/Old.md", name: "Fresh" });
    void d.commit("W/Old.md", { invalid, rename: () => new Promise<boolean>(() => undefined) });
    expect(d.cancel()).toBe("W/Old.md");
  });
});
