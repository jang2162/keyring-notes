import { language, t } from "../../i18n";
import { FRAME_DRAIN_MS, type DataFileHandle } from "../dataFile";
import { widgetMessages } from "../messages";
import type { FrameWidgetEntry } from "../registry";
import { focusOutAction, type WidgetSession } from "../session";
import type { WidgetContext } from "../types";
import { frameSrcdoc } from "./bootstrap";
import { FrameHost } from "./host";
import { frameEventAction, frameFocusInside, frameGuard, frameHeight, FRAME_MIN_HEIGHT } from "./layout";
import { parseFrameMsg } from "./protocol";
import { fetchFrameCode, resolveFrameCode } from "./source";

/**
 * keyring-widget iframe 호스트의 DOM 접착. 판단은 layout.ts(높이·포커스·출처·자기 탐색)와 host.ts(메시지 → 세션)가 지고
 * 여기는 잇기만 한다. 규칙의 정본은 계획 docs/superpowers/plans/2026-11-09-keyring-widget-phase2.md Task 8 「접착」.
 */

type Code = { js: string; css: string; fonts: Record<string, ArrayBuffer> };

// 같은 묶음(약 5MB 의 Excalidraw)을 위젯마다 다시 받지 않게 주소로 묶어 둔다. 실패한 것은 지워 다음에 다시 받는다
const codeCache = new Map<string, Promise<Code>>();
function cachedCode(key: string, load: () => Promise<Code>): Promise<Code> {
  let p = codeCache.get(key);
  if (!p) {
    p = load();
    codeCache.set(key, p);
    p.catch(() => codeCache.delete(key));
  }
  return p;
}

async function loadCode(entry: FrameWidgetEntry): Promise<{ runtime: string; widget: Code }> {
  const frames = (await import("virtual:widget-frames")).default;
  const runtimeUrl = frames.runtime?.js;
  if (!runtimeUrl) throw new Error("widget-frame runtime is missing");
  const code = await entry.frame();
  const [runtime, widget] = await Promise.all([
    cachedCode(runtimeUrl, () => resolveFrameCode({ kind: "url", js: runtimeUrl }, fetchFrameCode)),
    code.kind === "url" ? cachedCode(JSON.stringify(code), () => resolveFrameCode(code, fetchFrameCode)) : resolveFrameCode(code, fetchFrameCode),
  ]);
  return { runtime: runtime.js, widget };
}

const hasPopover = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

