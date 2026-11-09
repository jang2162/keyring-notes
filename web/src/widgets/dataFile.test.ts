import { sha256Sync } from "@keyring-notes/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDataFile,
  DataFileError,
  dataFileStem,
  discardDataFiles,
  flushDataFiles,
  onDataFilesChange,
  openDataFile,
  READ_DRAIN_WAIT_MS,
  renameDataFileOwner,
  resetDataFilesForTest,
  unsavedDataFiles,
  type DataFileHandle,
  type DataFileIO,
  type DataFileOptions,
  type DataFileStatus,
} from "./dataFile";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const h = (s: string) => sha256Sync(enc(s));
const EXT = ".excalidraw.json";
const P = "a/x.excalidraw.json";

/** 진짜 시간으로 몇 바퀴 — crypto.subtle 같은 타이머 밖 약속이 풀리게 */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

class Clock {
  now = 0;
  private seq = 0;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + ms, fn });
    return id;
  };
  clear = (t: unknown) => {
    this.tasks.delete(t as number);
  };
  async advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.tasks) if (e[1].at <= target && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.tasks.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      await flush();
    }
    this.now = target;
    await flush();
  }
}

type Mode = "ok" | "conflict" | "missing" | "failed" | "hold";

class FakeIO implements DataFileIO {
  files = new Map<string, Uint8Array>();
  calls: string[] = [];
  replaceModes: Mode[] = [];
  createModes: ("ok" | "exists" | "failed")[] = [];
  held: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  constructor(init: Record<string, string> = { [P]: "h0" }) {
    for (const [k, v] of Object.entries(init)) this.files.set(k, enc(v));
  }
  replaces() {
    return this.calls.filter((c) => c.startsWith("replace"));
  }
  creates() {
    return this.calls.filter((c) => c.startsWith("create"));
  }
  async read(path: string) {
    const b = this.files.get(path);
    if (!b) throw new DataFileError("missing");
    return b;
  }
  async replace(path: string, bytes: Uint8Array, baseHash: string) {
    this.calls.push(`replace ${path} ${dec(bytes)} ${baseHash === h("h0") ? "h0" : baseHash.slice(0, 8)}`);
    const mode = this.replaceModes.shift() ?? "ok";
    if (mode === "conflict" || mode === "missing" || mode === "failed") throw new DataFileError(mode);
    const apply = () => {
      this.files.set(path, bytes);
      return { hash: sha256Sync(bytes) };
    };
    if (mode === "hold") return new Promise<{ hash: string }>((resolve, reject) => this.held.push({ resolve: () => resolve(apply()), reject }));
    return apply();
  }
  async create(path: string, bytes: Uint8Array) {
    this.calls.push(`create ${path} ${dec(bytes)}`);
    const mode = this.createModes.shift() ?? (this.files.has(path) ? "exists" : "ok");
    if (mode !== "ok") throw new DataFileError(mode);
    this.files.set(path, bytes);
    return path;
  }
}

let clock: Clock;
function options(over: Partial<DataFileOptions> = {}): DataFileOptions {
  return {
    autosave: () => true,
    delay: () => 1500,
    conflictLabel: () => "충돌 사본",
    held: () => false,
    now: () => new Date("2026-11-09T09:05:00Z"),
    timers: { set: clock.set, clear: clock.clear },
    ...over,
  };
}

function track<T>(p: Promise<T>) {
  const r: { value?: T; error?: unknown; done: boolean } = { done: false };
  p.then(
    (v) => Object.assign(r, { value: v, done: true }),
    (e) => Object.assign(r, { error: e, done: true }),
  );
  return r;
}
const code = (r: { error?: unknown }) => (r.error instanceof DataFileError ? r.error.code : r.error);

function statusOf(handle: DataFileHandle) {
  const s: { last: DataFileStatus | null } = { last: null };
  handle.onStatus((st) => (s.last = st));
  return s;
}

afterEach(() => resetDataFilesForTest());

function setup(over: Partial<DataFileOptions> = {}, init?: Record<string, string>) {
  clock = new Clock();
  const io = new FakeIO(init);
  const opts = options(over);
  const open = (owner = "n.md", path = P) => openDataFile(path, EXT, owner, io, opts);
  return { io, opts, open };
}

