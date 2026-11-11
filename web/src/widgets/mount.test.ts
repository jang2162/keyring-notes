import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetSession } from "./session";

/**
 * mountKeyringWidget 의 접착(세션 옵션)을 실제로 띄워 본다. 시험은 Node(DOM 없음)라 이 파일만 쓰는 최소한의 가짜 DOM 을 두고,
 * iframe 접착(mountFrame)은 받은 세션을 잡아 두는 것으로 바꾼다 — 새 의존성(jsdom)을 들이지 않으려고.
 */
const captured: { session: WidgetSession | null } = { session: null };
vi.mock("./frame/mountFrame", () => ({
  mountFrame: (_content: unknown, o: { session: WidgetSession }) => {
    captured.session = o.session;
    return { destroy() {} };
  },
}));
vi.mock("../api", () => ({ api: {} }));
vi.mock("../toast", () => ({ toast: () => {} }));
vi.mock("../i18n", () => ({ language: () => "en", onLanguageChange: () => () => {}, t: (k: string) => k }));

class FakeEl {
  className = "";
  tabIndex = 0;
  hidden = false;
  textContent = "";
  type = "";
  children: FakeEl[] = [];
  classList = { add() {}, toggle() {}, contains: () => false };
  style: Record<string, string> = {};
  append(...c: unknown[]) {
    for (const x of c) if (x instanceof FakeEl) this.children.push(x);
  }
  replaceChildren(...c: unknown[]) {
    this.children = [];
    this.append(...c);
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  focus() {}
  contains() {
    return false;
  }
  querySelectorAll() {
    return [];
  }
  get isConnected() {
    return true;
  }
}

beforeEach(() => {
  captured.session = null;
  vi.stubGlobal("document", { createElement: () => new FakeEl(), documentElement: new FakeEl(), activeElement: null });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("window", { matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }), dispatchEvent() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("mountKeyringWidget — 받은 위젯의 세션", () => {
  it("받은 위젯의 setState({ file }) 는 블록의 file 로 쓰인다", async () => {
    const { resetWidgetsForTest, setMarketWidgets } = await import("./registry");
    const { mountKeyringWidget } = await import("./mount");
    resetWidgetsForTest();
    setMarketWidgets([
      {
        def: { id: "@me/s", version: 1, isolation: "frame", display: "block", defaultState: () => ({}), title: { en: "S" } },
        builtIn: false,
        messages: {},
        frame: async () => ({ kind: "text", js: "" }),
      },
    ]);
    const writes: unknown[] = [];
    const m = mountKeyringWidget(new FakeEl() as unknown as HTMLElement, {
      body: '{"widget": "@me/s@1", "state": {"file": "a/s-1.sketch", "k": 0}}',
      readOnly: false,
      owner: "n.md",
      write: (s) => (writes.push(s), true),
      edit: { start() {}, draft() {}, focus() {}, end() {} },
    });
    expect(captured.session).not.toBeNull();
    captured.session!.setState({ file: "b/other.sketch", k: 1 });
    expect(writes).toEqual([{ file: "a/s-1.sketch", k: 1 }]);
    m.destroy();
    resetWidgetsForTest();
  });
});
