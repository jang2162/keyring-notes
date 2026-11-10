import { THEME_TOKEN_NAMES } from "./themeTokens";
import { startFrameRuntime, type FrameEnv } from "./runtime";

/**
 * iframe 런타임 묶음의 진입(IIFE — web/frameBuild.ts). 부트스트랩이 blob: 스크립트로 돌리고, 바로 다음 load 의 위젯 코드가
 * self.keyringWidgetRegister(render) 를 부른다. 인스턴스 id 는 호스트가 이 글 앞에 심는다(host.ts).
 */
declare global {
  interface Window {
    keyringWidgetId?: string;
    /** 부모가 건넨 글꼴 바이트(init) — 키는 글꼴 폴더 기준 경로 */
    keyringWidgetFonts?: Record<string, ArrayBuffer>;
    keyringWidgetRegister?: (render: Parameters<ReturnType<typeof startFrameRuntime>["register"]>[0]) => void;
  }
}

function domFrameEnv(w: Window): FrameEnv {
  const doc = w.document;
  doc.documentElement.style.margin = "0";
  doc.body.style.margin = "0";
  const root = doc.createElement("div");
  root.className = "kw-frame-root";
  doc.body.append(root);
  const parent = w.parent;
  return {
    id: w.keyringWidgetId ?? "",
    post: (msg, transfer) => parent.postMessage(msg, "*", transfer ?? []),
    listen: (cb) =>
      w.addEventListener("message", (e) => {
        if (e.source === parent) cb(e.data);
      }),
    root,
    setTheme: (theme) => {
      for (const k of THEME_TOKEN_NAMES) if (theme[k]) doc.documentElement.style.setProperty(k, theme[k]!);
      doc.documentElement.style.color = theme["--fg"] ?? "";
    },
    addCss: (css) => {
      const style = doc.createElement("style");
      style.textContent = css;
      doc.head.append(style);
    },
    setFonts: (fonts) => {
      // 키 = 글꼴 폴더 기준 경로(<family 폴더>/<file>.woff2). 글꼴 이름·unicode-range 는 위젯이 안다 — 여기서 FontFace 로 등록하면
      // 폴더 이름이 글꼴 이름과 다르고(Lilita ↔ Lilita One) 범위 없는 얼굴이 겹친다. 바이트만 두고 위젯이 쓴다(excalidraw/fontShim.ts)
      w.keyringWidgetFonts = fonts;
    },
    observeHeight: (cb) => {
      let last = -1;
      const ro = new ResizeObserver(() => {
        const px = Math.ceil(root.getBoundingClientRect().height);
        if (px !== last) cb((last = px));
      });
      ro.observe(root);
    },
    // capture 단계에서 받는다: 위젯(Excalidraw)이 keydown 을 창까지 올려 보내지 않아 거품 단계에서는 Esc 를 못 받는다.
    // Mod+S 는 그 자리에서(브라우저 「페이지 저장」 을 막아야 한다), 나머지는 디스패치가 끝난 뒤(setTimeout 0 — 마이크로태스크는
    // 리스너 사이에 돌아 위젯보다 먼저 판정한다)에 위젯이 처리했는지(defaultPrevented)를 본다
    onKey: (cb) =>
      w.addEventListener(
        "keydown",
        (e) => {
          const mod = e.metaKey || e.ctrlKey;
          const snap = { key: e.key, isComposing: e.isComposing, keyCode: e.keyCode, mod, preventDefault: () => e.preventDefault() };
          if (mod && (e.key === "s" || e.key === "S")) return cb({ ...snap, defaultPrevented: e.defaultPrevented });
          setTimeout(() => cb({ ...snap, defaultPrevented: e.defaultPrevented }), 0);
        },
        true,
      ),
    onBlur: (cb) => w.addEventListener("blur", cb),
  };
}

const runtime = startFrameRuntime(domFrameEnv(window));
window.keyringWidgetRegister = (render) => runtime.register(render);
