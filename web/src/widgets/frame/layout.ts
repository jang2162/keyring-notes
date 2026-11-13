import { widgetKeyAction } from "../session";
import { parseFrameMsg, type FrameMsg } from "./protocol";

/** keyring-widget iframe 호스트의 순수 판정(DOM 접착은 mountFrame.ts) */

/** 불러오는 동안의 아래 한도 */
export const FRAME_MIN_HEIGHT = 48;

/** 받은 위젯이 ready 뒤 이 안에 registered 를 보내지 않으면(문법 오류·예외) 그 자리를 kw.loadFailed 로. 내장은 시한이 없다(느린 기기의 큰 묶음) */
export const FRAME_REGISTER_TIMEOUT_MS = 20_000;

/**
 * 위젯 코드를 읽지 못한 자리의 글 키(undefined = kw.loadFailed). market_stale 은 잠금이 바뀌어 붙잡은 판의 코드를 읽지 않은 것 —
 * 적용자가 곧 새 항목으로 알리면 다시 그리므로 「준비하는 중」
 */
export function frameLoadFailedKey(e: unknown): string | undefined {
  return (e as { code?: unknown } | null)?.code === "market_stale" ? "kw.pending" : undefined;
}

/** 전체 화면 = viewport, 아니면 clamp(ceil(px), 48, floor(viewport*0.8)) — 위젯 하나가 화면을 다 덮어 노트 스크롤을 막지 않게 */
export function frameHeight(px: number, viewport: number, fullscreen: boolean): number {
  if (fullscreen) return viewport;
  return Math.min(Math.max(Math.ceil(px), FRAME_MIN_HEIGHT), Math.floor(viewport * 0.8));
}

/**
 * 포커스 아웃 판정의 「안」: 앱 activeElement 가 뿌리 안(그 iframe 포함)이거나 relatedTarget 이 뿌리 안.
 * iframe 으로 포커스가 들어가면 부모 window 에 blur 가 나지만 activeElement 는 그 iframe 이라 안이다.
 * 창 전체가 포커스를 잃을 때(다른 앱으로)도 activeElement 는 그대로라 안으로 본다.
 */
export function frameFocusInside(o: { activeInRoot: boolean; relatedInRoot: boolean }): boolean {
  return o.activeInRoot || o.relatedInRoot;
}

/**
 * 전체 화면에 들어갈 때 포커스를 「전체 화면」 단추로 옮길까: 포커스가 감싸개 밖이면 옮긴다(iframe 안이면 그대로).
 * 부모 쪽 Esc 는 감싸개의 keydown 으로 받는데, macOS WebKit 은 마우스로 누른 <button> 에 포커스를 주지 않아 포커스가 밖(body·위젯 뿌리)에
 * 남고 Esc 가 감싸개에 오지 않는다. popover 에 들어가기 전에 옮겨야 닫을 때(hidePopover) 포커스가 그 단추로 돌아온다 — 들어간 뒤에
 * 옮기면 들어가기 전의 포커스(body 등)로 돌아간다.
 */
export function fullscreenFocusButton(activeInWrap: boolean): boolean {
  return !activeInWrap;
}

/**
 * 전체 화면인 동안 감싸개(단추 등 부모 쪽)에 떨어진 Esc 를 닫기로 받을까. iframe 안 Esc 는 런타임 → 호스트로 온다.
 * 조합 판정은 widgetKeyAction 과 같다 — Safari 는 조합을 끝내는 키를 isComposing false·keyCode 229 로 보낸다.
 */
export function fullscreenWrapEscape(e: { key: string; isComposing: boolean; keyCode: number }, fullscreen: boolean): boolean {
  return fullscreen && widgetKeyAction(e) === "escape";
}

/**
 * 전체 화면인 동안 document 에 올라온 Esc 를 닫기로 받을까 — 감싸개 안의 Esc 는 감싸개가 받으니, 여기는 포커스가 감싸개를 품은 곳
 * (body·위젯 뿌리·편집기)에 떨어졌을 때다(팔레트를 닫은 뒤 등). 다른 요소의 Esc(입력칸·메뉴)와 이미 처리된 Esc 는 건드리지 않고,
 * 모달이 열려 있으면 그 모달 차례다 — 모달은 window 에서 받아 document 보다 늦다. 조합 판정은 fullscreenWrapEscape 와 같다.
 */
export function fullscreenDocEscape(e: {
  key: string;
  isComposing: boolean;
  keyCode: number;
  defaultPrevented: boolean;
  targetHoldsFrame: boolean;
  modalOpen: boolean;
}): boolean {
  return widgetKeyAction(e) === "escape" && !e.defaultPrevented && e.targetHoldsFrame && !e.modalOpen;
}

/**
 * iframe 문서는 srcdoc 하나뿐이어야 한다: 첫 load·첫 ready 는 ok, 두 번째부터 kill(위젯이 자기 iframe 을 다른 주소로 옮김).
 * kill 뒤에는 무엇이든 kill.
 */
export function frameGuard(): { load(): "ok" | "kill"; ready(): "ok" | "kill"; killed(): boolean } {
  let loads = 0;
  let readies = 0;
  let dead = false;
  const check = (n: number) => {
    if (dead || n > 1) {
      dead = true;
      return "kill" as const;
    }
    return "ok" as const;
  };
  return {
    load: () => check(++loads),
    ready: () => check(++readies),
    killed: () => dead,
  };
}

/**
 * 창 message 하나를 어떻게 볼까: source 가 만들 때 잡아 둔 그 iframe 의 창이 아니면 ignore. 맞는데 origin 이 "null"(srcdoc 샌드박스의
 * 불투명 출처)이 아니면 문서가 다른 곳으로 옮겨 간 것이라 kill — 옮겨 간 문서가 load·ready 전에 보낸 첫 메시지부터 막는다.
 */
export function frameEventAction(e: { sourceIsFrame: boolean; origin: string }): "accept" | "ignore" | "kill" {
  if (!e.sourceIsFrame) return "ignore";
  return e.origin === "null" ? "accept" : "kill";
}

export type FrameRoute =
  | { kind: "ignore" }
  | { kind: "kill" }
  /** 지운 iframe 이 drain 창 안에 보낸 쓰기 — 파일 핸들에 넘기고 답하지 않는다 */
  | { kind: "drainWrite"; msg: Extract<FrameMsg, { type: "fileWrite" }> }
  | { kind: "receive"; msg: FrameMsg };

/**
 * mountFrame 이 창 message 하나를 어디로 보낼까(DOM 없는 판정). 순서: 출처(frameEventAction) → 모양(parseFrameMsg) →
 * drain 창이면 fileWrite 만 → 죽었으면 버림 → ready 는 frameGuard(두 번째면 kill) → 호스트로
 */
export function routeFrameMessage(
  e: { sourceIsFrame: boolean; origin: string; data: unknown },
  id: string,
  s: { draining: boolean; dead: boolean; guard: ReturnType<typeof frameGuard> },
): FrameRoute {
  const action = frameEventAction(e);
  if (action !== "accept") return { kind: action };
  const msg = parseFrameMsg(e.data, id);
  if (!msg) return { kind: "ignore" };
  if (s.draining) return msg.type === "fileWrite" ? { kind: "drainWrite", msg } : { kind: "ignore" };
  if (s.dead) return { kind: "ignore" };
  if (msg.type === "ready" && s.guard.ready() === "kill") return { kind: "kill" };
  return { kind: "receive", msg };
}
