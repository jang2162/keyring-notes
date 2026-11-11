import type { WidgetContext } from "../types";
import type { MessageChain } from "../widgetT";

/**
 * keyring-widget iframe 과 부모 사이의 메시지. 부트스트랩(bootstrap.ts)·런타임(runtime.ts)·호스트(host.ts)가 함께 쓴다.
 * 부모는 iframe 이 보낸 것을 믿지 않는다 — parseFrameMsg 를 지난 모양만 받는다(제3자 위젯 코드가 같은 창에서 돈다).
 */
export const KW = "kw1";

export type ReplyError = "missing" | "conflict" | "failed" | "denied";

export type HostMsg =
  | { kw: "kw1"; type: "load"; code: string }
  | {
      kw: "kw1";
      id: string;
      type: "init";
      ctx: WidgetContext;
      messages: MessageChain;
      css: string;
      fonts: Record<string, ArrayBuffer>;
      file: boolean;
      fullscreen: boolean;
      /** ctx.state 의 판·위젯 판·보냄 번호 — from < version 이면 런타임이 위젯의 migrate 로 올리고 같은 seq 로 migrated 를 돌려준다 */
      from: number;
      version: number;
      seq: number;
    }
  | { kw: "kw1"; id: string; type: "update"; ctx: WidgetContext; messages?: MessageChain; from: number; version: number; seq: number }
  | { kw: "kw1"; id: string; type: "reply"; req: number; ok: true; value: unknown }
  | { kw: "kw1"; id: string; type: "reply"; req: number; ok: false; error: ReplyError };

export type FrameMsg =
  | { type: "ready" }
  | { type: "registered" }
  | { type: "height"; px: number }
  | { type: "setState"; patch: Record<string, unknown> }
  | { type: "requestEdit" }
  | { type: "exitEdit"; apply: boolean }
  | { type: "fileRead"; req: number }
  | { type: "fileWrite"; req: number; bytes: Uint8Array; baseHash: string }
  | { type: "toggleFullscreen" }
  | { type: "key"; key: "escape" | "save" }
  | { type: "blur" }
  | { type: "migrated"; state: unknown; seq: number }
  | { type: "error"; message: string; phase?: "migrate" };

const MAX_PX = 100_000;
const MAX_MESSAGE = 500;
const HASH_RE = /^[0-9a-f]{64}$/;

const isReq = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** kw·(ready 가 아니면) id 일치·type·필드 타입을 본다. 아니면 null. 돌려주는 것은 알려진 필드만 담은 새 객체 */
export function parseFrameMsg(data: unknown, id: string): FrameMsg | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.kw !== KW) return null;
  if (d.type === "ready") return { type: "ready" };
  if (d.id !== id) return null;
  switch (d.type) {
    case "registered":
    case "requestEdit":
    case "toggleFullscreen":
    case "blur":
      return { type: d.type };
    case "height":
      return typeof d.px === "number" && Number.isFinite(d.px) && d.px >= 0 && d.px <= MAX_PX ? { type: "height", px: d.px } : null;
    case "setState":
      return d.patch !== null && typeof d.patch === "object" && !Array.isArray(d.patch)
        ? { type: "setState", patch: d.patch as Record<string, unknown> }
        : null;
    case "exitEdit":
      return typeof d.apply === "boolean" ? { type: "exitEdit", apply: d.apply } : null;
    case "fileRead":
      return isReq(d.req) ? { type: "fileRead", req: d.req } : null;
    case "fileWrite":
      return isReq(d.req) && d.bytes instanceof Uint8Array && typeof d.baseHash === "string" && HASH_RE.test(d.baseHash)
        ? { type: "fileWrite", req: d.req, bytes: d.bytes, baseHash: d.baseHash }
        : null;
    case "key":
      return d.key === "escape" || d.key === "save" ? { type: "key", key: d.key } : null;
    case "migrated":
      // 모양은 받은 위젯이 정한다(객체가 아니어도 받는다). 믿는 범위(seq)는 호스트가 가른다
      return d.state !== undefined && isReq(d.seq) ? { type: "migrated", state: d.state, seq: d.seq } : null;
    case "error":
      if (typeof d.message !== "string") return null;
      return d.phase === "migrate"
        ? { type: "error", message: d.message.slice(0, MAX_MESSAGE), phase: "migrate" }
        : { type: "error", message: d.message.slice(0, MAX_MESSAGE) };
    default:
      return null;
  }
}
