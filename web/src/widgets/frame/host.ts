import type { DataFileHandle } from "../dataFile";
import type { WidgetSession } from "../session";
import type { WidgetContext } from "../types";
import type { MessageChain } from "../widgetT";
import { KW, type FrameMsg, type HostMsg, type ReplyError } from "./protocol";

/**
 * iframe 연결의 부모 쪽(DOM 없음). 메시지 → 1단계 WidgetSession·데이터 파일 핸들. 출처·창 검사는 mountFrame 이 하고
 * 여기에는 parseFrameMsg 를 지난 것만 온다.
 */
export interface FrameHostOptions {
  id: string;
  post(msg: HostMsg, transfer?: Transferable[]): void;
  session: WidgetSession;
  ctx(): WidgetContext;
  messages(): MessageChain;
  file: DataFileHandle | null;
  fullscreen: { toggle(): void; on(): boolean; exit(): void } | null;
  height(px: number): void;
  blurred(): void;
  save(): void;
  failed(message: string): void;
  /** 두 번째 ready — 문서가 바뀌었다(C2). 그 뒤 아무 메시지에도 답하지 않는다 */
  navigated(): void;
  code: { runtime: string; widget: string; css: string; fonts: Record<string, ArrayBuffer> };
}

const replyCode = (e: unknown): ReplyError => {
  const c = (e as { code?: unknown } | null)?.code;
  return c === "missing" || c === "conflict" || c === "failed" ? c : "failed";
};

export class FrameHost {
  private readies = 0;
  private inited = false;
  private dead = false;
  private lang: string | null = null;

  constructor(private o: FrameHostOptions) {}

  receive(msg: FrameMsg): void {
    if (this.dead) return;
    const o = this.o;
    if (msg.type === "ready") {
      if (this.readies++ > 0) {
        this.dead = true;
        o.navigated();
        return;
      }
      // 런타임과 위젯을 연달아 보낸다 — 부트스트랩이 async=false 로 붙여 이 순서로 돈다. 런타임은 registered 전에 아무것도
      // 보내지 않으므로 위젯을 런타임 메시지를 기다려 보내면 교착이다
      o.post({ kw: KW, type: "load", code: `self.keyringWidgetId=${JSON.stringify(o.id)};\n${o.code.runtime}` });
      o.post({ kw: KW, type: "load", code: o.code.widget });
      return;
    }
    // ready 전에 온 것은 부트스트랩이 보낸 것이 아니다
    if (this.readies === 0) return;
    const s = o.session;
    switch (msg.type) {
      case "registered": {
        if (this.inited) return;
        this.inited = true;
        const ctx = o.ctx();
        this.lang = ctx.lang;
        o.post({
          kw: KW,
          id: o.id,
          type: "init",
          ctx,
          messages: o.messages(),
          css: o.code.css,
          fonts: o.code.fonts,
          file: o.file !== null,
          fullscreen: o.fullscreen !== null,
        });
        return;
      }
      case "height":
        return o.height(msg.px);
      case "setState":
        return s.setState(msg.patch);
      case "requestEdit":
        return s.requestEdit();
      case "exitEdit":
        return s.exitEdit(msg.apply);
      case "fileRead":
        return this.answer(msg.req, () => o.file!.read());
      case "fileWrite":
        return this.answer(msg.req, () => o.file!.write(msg.bytes, msg.baseHash));
      case "toggleFullscreen":
        return o.fullscreen?.toggle();
      case "key":
        if (msg.key === "save") return o.save();
        // 전체 화면이면 닫기만 — 수정 중 초안은 그대로 둔다
        if (o.fullscreen?.on()) return o.fullscreen.exit();
        s.escape();
        return;
      case "blur":
        return o.blurred();
      case "error":
        return o.failed(msg.message);
    }
  }

  private answer(req: number, run: () => Promise<unknown>): void {
    const o = this.o;
    if (!o.file) {
      o.post({ kw: KW, id: o.id, type: "reply", req, ok: false, error: "denied" });
      return;
    }
    run().then(
      (value) => {
        if (!this.dead) o.post({ kw: KW, id: o.id, type: "reply", req, ok: true, value });
      },
      (e) => {
        if (!this.dead) o.post({ kw: KW, id: o.id, type: "reply", req, ok: false, error: replyCode(e) });
      },
    );
  }

  /** ctx·(언어가 바뀌었으면) messages 를 보낸다 */
  update(): void {
    if (this.dead || !this.inited) return;
    const o = this.o;
    const ctx = o.ctx();
    if (ctx.lang !== this.lang) {
      this.lang = ctx.lang;
      o.post({ kw: KW, id: o.id, type: "update", ctx, messages: o.messages() });
    } else o.post({ kw: KW, id: o.id, type: "update", ctx });
  }

  /** 이 인스턴스에 더 답하지 않는다(iframe 을 지울 때) */
  kill(): void {
    this.dead = true;
  }
}
