import { describe, expect, it } from "vitest";
import { ddayDef } from "../ddayModel";
import { WidgetSession } from "../session";
import type { WidgetApi, WidgetContext } from "../types";
import { bindWidgetApi } from "../widgetApi";
import { FrameHost } from "./host";
import { parseFrameMsg } from "./protocol";
import { startFrameRuntime, type FrameKeyEvent } from "./runtime";

/**
 * 두 연결 같음(설계 「접근 방식」 A안의 대가): 같은 각본을 인라인 연결(bindWidgetApi)과 iframe 연결(런타임 ↔ 호스트,
 * 메모리 통로)에 돌려 세션 호스트 호출과 위젯이 받은 onUpdate 차례가 같은지 본다.
 */
const ID = "eq";
const chain = [{ messages: { a: "A" }, locale: "en" }];

interface Rig {
  api: WidgetApi;
  session: WidgetSession;
  escape(): void;
  calls: unknown[];
  updates: unknown[];
}

async function drain() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function newSession(init: { state: unknown; editable: boolean }, calls: unknown[], changed: () => void) {
  return new WidgetSession(
    { ...init, readOnly: false },
    {
      write: (s) => (calls.push(["write", s]), true),
      startEdit: (d) => void calls.push(["startEdit", d]),
      setDraft: (d) => void calls.push(["setDraft", d]),
      endEdit: () => void calls.push(["endEdit"]),
      changed: () => changed(),
    },
  );
}

function ctxOf(s: WidgetSession): WidgetContext {
  return { state: s.state, editing: s.editing, editable: s.editable, display: ddayDef.display, lang: "en", theme: {}, readOnly: false };
}

function inlineRig(init: { state: unknown; editable: boolean }): Rig {
  const calls: unknown[] = [];
  const updates: unknown[] = [];
  const listeners: ((c: WidgetContext) => void)[] = [];
  const session = newSession(init, calls, () => listeners.forEach((cb) => cb(ctxOf(session))));
  const api = bindWidgetApi({ session, messages: () => chain, listeners, file: null, fullscreen: null });
  api.onUpdate((c) => updates.push([c.state, c.editing]));
  return { api, session, escape: () => void session.escape(), calls, updates };
}

async function frameRig(init: { state: unknown; editable: boolean }): Promise<Rig> {
  const calls: unknown[] = [];
  const updates: unknown[] = [];
  let toFrame: (d: unknown) => void = () => {};
  let key: (e: FrameKeyEvent) => void = () => {};
  const session = newSession(init, calls, () => host.update());
  const host = new FrameHost({
    id: ID,
    post: (m) => queueMicrotask(() => toFrame(structuredClone(m))),
    session,
    ctx: () => ctxOf(session),
    messages: () => chain,
    file: null,
    fullscreen: null,
    height: () => {},
    blurred: () => {},
    save: () => {},
    failed: () => {},
    navigated: () => {},
    code: { runtime: "", widget: "", css: "", fonts: {} },
    builtIn: true,
    migrated: () => {},
    registerTimeout: () => {},
  });
  const rt = startFrameRuntime({
    id: ID,
    post: (m) =>
      queueMicrotask(() => {
        const p = parseFrameMsg(structuredClone(m), ID);
        if (p) host.receive(p);
      }),
    listen: (cb) => void (toFrame = cb),
    root: {} as HTMLElement,
    setTheme: () => {},
    addCss: () => {},
    setFonts: () => {},
    observeHeight: () => {},
    onKey: (cb) => void (key = cb),
    onBlur: () => {},
  });
  host.receive({ type: "ready" });
  let api: WidgetApi | null = null;
  rt.register((_el, _c, a) => {
    api = a;
    a.onUpdate((c) => updates.push([c.state, c.editing]));
    return () => {};
  });
  await drain();
  if (!api) throw new Error("not rendered");
  return {
    api,
    session,
    escape: () => key({ key: "Escape", isComposing: false, keyCode: 27, mod: false, defaultPrevented: false, preventDefault() {} }),
    calls,
    updates,
  };
}

async function script(r: Rig) {
  r.api.requestEdit();
  await drain();
  r.api.setState({ targetDate: "2026-12-24" });
  await drain();
  r.api.setState({ label: "가" });
  await drain();
  r.session.external({ targetDate: "2026-12-25", label: "바깥" }, true);
  await drain();
  r.api.exitEdit(true);
  await drain();
  r.api.requestEdit();
  await drain();
  r.api.setState({ label: "버릴 것" });
  await drain();
  r.escape();
  await drain();
  r.api.requestEdit();
  await drain();
  r.api.setState({ label: "버림" });
  await drain();
  r.api.exitEdit(false);
  await drain();
  r.api.requestEdit();
  await drain();
  r.api.exitEdit(true);
  await drain();
}

async function locked(r: Rig) {
  r.api.setState({ label: "x" });
  await drain();
  r.api.requestEdit();
  await drain();
}

describe("두 연결 같음(D-day)", () => {
  const block = { targetDate: "2026-12-25", label: "" };

  it("수정·바깥 변경·적용·Esc·바꾸지 않은 적용", async () => {
    const a = inlineRig({ state: block, editable: true });
    const b = await frameRig({ state: block, editable: true });
    await script(a);
    await script(b);
    expect(a.calls.length).toBeGreaterThan(5);
    expect(b.calls).toEqual(a.calls);
    expect(b.updates).toEqual(a.updates);
  });

  it("editable: false 블록", async () => {
    const a = inlineRig({ state: block, editable: false });
    const b = await frameRig({ state: block, editable: false });
    await locked(a);
    await locked(b);
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual(a.calls);
    expect(b.updates).toEqual(a.updates);
  });
});
