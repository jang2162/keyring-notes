import { widgetKeyAction } from "../session";
import type { WidgetApi, WidgetContext, WidgetRender } from "../types";
import { widgetT, type MessageChain } from "../widgetT";
import type { FrameMsg, ReplyError } from "./protocol";

/**
 * iframe 연결의 iframe 쪽(DOM 은 env 로 주입 — 시험은 Node 에서 돈다). 위젯 코드와 같은 창에서 돌므로 여기 import 는
 * session.ts 의 widgetKeyAction·widgetT·protocol 형식뿐이다(묶음 크기 상한 — widgetFrames.ts FRAME_RUNTIME_GZIP_LIMIT).
 * 상태는 들고 있지 않는다: api 는 보내기만 하고 화면 상태는 호스트의 update 로 돌아온 ctx 다(인라인 연결과 같은 차례).
 */
export interface FrameKeyEvent {
  key: string;
  isComposing: boolean;
  keyCode: number;
  mod: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export interface FrameEnv {
  /** 이 인스턴스 id — 호스트가 런타임 글 앞에 심어 건넨다(srcdoc 은 해시가 고정이라 거기 둘 수 없다) */
  id: string;
  post(msg: FrameMsg & { kw: "kw1"; id?: string }, transfer?: Transferable[]): void;
  /** e.source === parent 인 것만 넘긴다(env 가 거른다) */
  listen(cb: (data: unknown) => void): void;
  root: HTMLElement;
  setTheme(theme: Record<string, string>): void;
  addCss(css: string): void;
  setFonts(fonts: Record<string, ArrayBuffer>): void;
  /** 올림 정수, 바뀔 때만 */
  observeHeight(cb: (px: number) => void): void;
  /** window keydown, 거품 단계 — 위젯이 처리(preventDefault)했는지 본다 */
  onKey(cb: (e: FrameKeyEvent) => void): void;
  onBlur(cb: () => void): void;
}

export class FrameFileError extends Error {
  constructor(readonly code: ReplyError) {
    super(code);
    this.name = "FrameFileError";
  }
}

export function startFrameRuntime(env: FrameEnv): { register(render: WidgetRender): void } {
  const send = (m: FrameMsg, transfer?: Transferable[]) => env.post({ ...m, kw: "kw1", id: env.id }, transfer);
  let render: WidgetRender | null = null;
  let started = false;
  let chain: MessageChain = [];
  let ctx: WidgetContext | null = null;
  const listeners: ((c: WidgetContext) => void)[] = [];
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  let nextReq = 0;

  const request = <T>(m: FrameMsg & { req: number }, transfer?: Transferable[]) =>
    new Promise<T>((resolve, reject) => {
      pending.set(m.req, { resolve: resolve as (v: unknown) => void, reject });
      send(m, transfer);
    });

  const start = (d: Record<string, unknown>) => {
    if (started || !render) return;
    started = true;
    ctx = d.ctx as WidgetContext;
    chain = d.messages as MessageChain;
    env.setTheme(ctx.theme);
    if (typeof d.css === "string" && d.css) env.addCss(d.css);
    env.setFonts((d.fonts as Record<string, ArrayBuffer>) ?? {});
    const api: WidgetApi = {
      setState: (patch) => send({ type: "setState", patch: { ...(patch as Record<string, unknown>) } }),
      requestEdit: () => send({ type: "requestEdit" }),
      exitEdit: (apply) => send({ type: "exitEdit", apply }),
      t: (k, vars) => widgetT(chain, k, vars),
      onUpdate: (cb) => void listeners.push(cb),
    };
    if (d.file === true)
      api.file = {
        read: () => request({ type: "fileRead", req: nextReq++ }),
        write: (bytes, baseHash) => {
          // 위젯이 쥔 배열을 떼어 가지 않게 사본을 넘긴다
          const copy = bytes.slice();
          return request({ type: "fileWrite", req: nextReq++, bytes: copy, baseHash }, [copy.buffer]);
        },
      };
    if (d.fullscreen === true) api.toggleFullscreen = () => send({ type: "toggleFullscreen" });
    try {
      render(env.root, ctx, api);
    } catch (e) {
      send({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  env.listen((data) => {
    if (data === null || typeof data !== "object") return;
    const d = data as Record<string, unknown>;
    if (d.kw !== "kw1" || d.id !== env.id) return;
    if (d.type === "init") start(d);
    else if (d.type === "update" && started && d.ctx && typeof d.ctx === "object") {
      ctx = d.ctx as WidgetContext;
      if (Array.isArray(d.messages)) chain = d.messages as MessageChain;
      env.setTheme(ctx.theme);
      for (const cb of listeners) cb(ctx);
    } else if (d.type === "reply" && typeof d.req === "number") {
      const p = pending.get(d.req);
      if (!p) return;
      pending.delete(d.req);
      if (d.ok === true) p.resolve(d.value);
      else p.reject(new FrameFileError((d.error as ReplyError) ?? "failed"));
    }
  });
  env.observeHeight((px) => send({ type: "height", px }));
  env.onKey((e) => {
    if (e.mod && (e.key === "s" || e.key === "S")) {
      // 브라우저 「페이지 저장」 대신 앱 저장(노트 저장과 그림 비우기)
      e.preventDefault();
      send({ type: "key", key: "save" });
      return;
    }
    if (widgetKeyAction(e) === "escape" && !e.defaultPrevented) send({ type: "key", key: "escape" });
  });
  env.onBlur(() => send({ type: "blur" }));

  return {
    register(r) {
      if (render) return;
      render = r;
      send({ type: "registered" });
    },
  };
}