describe("모아 쓰기(자동 저장 켬)", () => {
  it("멈춘 뒤 한 번, 마지막 바이트만, 준 적 없는 해시는 충돌", async () => {
    const { io, open } = setup();
    const a = open();
    const r = await a.read();
    expect(dec(r.bytes)).toBe("h0");
    expect(r.hash).toBe(h("h0"));
    const w1 = track(a.write(enc("b1"), r.hash));
    const w2 = track(a.write(enc("b2"), r.hash));
    await clock.advance(1499);
    expect(io.replaces()).toEqual([]);
    await clock.advance(1);
    expect(io.replaces()).toEqual([`replace ${P} b2 h0`]);
    expect(w1.value).toEqual({ hash: h("b2") });
    expect(w2.value).toEqual({ hash: h("b2") });
    const w3 = track(a.write(enc("b3"), h("b2")));
    await flush();
    expect(w3.done).toBe(false);
    const w4 = track(a.write(enc("b4"), "f".repeat(64)));
    await flush();
    expect(code(w4)).toBe("conflict");
    expect(io.creates()).toEqual([`create a/x (충돌 사본 20261109-0905).excalidraw.json b4`]);
    await clock.advance(1500);
    expect(w3.value).toEqual({ hash: h("b3") });
  });

  it("쓰는 중에 받은 것은 내려앉은 뒤 새 head 로 이어 쓴다", async () => {
    const { io, open } = setup();
    const a = open();
    const r = await a.read();
    io.replaceModes.push("hold");
    track(a.write(enc("b2"), r.hash));
    await clock.advance(1500);
    expect(io.replaces()).toHaveLength(1);
    const w3 = track(a.write(enc("b3"), r.hash));
    await flush();
    expect(w3.done).toBe(false);
    io.held[0]!.resolve();
    await clock.advance(1500);
    expect(io.replaces()).toEqual([`replace ${P} b2 h0`, `replace ${P} b3 ${h("b2").slice(0, 8)}`]);
    expect(w3.value).toEqual({ hash: h("b3") });
  });

  it("held 동안은 쓰지 않고 풀린 뒤 다음 지연에 한 번", async () => {
    let held = true;
    const { io, open } = setup({ held: () => held });
    const a = open();
    const r = await a.read();
    track(a.write(enc("b1"), r.hash));
    await clock.advance(5000);
    expect(io.replaces()).toEqual([]);
    held = false;
    await clock.advance(1500);
    expect(io.replaces()).toEqual([`replace ${P} b1 h0`]);
  });

  it("release 하면 타이머를 기다리지 않고 바로 쓰고, 끝나면 표에서 빠진다", async () => {
    const { io, open } = setup();
    const a = open();
    const r = await a.read();
    track(a.write(enc("b1"), r.hash));
    expect(unsavedDataFiles()).toEqual([P]);
    a.release();
    await flush();
    expect(io.replaces()).toEqual([`replace ${P} b1 h0`]);
    expect(unsavedDataFiles()).toEqual([]);
  });
});

