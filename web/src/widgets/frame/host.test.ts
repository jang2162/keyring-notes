import { describe, expect, it } from "vitest";
import { DataFileError, type DataFileHandle } from "../dataFile";
import { WidgetSession } from "../session";
import type { WidgetContext } from "../types";
import { FrameHost, type FrameHostOptions } from "./host";
import type { FrameMsg, HostMsg } from "./protocol";

const ID = "w1";

function setup(over: Partial<FrameHostOptions> = {}, sessionInit = { state: { n: 1 }, editable: true, readOnly: false }) {
  const posted: HostMsg[] = [];
  const log: string[] = [];
  const session = new WidgetSession(sessionInit, {
    write: (s) => (log.push(`write ${JSON.stringify(s)}`), true),
    startEdit: () => void log.push("startEdit"),
    setDraft: () => void log.push("setDraft"),
    endEdit: () => void log.push("endEdit"),
    changed: () => {},
  });
  const ctx = (): WidgetContext => ({
    state: session.state,
    editing: session.editing,
    editable: session.editable,
    display: "block",
    lang: "en",
    theme: {},
    readOnly: false,
  });
  let fs = false;
  const host = new FrameHost({
    id: ID,
    post: (m) => void posted.push(m),
    session,
    ctx,
    messages: () => [{ messages: { a: "A" }, locale: "en" }],
    file: null,
    fullscreen: { toggle: () => void (fs = !fs), on: () => fs, exit: () => void ((fs = false), log.push("exit")) },
    height: (px) => void log.push(`height ${px}`),
    blurred: () => void log.push("blurred"),
    save: () => void log.push("save"),
    failed: (m) => void log.push(`failed ${m}`),
    navigated: () => void log.push("navigated"),
    code: { runtime: "RUNTIME", widget: "WIDGET", css: "C", fonts: { F: new ArrayBuffer(2) } },
    ...over,
  });
  const recv = (m: FrameMsg) => host.receive(m);
  return { host, posted, log, session, recv, setFs: (v: boolean) => (fs = v) };
}

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("iframe 호스트", () => {
  it("ready → load(runtime)·load(widget), registered → init", () => {
    const x = setup();
    x.recv({ type: "ready" });
    expect(x.posted).toHaveLength(2);
    expect(x.posted[0]).toMatchObject({ type: "load" });
    expect((x.posted[0] as { code: string }).code).toContain("RUNTIME");
    expect((x.posted[0] as { code: string }).code).toContain(JSON.stringify(ID));
    expect(x.posted[1]).toEqual({ kw: "kw1", type: "load", code: "WIDGET" });
    x.recv({ type: "registered" });
    expect(x.posted[2]).toMatchObject({
      kw: "kw1",
      id: ID,
      type: "init",
      css: "C",
      file: false,
      fullscreen: true,
      messages: [{ messages: { a: "A" }, locale: "en" }],
    });
    expect(Object.keys((x.posted[2] as { fonts: object }).fonts)).toEqual(["F"]);
  });

  it("ready 전 메시지에는 답하지 않는다", () => {
    const x = setup();
    x.recv({ type: "registered" });
    x.recv({ type: "setState", patch: { n: 2 } });
    expect(x.posted).toEqual([]);
    expect(x.log).toEqual([]);
  });

  it("Esc: 전체 화면이면 닫기만, 아니면 수정 버림", () => {
    const x = setup();
    x.recv({ type: "ready" });
    x.recv({ type: "requestEdit" });
    x.recv({ type: "setState", patch: { n: 5 } });
    x.setFs(true);
    x.recv({ type: "key", key: "escape" });
    expect(x.log).toEqual(["startEdit", "setDraft", "exit"]);
    expect(x.session.editing).toBe(true);
    x.recv({ type: "key", key: "escape" });
    expect(x.session.editing).toBe(false);
    expect(x.log.some((l) => l.startsWith("write"))).toBe(false);
  });

  it("save·height·blur·error·toggleFullscreen", () => {
    const x = setup();
    x.recv({ type: "ready" });
    x.recv({ type: "key", key: "save" });
    x.recv({ type: "height", px: 200 });
    x.recv({ type: "blur" });
    x.recv({ type: "error", message: "boom" });
    expect(x.log).toEqual(["save", "height 200", "blurred", "failed boom"]);
  });

  it("file 이 없으면 denied", () => {
    const x = setup();
    x.recv({ type: "ready" });
    x.recv({ type: "fileWrite", req: 4, bytes: new Uint8Array([1]), baseHash: "a".repeat(64) });
    x.recv({ type: "fileRead", req: 5 });
    expect(x.posted.slice(2)).toEqual([
      { kw: "kw1", id: ID, type: "reply", req: 4, ok: false, error: "denied" },
      { kw: "kw1", id: ID, type: "reply", req: 5, ok: false, error: "denied" },
    ]);
  });

  it("file 이 있으면 핸들로, 거절은 code", async () => {
    const file = {
      read: async () => ({ bytes: new Uint8Array([1]), hash: "h" }),
      write: async () => {
        throw new DataFileError("conflict");
      },
    } as unknown as DataFileHandle;
    const x = setup({ file });
    x.recv({ type: "ready" });
    x.recv({ type: "fileRead", req: 0 });
    x.recv({ type: "fileWrite", req: 1, bytes: new Uint8Array([2]), baseHash: "a".repeat(64) });
    await tick();
    expect(x.posted.slice(2)).toEqual([
      { kw: "kw1", id: ID, type: "reply", req: 0, ok: true, value: { bytes: new Uint8Array([1]), hash: "h" } },
      { kw: "kw1", id: ID, type: "reply", req: 1, ok: false, error: "conflict" },
    ]);
  });

  it("두 번째 ready → navigated 한 번, 다시 load 하지 않고 그 뒤 아무것에도 답하지 않는다(C2)", async () => {
    const file = { read: async () => ({ bytes: new Uint8Array([1]), hash: "h" }) } as unknown as DataFileHandle;
    const x = setup({ file });
    x.recv({ type: "ready" });
    x.recv({ type: "fileRead", req: 0 });
    x.recv({ type: "ready" });
    x.recv({ type: "ready" });
    x.recv({ type: "registered" });
    x.recv({ type: "fileRead", req: 1 });
    x.recv({ type: "setState", patch: { n: 9 } });
    x.host.update();
    await tick();
    expect(x.log).toEqual(["navigated"]);
    expect(x.posted.map((m) => m.type)).toEqual(["load", "load"]);
  });

  it("update: ctx, 언어가 바뀌었을 때만 messages", () => {
    let lang = "en";
    const base: WidgetContext = { state: {}, editing: false, editable: true, display: "block", lang: "en", theme: {}, readOnly: false };
    const x = setup({ ctx: () => ({ ...base, lang }) });
    x.recv({ type: "ready" });
    x.recv({ type: "registered" });
    x.host.update();
    expect(x.posted.at(-1)).toEqual({ kw: "kw1", id: ID, type: "update", ctx: base });
    lang = "ko";
    x.host.update();
    expect(x.posted.at(-1)).toMatchObject({ type: "update", ctx: { lang: "ko" }, messages: [{ messages: { a: "A" }, locale: "en" }] });
    x.host.update();
    expect("messages" in x.posted.at(-1)!).toBe(false);
  });
});
