import { describe, expect, it } from "vitest";
import type { WidgetApi, WidgetContext } from "../types";
import { startFrameRuntime, type FrameEnv, type FrameKeyEvent } from "./runtime";

const ID = "w1";
const ctx: WidgetContext = { state: { n: 1 }, editing: false, editable: true, display: "block", lang: "en", theme: { "--fg": "#000" }, readOnly: false };
const chain = [{ messages: { a: "A {n}" }, locale: "en" }];

function env() {
  const posted: Record<string, unknown>[] = [];
  const transfers: (Transferable[] | undefined)[] = [];
  let listener: (d: unknown) => void = () => {};
  let key: (e: FrameKeyEvent) => void = () => {};
  let height: (px: number) => void = () => {};
  let blur: () => void = () => {};
  const calls: string[] = [];
  const e: FrameEnv = {
    id: ID,
    post: (m, t) => void (posted.push(m as Record<string, unknown>), transfers.push(t)),
    listen: (cb) => void (listener = cb),
    root: {} as HTMLElement,
    setTheme: (t) => void calls.push(`theme ${JSON.stringify(t)}`),
    addCss: (c) => void calls.push(`css ${c}`),
    setFonts: (f) => void calls.push(`fonts ${Object.keys(f).join(",")}`),
    observeHeight: (cb) => void (height = cb),
    onKey: (cb) => void (key = cb),
    onBlur: (cb) => void (blur = cb),
  };
  const send = (m: Record<string, unknown>) => listener({ kw: "kw1", id: ID, ...m });
  const press = (o: Partial<FrameKeyEvent>) => {
    const ev = { key: "Escape", isComposing: false, keyCode: 27, mod: false, defaultPrevented: false, prevented: 0, preventDefault() {}, ...o };
    ev.preventDefault = () => void ev.prevented++;
    key(ev);
    return ev;
  };
  return { e, posted, transfers, calls, send, press, height: (px: number) => height(px), blur: () => blur() };
}

const init = (file = true, fullscreen = true) => ({ type: "init", ctx, messages: chain, css: "x{}", fonts: { F: new ArrayBuffer(1) }, file, fullscreen });
const types = (p: Record<string, unknown>[]) => p.map((m) => m.type);

describe("iframe 런타임", () => {
  it("register → registered 한 번, init → render 한 번과 테마·CSS·글꼴", () => {
    const x = env();
    const rt = startFrameRuntime(x.e);
    let renders = 0;
    let api: WidgetApi | null = null;
    const render = (_el: HTMLElement, c: WidgetContext, a: WidgetApi) => {
      renders++;
      api = a;
      expect(c).toEqual(ctx);
      return () => {};
    };
    rt.register(render);
    rt.register(render);
    expect(x.posted).toEqual([{ kw: "kw1", id: ID, type: "registered" }]);
    x.send(init());
    x.send(init());
    expect(renders).toBe(1);
    expect(x.calls).toEqual([`theme {"--fg":"#000"}`, "css x{}", "fonts F"]);
    expect(api!.t("a", { n: 2 })).toBe("A 2");
    expect(typeof api!.toggleFullscreen).toBe("function");
  });

  it("api 는 보내기만, 상태는 update 로 돌아온 ctx 로 onUpdate", () => {
    const x = env();
    const rt = startFrameRuntime(x.e);
    let api!: WidgetApi;
    rt.register((_e, _c, a) => ((api = a), () => {}));
    x.send(init());
    const seen: unknown[] = [];
    api.onUpdate((c) => seen.push(c.state));
    api.setState({ n: 2 });
    api.requestEdit();
    api.exitEdit(true);
    api.toggleFullscreen!();
    expect(x.posted.slice(1)).toEqual([
      { kw: "kw1", id: ID, type: "setState", patch: { n: 2 } },
      { kw: "kw1", id: ID, type: "requestEdit" },
      { kw: "kw1", id: ID, type: "exitEdit", apply: true },
      { kw: "kw1", id: ID, type: "toggleFullscreen" },
    ]);
    expect(seen).toEqual([]);
    x.send({ type: "update", ctx: { ...ctx, state: { n: 2 } } });
    expect(seen).toEqual([{ n: 2 }]);
    // 다른 id 의 update 는 무시
    x.send({ type: "update", ctx: { ...ctx, state: { n: 3 } }, id: "other" });
    expect(seen).toEqual([{ n: 2 }]);
  });

  it("file: 없으면 api.file 없음, 있으면 req 로 짝짓고 거절은 code", async () => {
    const x = env();
    let api!: WidgetApi;
    startFrameRuntime(x.e).register((_e, _c, a) => ((api = a), () => {}));
    x.send(init(false, false));
    expect(api.file).toBeUndefined();
    expect(api.toggleFullscreen).toBeUndefined();

    const y = env();
    let api2!: WidgetApi;
    startFrameRuntime(y.e).register((_e, _c, a) => ((api2 = a), () => {}));
    y.send(init());
    const r = api2.file!.read();
    expect(y.posted.at(-1)).toEqual({ kw: "kw1", id: ID, type: "fileRead", req: 0 });
    y.send({ type: "reply", req: 0, ok: true, value: { bytes: new Uint8Array([1]), hash: "h" } });
    await expect(r).resolves.toEqual({ bytes: new Uint8Array([1]), hash: "h" });
    const src = new Uint8Array([7, 8]);
    const w = api2.file!.write(src, "a".repeat(64));
    expect(y.posted.at(-1)).toMatchObject({ type: "fileWrite", req: 1, baseHash: "a".repeat(64), bytes: new Uint8Array([7, 8]) });
    // 위젯이 쥔 배열은 떼어 가지 않는다 — 사본의 버퍼를 넘긴다
    const sent = y.transfers.at(-1)!;
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toBe(src.buffer);
    expect(sent[0]).toBe((y.posted.at(-1)!.bytes as Uint8Array).buffer);
    y.send({ type: "reply", req: 1, ok: false, error: "conflict" });
    await expect(w).rejects.toMatchObject({ code: "conflict" });
  });

  it("키: 처리하지 않은 Esc 만, 조합 중 아님, Mod+S 는 막고 save", () => {
    const x = env();
    startFrameRuntime(x.e).register(() => () => {});
    x.send(init());
    const n = () => x.posted.filter((m) => m.type === "key");
    x.press({});
    expect(n()).toEqual([{ kw: "kw1", id: ID, type: "key", key: "escape" }]);
    x.press({ defaultPrevented: true });
    x.press({ isComposing: true });
    x.press({ keyCode: 229 });
    expect(n()).toHaveLength(1);
    const s = x.press({ key: "s", keyCode: 83, mod: true });
    expect(s.prevented).toBe(1);
    x.press({ key: "S", keyCode: 83, mod: true });
    x.press({ key: "s", keyCode: 83, mod: false });
    expect(n().map((m) => m.key)).toEqual(["escape", "save", "save"]);
  });

  it("높이·blur", () => {
    const x = env();
    startFrameRuntime(x.e).register(() => () => {});
    x.send(init());
    x.height(321);
    x.blur();
    expect(types(x.posted).slice(1)).toEqual(["height", "blur"]);
    expect(x.posted[1]).toEqual({ kw: "kw1", id: ID, type: "height", px: 321 });
  });

  it("render 가 던지면 error", () => {
    const x = env();
    startFrameRuntime(x.e).register(() => {
      throw new Error("boom");
    });
    x.send(init());
    expect(x.posted.at(-1)).toEqual({ kw: "kw1", id: ID, type: "error", message: "boom" });
  });
});