describe("자동 저장 끔", () => {
  it("쓰지 않고 남기며 flushDataFiles 가 쓴다", async () => {
    const { io, open } = setup({ autosave: () => false });
    const a = open();
    const s = statusOf(a);
    const r = await a.read();
    track(a.write(enc("b1"), r.hash));
    await clock.advance(60000);
    expect(io.replaces()).toEqual([]);
    expect(s.last?.unsaved).toBe(true);
    expect(unsavedDataFiles()).toEqual([P]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} b1 h0`]);
    expect(s.last?.unsaved).toBe(false);
    expect(unsavedDataFiles()).toEqual([]);
  });

  it("owner 별 비우기·버리기·이름 바꾸기", async () => {
    const Q = "b/y.excalidraw.json";
    const { io, open } = setup({ autosave: () => false }, { [P]: "h0", [Q]: "q0" });
    const a = open("n1.md", P);
    const b = open("n2.md", Q);
    track(a.write(enc("a1"), (await a.read()).hash));
    track(b.write(enc("q1"), (await b.read()).hash));
    expect(await flushDataFiles("n1.md")).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);
    discardDataFiles("n2.md");
    expect(unsavedDataFiles()).toEqual([]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toHaveLength(1);
  });

  it("같은 경로를 두 노트가 열었으면 한 노트를 버려도 바이트는 남는다", async () => {
    const { io, open } = setup({ autosave: () => false });
    const a = open("n1.md");
    open("n2.md");
    track(a.write(enc("a1"), (await a.read()).hash));
    discardDataFiles("n2.md");
    expect(unsavedDataFiles()).toEqual([P]);
    expect(await flushDataFiles("n1.md")).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);
  });

  it("버리기는 그 노트의 바이트를 지운다(쓰지 않는다)", async () => {
    const { io, open } = setup({ autosave: () => false });
    const a = open("n1.md");
    track(a.write(enc("a1"), (await a.read()).hash));
    discardDataFiles("n1.md");
    expect(unsavedDataFiles()).toEqual([]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toEqual([]);
  });

  it("renameDataFileOwner: 노트·폴더 이동", async () => {
    const { io, open } = setup({ autosave: () => false });
    const a = open("n1.md");
    track(a.write(enc("a1"), (await a.read()).hash));
    renameDataFileOwner("n1.md", "m/n1.md");
    expect(await flushDataFiles("n1.md")).toBe(true);
    expect(io.replaces()).toEqual([]);
    expect(await flushDataFiles("m/n1.md")).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);

    const c = open("a/x.md");
    track(c.write(enc("c1"), (await c.read()).hash));
    renameDataFileOwner("a", "b");
    expect(await flushDataFiles("a/x.md")).toBe(true);
    expect(io.replaces()).toHaveLength(1);
    expect(await flushDataFiles("b/x.md")).toBe(true);
    expect(io.replaces()).toHaveLength(2);
  });

  it("onDataFilesChange: 받아들임·내려앉음·실패·버림·사본마다", async () => {
    const { io, open } = setup({ autosave: () => false });
    let n = 0;
    const off = onDataFilesChange(() => n++);
    const a = open();
    const r = await a.read();
    track(a.write(enc("a1"), r.hash));
    await flush();
    const accepted = n;
    expect(accepted).toBeGreaterThan(0);
    await flushDataFiles();
    const landed = n;
    expect(landed).toBeGreaterThan(accepted);
    io.replaceModes.push("failed");
    track(a.write(enc("a2"), h("a1")));
    await flush();
    const accepted2 = n;
    await flushDataFiles();
    const failed = n;
    expect(failed).toBeGreaterThan(accepted2);
    discardDataFiles("n.md");
    const discarded = n;
    expect(discarded).toBeGreaterThan(failed);
    track(a.write(enc("zz"), "f".repeat(64)));
    await flush();
    expect(n).toBeGreaterThan(discarded);
    off();
  });
});

describe("덮어쓰지 않는다 — 충돌 사본", () => {
  it("409 → 쓰지 않은 바이트로 사본, 이름이 있으면 2", async () => {
    const { io, open } = setup();
    const a = open();
    const s = statusOf(a);
    const r = await a.read();
    io.replaceModes.push("conflict");
    io.files.set("a/x (충돌 사본 20261109-0905).excalidraw.json", enc("old"));
    const w = track(a.write(enc("b1"), r.hash));
    await clock.advance(1500);
    expect(code(w)).toBe("conflict");
    expect(io.creates()).toEqual(["create a/x (충돌 사본 20261109-0905).excalidraw.json b1", "create a/x (충돌 사본 20261109-0905 2).excalidraw.json b1"]);
    expect(s.last?.conflictCopy).toBe("a/x (충돌 사본 20261109-0905 2).excalidraw.json");
    expect(s.last?.stale).toBe(true);
    expect(dec(io.files.get(P)!)).toBe("h0");
  });

  it("404 → 같은 사본, missing", async () => {
    const { io, open } = setup();
    const a = open();
    const r = await a.read();
    io.replaceModes.push("missing");
    const w = track(a.write(enc("b1"), r.hash));
    await clock.advance(1500);
    expect(code(w)).toBe("missing");
    expect(io.creates()).toEqual(["create a/x (충돌 사본 20261109-0905).excalidraw.json b1"]);
  });

  it("failed → 바이트를 남기고 혼자 되풀이하지 않으며, 다음 쓰기는 받고 flush 가 다시 쓴다", async () => {
    const { io, open } = setup();
    const a = open();
    const s = statusOf(a);
    const r = await a.read();
    io.replaceModes.push("failed");
    const w = track(a.write(enc("b1"), r.hash));
    await clock.advance(1500);
    expect(code(w)).toBe("failed");
    expect(s.last?.error).toBe("failed");
    expect(unsavedDataFiles()).toEqual([P]);
    await clock.advance(60000);
    expect(io.replaces()).toHaveLength(1);
    const w2 = track(a.write(enc("b2"), r.hash));
    await flush();
    expect(io.creates()).toEqual([]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} b1 h0`, `replace ${P} b2 h0`]);
    expect(w2.value).toEqual({ hash: h("b2") });
    expect(s.last?.error).toBe(null);
  });

  it("read 가 없는 파일 → missing", async () => {
    const { open } = setup({}, {});
    const a = open();
    const s = statusOf(a);
    const r = track(a.read());
    await flush();
    expect(code(r)).toBe("missing");
    expect(s.last?.error).toBe("missing");
  });
});

