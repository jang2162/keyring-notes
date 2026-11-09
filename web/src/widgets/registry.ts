import {
  parseWidgetBlock,
  resolveWidgetState,
  serializeWidgetBlock,
  KEYRING_WIDGET_LANG,
  type KeyringWidgetBlock,
  type WidgetBlockError,
} from "@keyring-notes/core";
import type { WidgetDefinition, WidgetRender } from "./types";

export interface WidgetEntry {
  def: WidgetDefinition;
  /** 앱과 함께 빌드된 코드인가 — 아니면 isolation 과 상관없이 frame 이다 */
  builtIn: boolean;
  /** 메시지 앞머리. api.t(k) = t(`${messages}.${k}`) */
  messages: string;
  /** 위젯 코드는 처음 쓸 때 불러온다 */
  load(): Promise<{ render: WidgetRender }>;
}

const entries: WidgetEntry[] = [];

/** 보안은 잴 수 있는 값이 아니라 출처로만 가른다(설계 「인라인/iframe 기준」 1번) */
export function effectiveIsolation(e: WidgetEntry): "inline" | "frame" {
  return e.builtIn ? e.def.isolation : "frame";
}

/** 같은 id 두 번, 그리고 frame 위젯은 거부한다 — 1단계에는 iframe 호스트가 없다(2단계가 연다) */
export function registerWidget(e: WidgetEntry): void {
  if (findWidget(e.def.id)) throw new Error(`widget ${e.def.id} is already registered`);
  if (effectiveIsolation(e) === "frame") throw new Error(`widget ${e.def.id}: frame widgets are not supported yet`);
  entries.push(e);
}

export function findWidget(id: string): WidgetEntry | null {
  return entries.find((e) => e.def.id === id) ?? null;
}

/** 등록 순서 */
export function widgetList(): WidgetEntry[] {
  return entries.slice();
}

export function resetWidgetsForTest(): void {
  entries.length = 0;
}

/** 「위젯 넣기」 글 — widget·display·state 만 쓴다(editable 은 없으면 true) */
export function widgetInsertText(def: WidgetDefinition): string {
  const body = serializeWidgetBlock({ widget: { id: def.id, version: def.version }, display: def.display, state: def.defaultState(), extra: [] });
  return "```" + KEYRING_WIDGET_LANG + "\n" + body + "\n```";
}

export type WidgetView =
  | { kind: "widget"; entry: WidgetEntry; block: KeyringWidgetBlock; state: unknown; editable: boolean; display: "block" | "inline" }
  | { kind: "error"; key: string; vars?: Record<string, string> };

const ERROR_KEY: Record<WidgetBlockError, WidgetView> = {
  json: { kind: "error", key: "kw.errorJson" },
  notObject: { kind: "error", key: "kw.errorNotObject" },
  noWidget: { kind: "error", key: "kw.errorNoWidget" },
  badWidget: { kind: "error", key: "kw.errorField", vars: { key: "widget" } },
  badDisplay: { kind: "error", key: "kw.errorField", vars: { key: "display" } },
  badEditable: { kind: "error", key: "kw.errorField", vars: { key: "editable" } },
};

/** 블록 본문 → 그릴 것. 오류면 화면 글 키(원문은 호스트가 함께 그린다) */
export function resolveWidgetView(body: string): WidgetView {
  const r = parseWidgetBlock(body);
  if (!r.ok) return ERROR_KEY[r.error];
  const { block } = r;
  const entry = findWidget(block.widget.id);
  if (!entry) return { kind: "error", key: "kw.notFound", vars: { id: block.widget.id } };
  let state: unknown;
  try {
    const resolved = resolveWidgetState(block, entry.def);
    if (resolved.kind === "tooNew") return { kind: "error", key: "kw.tooNew" };
    // state 가 없으면 그릴 때만 기본값을 쓴다 — 파일은 적용 때만 바뀐다
    state = block.state === undefined ? entry.def.defaultState() : resolved.state;
  } catch {
    // 위젯 코드(migrate·defaultState)가 던져도 그 칸의 그리기를 깨지 않는다 — 원문과 오류 한 줄로 고칠 길을 남긴다
    return { kind: "error", key: "kw.migrateFailed" };
  }
  return { kind: "widget", entry, block, state, editable: block.editable ?? true, display: block.display ?? entry.def.display };
}

/**
 * 같은 자리의 위젯 블록이 바뀌었을 때. 같은 위젯이면 세션에 external(DOM·초안을 지킨다),
 * 위젯 id·판정 종류(위젯↔오류)·display(뿌리 클래스가 달라진다)가 바뀌면 다시 그린다.
 */
export function widgetViewChange(prev: WidgetView, next: WidgetView): "external" | "remount" {
  if (prev.kind !== "widget" || next.kind !== "widget") return "remount";
  if (prev.entry !== next.entry || prev.display !== next.display) return "remount";
  return "external";
}