export function mountFrame(
  content: HTMLElement,
  o: {
    root: HTMLElement;
    entry: FrameWidgetEntry;
    session: WidgetSession;
    ctx(): WidgetContext;
    file: DataFileHandle | null;
    display: "block" | "inline";
    onUpdate(cb: () => void): void;
    /** 그 자리를 오류로 바꾼다 — key 가 없으면 kw.loadFailed */
    failed(key?: string): void;
    /** 포커스가 위젯 밖으로 나감(수정 모드와 상관없이 — 데이터 파일 비우기) */
    focusOut?(): void;
  },
): { destroy(): void } {
  const id = crypto.randomUUID();
  const wrap = document.createElement("div");
  wrap.className = "kw-frame-wrap";
  wrap.style.minHeight = `${FRAME_MIN_HEIGHT}px`;
  content.append(wrap);

  let iframe: HTMLIFrameElement | null = null;
  let win: Window | null = null;
  let host: FrameHost | null = null;
  let fullscreen = false;
  let lastPx = FRAME_MIN_HEIGHT;
  let dead = false;
  let draining = false;
  const guard = frameGuard();

  const applyHeight = () => {
    if (!iframe) return;
    iframe.style.height = fullscreen ? "" : `${frameHeight(lastPx, window.innerHeight, false)}px`;
  };

  const setFullscreen = (on: boolean) => {
    if (on === fullscreen || o.display !== "block") return;
    fullscreen = on;
    if (hasPopover) {
      // popover 속성은 들어갈 때만 단다 — 달려 있으면 닫힌 동안 UA 스타일이 display: none 을 건다
      if (on) {
        wrap.setAttribute("popover", "manual");
        wrap.showPopover();
      } else {
        if (wrap.matches(":popover-open")) wrap.hidePopover();
        wrap.removeAttribute("popover");
      }
    } else wrap.classList.toggle("kw-fixed", on);
    button?.setAttribute("aria-pressed", String(on));
    if (button) button.textContent = t(on ? "kw.exitFullscreen" : "kw.fullscreen");
    applyHeight();
    host?.update();
  };

  let button: HTMLButtonElement | null = null;
  if (o.display === "block") {
    const bar = document.createElement("div");
    bar.className = "kw-frame-bar";
    button = document.createElement("button");
    button.type = "button";
    button.className = "kw-fullscreen-button";
    button.textContent = t("kw.fullscreen");
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => setFullscreen(!fullscreen));
    bar.append(button);
    wrap.append(bar);
  }
  // 전체 화면에서 부모 쪽(단추 등)에 포커스가 있을 때의 Esc. iframe 안 Esc 는 런타임 → 호스트로 온다
  const onWrapKey = (e: KeyboardEvent) => {
    if (fullscreen && e.key === "Escape" && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      setFullscreen(false);
    }
  };
  wrap.addEventListener("keydown", onWrapKey);

  const onResize = () => applyHeight();
  window.addEventListener("resize", onResize);

  const checkFocusOut = () =>
    queueMicrotask(() => {
      if (dead) return;
      const inside = frameFocusInside({ activeInRoot: o.root.contains(document.activeElement), relatedInRoot: false });
      if (focusOutAction({ rootConnected: o.root.isConnected, relatedInside: inside }) !== "apply") return;
      if (o.session.editing) o.session.focusOut();
      o.focusOut?.();
    });

  const removeFrame = () => {
    window.removeEventListener("resize", onResize);
    wrap.removeEventListener("keydown", onWrapKey);
    if (fullscreen) setFullscreen(false);
    iframe?.remove();
    iframe = null;
  };

  const stopListening = () => window.removeEventListener("message", onMessage);

  /** 자기 탐색(C2) 또는 출처가 바뀐 문서 — 지우고 그 인스턴스에는 더 답하지 않는다 */
  const kill = () => {
    if (dead) return;
    dead = true;
    host?.kill();
    stopListening();
    removeFrame();
    o.file?.release();
    o.failed("kw.frameNavigated");
  };

  function onMessage(e: MessageEvent) {
    const action = frameEventAction({ sourceIsFrame: win !== null && e.source === win, origin: e.origin });
    if (action === "ignore") return;
    if (action === "kill") return kill();
    const msg = parseFrameMsg(e.data, id);
    if (!msg) return;
    if (draining) {
      // 지운 iframe 이 이미 보낸 쓰기만 받는다 — 답은 보내지 않는다(받을 문서가 없다)
      if (msg.type === "fileWrite" && o.file) o.file.write(msg.bytes, msg.baseHash).catch(() => {});
      return;
    }
    if (dead) return;
    if (msg.type === "ready" && guard.ready() === "kill") return kill();
    host?.receive(msg);
  }

  o.onUpdate(() => host?.update());

  loadCode(o.entry).then(
    ({ runtime, widget }) => {
      if (dead) return;
      host = new FrameHost({
        id,
        post: (m, transfer) => win?.postMessage(m, "*", transfer ?? []),
        session: o.session,
        ctx: () => ({ ...o.ctx(), fullscreen }),
        messages: () => widgetMessages(o.entry, language()),
        file: o.file,
        fullscreen: o.display === "block" ? { toggle: () => setFullscreen(!fullscreen), on: () => fullscreen, exit: () => setFullscreen(false) } : null,
        height: (px) => {
          lastPx = px;
          applyHeight();
        },
        blurred: checkFocusOut,
        save: () => window.dispatchEvent(new Event("keyring:save")),
        failed: () => {
          if (dead) return;
          dead = true;
          host?.kill();
          stopListening();
          removeFrame();
          o.file?.release();
          o.failed();
        },
        navigated: kill,
        code: { runtime, widget: widget.js, css: widget.css, fonts: widget.fonts },
      });
      const f = document.createElement("iframe");
      f.className = "kw-frame";
      // allow-same-origin·allow-popups·allow-forms 없음, allow 속성 없음, src 없음(계획 Global Constraints)
      f.setAttribute("sandbox", "allow-scripts");
      f.setAttribute("title", o.entry.def.title[language()] ?? o.entry.def.title.en ?? o.entry.def.id);
      f.srcdoc = frameSrcdoc();
      f.style.height = `${FRAME_MIN_HEIGHT}px`;
      f.addEventListener("load", () => {
        if (guard.load() === "kill") kill();
      });
      window.addEventListener("message", onMessage);
      wrap.append(f);
      iframe = f;
      // 붙인 직후 잡아 둔다 — DOM 에서 빠지면 contentWindow 는 null 이 되어 전송 중이던 메시지를 가를 수 없다
      win = f.contentWindow;
    },
    () => {
      if (dead) return;
      dead = true;
      removeFrame();
      o.file?.release();
      o.failed();
    },
  );

  return {
    destroy() {
      if (dead) return;
      dead = true;
      host?.kill();
      removeFrame();
      if (!o.file) return stopListening();
      // 핸들을 곧바로 놓지 않는다: 지운 iframe 이 이미 보낸 fileWrite 를 FRAME_DRAIN_MS 동안 받아 넘기고 놓는다
      draining = true;
      o.file.drain();
      const file = o.file;
      setTimeout(() => {
        stopListening();
        file.release();
      }, FRAME_DRAIN_MS);
    },
  };
}