/** C1 — 같은 판에서 시작한 두 핸들. 다시 붙는 경우(N1) 뒤에도 같은 writer 로 다시 돌린다 */
async function c1Suite(ctx: ReturnType<typeof setup>) {
  const { io, open } = ctx;
  const base = () => io.replaces().length;

  // 내려앉기 전
  {
    const A = open("n.md");
    const B = open("n.md");
    const hA = (await A.read()).hash;
    const hB = (await B.read()).hash;
    let staleB = 0;
    B.onStale(() => staleB++);
    const before = base();
    const createsBefore = io.creates().length;
    track(A.write(enc("a1"), hA));
    expect(staleB).toBe(1);
    const wb = track(B.write(enc("b1"), hB));
    await flush();
    expect(code(wb)).toBe("conflict");
    expect(io.creates().length).toBe(createsBefore + 1);
    expect(io.replaces().length).toBe(before);
    await clock.advance(1500);
    expect(io.replaces().at(-1)).toMatch(new RegExp(`^replace ${P} a1 `));
    A.release();
    B.release();
    await flush();
  }
  // 쓰는 중
  {
    const A = open("n.md");
    const B = open("n.md");
    const hA = (await A.read()).hash;
    const hB = (await B.read()).hash;
    io.replaceModes.push("hold");
    const wa = track(A.write(enc("a2"), hA));
    await clock.advance(1500);
    const wb = track(B.write(enc("b2"), hB));
    await flush();
    expect(code(wb)).toBe("conflict");
    io.held.shift()!.resolve();
    await flush();
    expect(wa.value).toEqual({ hash: h("a2") });
    A.release();
    B.release();
    await flush();
  }
  // 내려앉은 뒤
  {
    const A = open("n.md");
    const B = open("n.md");
    const hA = (await A.read()).hash;
    const hB = (await B.read()).hash;
    let settledB = 0;
    B.onSettled(() => settledB++);
    track(A.write(enc("a3"), hA));
    await clock.advance(1500);
    expect(settledB).toBe(1);
    const wb = track(B.write(enc("bb"), hB));
    await flush();
    expect(code(wb)).toBe("conflict");
    const again = await B.read();
    expect(dec(again.bytes)).toBe("a3");
    const wb2 = track(B.write(enc("bb2"), again.hash));
    await clock.advance(1500);
    expect(wb2.value).toEqual({ hash: h("bb2") });
    A.release();
    B.release();
    await flush();
  }
}

