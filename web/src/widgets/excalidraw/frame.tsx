import { installFontShim } from "./fontShim";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WidgetApi, WidgetContext, WidgetRender } from "../types";
import { escapeAction, keepsWriting, parseScene, SceneGate, sceneKey } from "./scene";
import { isDark } from "./theme";

/**
 * 내장 위젯 Excalidraw 의 iframe 묶음(IIFE — web/frameBuild.ts). 런타임이 먼저 돌고 이 묶음이 keyringWidgetRegister 를 부른다.
 * Excalidraw 는 render 안에서 import() 한다 — 그래야 모듈이 돌 때(글꼴 FontFace 를 만들 때) 부모가 건넨 글꼴 바이트(init)가 이미 있다.
 */
installFontShim((rel) => window.keyringWidgetFonts?.[rel]);
/** 메모리에만 두는 Storage — 샌드박스(allow-same-origin 없음)에서는 localStorage 를 읽기만 해도 던져 Excalidraw 가 오류를 낸다. 위젯 상태는 데이터 파일에만 남는다 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
for (const name of ["localStorage", "sessionStorage"] as const) {
  try {
    void window[name];
  } catch {
    Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
  }
}
// srcdoc 에서는 location.origin 이 "null" 이라 이것이 없으면 파일의 source 가 열 때마다 달라진다
(window as unknown as Record<string, unknown>).EXCALIDRAW_EXPORT_SOURCE = "keyring-notes";

const langCode = (lang: string) => (lang.toLowerCase().startsWith("ko") ? "ko-KR" : "en");

function line(el: HTMLElement, text: string) {
  const p = document.createElement("p");
  p.style.cssText = "margin:0;padding:8px 12px;font:14px system-ui,sans-serif;color:var(--danger,#c00)";
  p.textContent = text;
  el.replaceChildren(p);
}

async function start(el: HTMLElement, first: WidgetContext, api: WidgetApi, onCtx: (cb: (c: WidgetContext) => void) => void): Promise<() => void> {
  const maybe = api.file;
  if (!maybe) {
    line(el, api.t("noFile"));
    return () => {};
  }
  const file = maybe;
  let read: { bytes: Uint8Array; hash: string };
  try {
    read = await file.read();
  } catch {
    // 「파일 없음」 은 호스트가 그 자리를 바꾼다. 그 밖(오프라인 등)은 여기 한 줄
    line(el, api.t("readFailed"));
    return () => {};
  }
  const scene = parseScene(read.bytes);
  if (!scene) {
    // 깨진 파일에는 쓰지 않는다
    line(el, api.t("badScene"));
    return () => {};
  }
  const lib = await import("@excalidraw/excalidraw");
  const { Excalidraw, restore, serializeAsJSON, getSceneVersion, FONT_FAMILY } = lib;
  const restored = restore(scene as Parameters<typeof restore>[0], null, null);
  // 기준선은 첫 onChange 가 아니라 불러온 장면 — 첫 onChange 가 사용자의 획이면 그 획이 기준이 되어 쓰이지 않는다
  const gate = new SceneGate(
    sceneKey(getSceneVersion(restored.elements), Object.keys(restored.files), restored.appState as Record<string, unknown>),
    serializeAsJSON(restored.elements, restored.appState, restored.files, "local"),
  );
  let base = read.hash;
  let stopped = false;
  const enc = new TextEncoder();

  // Excalidraw 가 Esc 를 처리하기 전(capture)에 상태를 보고(escapeAction): 고른 것만 남았으면 위젯이 풀고, 할 일이 없으면 전체 화면을 닫는다.
  // 글 편집·한글 조합 중 Esc 는 Excalidraw 에 맡긴다(조합 중이면 아예 보지 않는다)
  let excalidrawApi: { getAppState(): object; updateScene(s: { appState: object }): void } | null = null;
  let fullscreen = !!first.fullscreen;
  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.isComposing || e.keyCode === 229 || !excalidrawApi) return;
    const action = escapeAction(excalidrawApi.getAppState() as Record<string, unknown>);
    if (action === "clearSelection") {
      e.preventDefault();
      excalidrawApi.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } });
    } else if (action === "close" && fullscreen && api.toggleFullscreen) api.toggleFullscreen();
  };
  window.addEventListener("keydown", onEsc, true);

  function App() {
    const [c, setC] = useState(first);
    useEffect(() => onCtx((n) => ((fullscreen = !!n.fullscreen), setC(n))), []);
    const readOnly = !c.editable || c.readOnly;
    return (
      <div style={{ height: c.fullscreen ? "100vh" : "480px" }}>
        <Excalidraw
          initialData={{
            elements: restored.elements,
            // 새 글의 기본 글꼴은 Virgil — Excalifont·Liberation 은 라이선스가 확인되지 않아 싣지 않는다(vite.config.ts 의 fontsSkip, 사용자 결정)
            appState: { ...restored.appState, currentItemFontFamily: FONT_FAMILY.Virgil },
            files: restored.files,
            scrollToContent: true,
          }}
          viewModeEnabled={readOnly}
          theme={isDark(c.theme["--bg"]) ? "dark" : "light"}
          langCode={langCode(c.lang)}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }}
          // 요소 링크로 iframe 이 다른 곳으로 옮겨 가지 않게(옮기면 부모가 위젯을 멈춘다)
          onLinkOpen={(_el, e) => e.preventDefault()}
          excalidrawAPI={(a) => (excalidrawApi = a)}
          onChange={(elements, appState, files) => {
            if (stopped || readOnly) return;
            const text = gate.next(sceneKey(getSceneVersion(elements), Object.keys(files), appState as unknown as Record<string, unknown>), () =>
              serializeAsJSON(elements, appState, files, "local"),
            );
            if (text === null) return;
            file.write(enc.encode(text), base).then(
              (r) => (base = r.hash),
              // 거절(다른 칸이 먼저 씀·충돌)이면 그리기를 멈추고 호스트가 다시 그리기를 기다린다. 오프라인(failed)은 이어서 쓴다(keepsWriting)
              (e) => {
                if (!keepsWriting(e)) stopped = true;
              },
            );
          }}
        />
      </div>
    );
  }

  const root = createRoot(el);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return () => {
    window.removeEventListener("keydown", onEsc, true);
    root.unmount();
  };
}

const render: WidgetRender = (el, ctx, api) => {
  const listeners = new Set<(c: WidgetContext) => void>();
  api.onUpdate((c) => listeners.forEach((cb) => cb(c)));
  let cleanup: (() => void) | null = null;
  let dead = false;
  void start(el, ctx, api, (cb) => {
    listeners.add(cb);
  }).then(
    (c) => (dead ? c() : (cleanup = c)),
    // 묶음·장면 오류로 그리지 못하면 조용히 빈칸으로 두지 않는다
    (e) => {
      console.error(e);
      if (!dead) line(el, api.t("failed"));
    },
  );
  return () => {
    dead = true;
    cleanup?.();
  };
};

window.keyringWidgetRegister?.(render);
