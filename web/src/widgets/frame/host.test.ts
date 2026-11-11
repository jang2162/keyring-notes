import { describe, expect, it, vi } from "vitest";
import { DataFileError, type DataFileHandle } from "../dataFile";
import { FRAME_REGISTER_TIMEOUT_MS } from "./layout";
import { WidgetSession } from "../session";
import type { WidgetContext } from "../types";
import { FrameHost, type FrameHostOptions } from "./host";
import type { FrameMsg, HostMsg } from "./protocol";

const ID = "w1";

function setup(
  over: Partial<FrameHostOptions> = {},
  sessionInit: ConstructorParameters<typeof WidgetSession>[0] = { state: { n: 1 }, editable: true, readOnly: false },
) {
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
    failed: (m, phase) => void log.push(phase ? `failed ${m} ${phase}` : `failed ${m}`),
    navigated: () => void log.push("navigated"),
    builtIn: true,
    migrated: (s) => void log.push(`migrated ${JSON.stringify(s)}`),
    registerTimeout: () => void log.push("timeout"),
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
    expect(x.posted.at(-1)).toEqual({ kw: "kw1", id: ID, type: "update", ctx: base, from: 1, version: 1, seq: 2 });
    lang = "ko";
    x.host.update();
    expect(x.posted.at(-1)).toMatchObject({ type: "update", ctx: { lang: "ko" }, messages: [{ messages: { a: "A" }, locale: "en" }] });
    x.host.update();
    expect("messages" in x.posted.at(-1)!).toBe(false);
  });
});

describe("iframe 호스트 — 상태의 판·seq·등록 시한", () => {
  const old = { state: { n: 1 }, editable: true, readOnly: false, version: 2, from: 1 };
  const migratedLog = (log: string[]) => log.filter((l) => l.startsWith("migrated"));

  it("init·update 에 세션의 판·위젯 판·늘어나는 seq", () => {
    const x = setup({}, old);
    x.recv({ type: "ready" });
    x.recv({ type: "registered" });
    expect(x.posted.at(-1)).toMatchObject({ type: "init", from: 1, version: 2, seq: 1 });
    x.host.update();
    expect(x.posted.at(-1)).toMatchObject({ type: "update", from: 1, version: 2, seq: 2 });
  });

  it("늦게 온 앞 보냄의 migrated 는 버리고, 마지막 seq 에 처음 온 것만 받는다", () => {
    const x = setup({}, old);
    x.recv({ type: "ready" });
    x.recv({ type: "registered" });
    x.session.external({ n: 4 }, true, 1);
    x.host.update();
    x.recv({ type: "migrated", state: { count: 1 }, seq: 1 });
    expect(migratedLog(x.log)).toEqual([]);
    x.recv({ type: "migrated", state: { count: 4 }, seq: 2 });
    expect(migratedLog(x.log)).toEqual(['migrated {"count":4}']);
    x.recv({ type: "migrated", state: { count: 5 }, seq: 2 });
    expect(migratedLog(x.log)).toHaveLength(1);
  });

  it("마지막 보냄의 from 이 위젯 판과 같으면 그 seq 의 migrated 도 버린다", () => {
    const x = setup({}, { ...old, from: 2 });
    x.recv({ type: "ready" });
    x.recv({ type: "registered" });
    x.recv({ type: "migrated", state: { count: 1 }, seq: 1 });
    expect(migratedLog(x.log)).toEqual([]);
  });

  it("error 의 phase migrate 를 넘긴다", () => {
    const x = setup();
    x.recv({ type: "ready" });
    x.recv({ type: "error", message: "bad", phase: "migrate" });
    expect(x.log).toEqual(["failed bad migrate"]);
  });

  it("받은 위젯은 ready 뒤 시한 안에 registered 가 없으면 registerTimeout, 내장은 시한이 없다", () => {
    vi.useFakeTimers();
    try {
      const a = setup({ builtIn: false });
      a.recv({ type: "ready" });
      vi.advanceTimersByTime(FRAME_REGISTER_TIMEOUT_MS - 1);
      expect(a.log).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(a.log).toEqual(["timeout"]);

      const b = setup({ builtIn: false });
      b.recv({ type: "ready" });
      b.recv({ type: "registered" });
      vi.advanceTimersByTime(FRAME_REGISTER_TIMEOUT_MS * 2);
      expect(b.log).toEqual([]);

      const c = setup({ builtIn: true });
      c.recv({ type: "ready" });
      vi.advanceTimersByTime(FRAME_REGISTER_TIMEOUT_MS * 2);
      expect(c.log).toEqual([]);

      const d = setup({ builtIn: false });
      d.recv({ type: "ready" });
      d.host.kill();
      vi.advanceTimersByTime(FRAME_REGISTER_TIMEOUT_MS * 2);
      expect(d.log).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CSS 는 init 메시지로만 건넨다 — 호스트 옵션에 DOM 이 없다", () => {
    const x = setup();
    x.recv({ type: "ready" });
    x.recv({ type: "registered" });
    expect(x.posted.filter((m) => "css" in m).map((m) => m.type)).toEqual(["init"]);
    // 타입으로 지킨다: FrameHostOptions 의 어떤 키도 Document·Element 가 아니다
    const keys: (keyof FrameHostOptions)[] = [
      "id",
      "post",
      "session",
      "ctx",
      "messages",
      "file",
      "fullscreen",
      "height",
      "blurred",
      "save",
      "failed",
      "navigated",
      "code",
      "builtIn",
      "migrated",
      "registerTimeout",
    ];
    expect(keys).toHaveLength(16);
  });
});