describe("C1 — 두 핸들이 같은 판에서 시작", () => {
  it("내려앉기 전·쓰는 중·내려앉은 뒤 모두 덮어쓰지 않는다", async () => {
    await c1Suite(setup());
  });

  it("N2 — 거절된 쓰기의 사본이 실패해도 원본 경로로 가지 않고 flush 가 사본을 다시 만든다", async () => {
    const { io, open } = setup();
    const A = open();
    const B = open();
    const hA = (await A.read()).hash;
    const hB = (await B.read()).hash;
    track(A.write(enc("a1"), hA));
    io.createModes.push("failed");
    const wb = track(B.write(enc("b1"), hB));
    await flush();
    expect(code(wb)).toBe("conflict");
    expect(unsavedDataFiles()).toEqual([P]);
    await clock.advance(1500);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.creates()).toEqual(["create a/x (충돌 사본 20261109-0905).excalidraw.json b1", "create a/x (충돌 사본 20261109-0905).excalidraw.json b1"]);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);
    expect(unsavedDataFiles()).toEqual([]);
  });

  it("N2 — 409 뒤 사본이 실패해도 원본 경로에 다시 쓰지 않는다", async () => {
    const { io, open } = setup();
    const A = open();
    io.replaceModes.push("conflict");
    io.createModes.push("failed");
    track(A.write(enc("a1"), (await A.read()).hash));
    await clock.advance(1500);
    expect(unsavedDataFiles()).toEqual([P]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);
    expect(io.creates()).toHaveLength(2);
  });

  it("N4 — 다섯 번 받아들여지는 동안 B 의 onStale 한 번, onSettled 는 내려앉은 뒤 한 번", async () => {
    const { open } = setup();
    const A = open();
    const B = open();
    const hA = (await A.read()).hash;
    await B.read();
    let stale = 0;
    let settled = 0;
    B.onStale(() => stale++);
    B.onSettled(() => settled++);
    for (let i = 0; i < 5; i++) track(A.write(enc(`a${i}`), hA));
    await flush();
    expect(stale).toBe(1);
    expect(settled).toBe(0);
    await clock.advance(1500);
    expect(settled).toBe(1);
  });
});

describe("onSettled 는 쓰는 중·쓰지 않은 것이 모두 없어졌을 때만", () => {
  it("쓰는 중에 이어 받은 것이 있으면 첫 쓰기가 내려앉아도 부르지 않는다", async () => {
    const { io, open } = setup();
    const A = open();
    const B = open();
    const h0 = (await A.read()).hash;
    await B.read();
    let settled = 0;
    B.onSettled(() => settled++);
    io.replaceModes.push("hold");
    track(A.write(enc("a1"), h0));
    await clock.advance(1500);
    track(A.write(enc("a2"), h0));
    io.held.shift()!.resolve();
    await flush();
    expect(settled).toBe(0);
    await clock.advance(1500);
    expect(io.replaces()).toHaveLength(2);
    expect(settled).toBe(1);
  });
});

describe("N1 — 다시 붙는 위젯은 사본을 만들지 않는다(끔)", () => {
  it("화면 밖 스크롤: release 뒤 다시 연 핸들이 남은 바이트 위에서 이어 쓴다", async () => {
    const ctx = setup({ autosave: () => false });
    const { io, open } = ctx;
    const A = open();
    const h0 = (await A.read()).hash;
    track(A.write(enc("a1"), h0));
    A.release();
    const C = open();
    const r = await C.read();
    expect(dec(r.bytes)).toBe("a1");
    expect(r.hash).toBe(h0);
    track(C.write(enc("c1"), r.hash));
    await flush();
    expect(io.creates()).toEqual([]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} c1 h0`]);
    C.release();
  });

  it("미리보기 다시 그리기(drain): 늦은 바이트를 받은 뒤 read 가 풀린다, release 뒤 쓰기는 사본", async () => {
    const { io, open } = setup({ autosave: () => false });
    const A = open();
    const h0 = (await A.read()).hash;
    track(A.write(enc("a1"), h0));
    A.drain();
    const C = open();
    const rc = track(C.read());
    await flush();
    expect(rc.done).toBe(false);
    track(A.write(enc("a2"), h0));
    A.release();
    await flush();
    expect(dec(rc.value!.bytes)).toBe("a2");
    track(C.write(enc("c1"), rc.value!.hash));
    await flush();
    expect(io.creates()).toEqual([]);
    const late = track(A.write(enc("a3"), h0));
    await flush();
    expect(code(late)).toBe("conflict");
    expect(io.creates()).toEqual(["create a/x (충돌 사본 20261109-0905).excalidraw.json a3"]);
  });

  it("release 한 핸들의 쓰기는 판이 그대로여도 거절하고 사본으로(R1)", async () => {
    const { io, open } = setup({ autosave: () => false });
    const A = open();
    const h0 = (await A.read()).hash;
    track(A.write(enc("a1"), h0));
    A.release();
    const late = track(A.write(enc("a2"), h0));
    await flush();
    expect(code(late)).toBe("conflict");
    expect(io.creates()).toEqual(["create a/x (충돌 사본 20261109-0905).excalidraw.json a2"]);
    expect(await flushDataFiles()).toBe(true);
    expect(io.replaces()).toEqual([`replace ${P} a1 h0`]);
  });

  it("drain 한 핸들이 release 하지 않으면 READ_DRAIN_WAIT_MS 뒤에 read 가 풀린다", async () => {
    expect(READ_DRAIN_WAIT_MS).toBe(1250);
    const { open } = setup({ autosave: () => false });
    const A = open();
    track(A.write(enc("a1"), (await A.read()).hash));
    A.drain();
    const C = open();
    const rc = track(C.read());
    await clock.advance(1249);
    expect(rc.done).toBe(false);
    await clock.advance(1);
    expect(dec(rc.value!.bytes)).toBe("a1");
  });

  it("전체 화면(핸들 그대로): 연달아 다섯 번 모두 받는다", async () => {
    const { io, open } = setup({ autosave: () => false });
    const A = open();
    const h0 = (await A.read()).hash;
    const ws = [0, 1, 2, 3, 4].map((i) => track(A.write(enc(`a${i}`), h0)));
    await flush();
    expect(ws.every((w) => !w.done)).toBe(true);
    expect(io.creates()).toEqual([]);
    await flushDataFiles();
    expect(ws.every((w) => w.value?.hash === h("a4"))).toBe(true);
  });

  it("세 경우 뒤에도 C1 이 그대로 지켜진다", async () => {
    for (const kind of ["scroll", "drain", "fullscreen"] as const) {
      resetDataFilesForTest();
      const ctx = setup();
      const A = ctx.open();
      const h0 = (await A.read()).hash;
      track(A.write(enc("p1"), h0));
      if (kind === "drain") A.drain();
      if (kind !== "fullscreen") A.release();
      if (kind === "fullscreen") for (let i = 0; i < 4; i++) track(A.write(enc(`p${i + 2}`), h0));
      await clock.advance(1500);
      if (kind === "fullscreen") A.release();
      await flush();
      await c1Suite(ctx);
    }
  });
});

describe("새 파일", () => {
  it("이름이 있으면 무작위를 바꾼다", async () => {
    const { io } = setup({}, { "회의록/_첨부/스케치-3f9a.excalidraw.json": "x" });
    const rand = ["3f9a", "0001"];
    const p = await createDataFile(io, "회의록/_첨부", "스케치", EXT, enc("{}"), () => rand.shift()!);
    expect(p).toBe("회의록/_첨부/스케치-0001.excalidraw.json");
    expect(dec(io.files.get(p)!)).toBe("{}");
  });
  it("폴더가 없으면 볼트 맨 위", async () => {
    const { io } = setup({}, {});
    expect(await createDataFile(io, "", "sketch", EXT, enc("{}"), () => "abcd")).toBe("sketch-abcd.excalidraw.json");
  });
  it("50번 모두 있으면 exists", async () => {
    const { io } = setup({}, { "d/s-0000.excalidraw.json": "x" });
    await expect(createDataFile(io, "d", "s", EXT, enc("{}"), () => "0000")).rejects.toMatchObject({ code: "exists" });
    expect(io.creates()).toHaveLength(50);
  });
  it("dataFileStem 은 첨부 이름과 같은 글자를 거른다", () => {
    expect(dataFileStem("a/b:c")).toBe("a b c");
    expect(dataFileStem(" #스케치^ ")).toBe("스케치");
  });
});
