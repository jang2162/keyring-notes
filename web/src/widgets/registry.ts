import {
  parseWidgetBlock,
  resolveWidgetState,
  serializeWidgetBlock,
  KEYRING_WIDGET_LANG,
  type KeyringWidgetBlock,
  type WidgetBlockError,
} from "@keyring-notes/core";
import type { WidgetDefinition, WidgetRender } from "./types";

/** 언어 → 키 → 글(키는 앞머리 없이, 복수형 "key#one") — 제3자 위젯이 자기 글을 가져온다 */
export type WidgetMessageTable = Record<string, Record<string, string>>;

/** iframe 에 건넬 코드. url = 앱이 내는 묶음 주소(내장), text = 글 그대로(제3자 — 받기·설치는 마켓플레이스 설계) */
export type FrameCode = { kind: "url"; js: string; css?: string; fonts?: Record<string, string> } | { kind: "text"; js: string; css?: string };

interface EntryBase {
  def: WidgetDefinition;
  /** 앱과 함께 빌드된 코드인가 — 아니면 isolation 과 상관없이 frame 이다 */
  builtIn: boolean;
  /** 앱 메시지 앞머리(내장 — api.t(k) = 앱 글 `${앞머리}.${k}`) 또는 언어별 표(제3자) */
  messages: string | WidgetMessageTable;
}

export interface InlineWidgetEntry extends EntryBase {
  /** 위젯 코드는 처음 쓸 때 불러온다 */
  load(): Promise<{ render: WidgetRender }>;
}

export interface FrameWidgetEntry extends EntryBase {
  /** iframe 에 실을 코드. 처음 쓸 때 부른다 */
  frame(): Promise<FrameCode>;
}

export type WidgetEntry = InlineWidgetEntry | FrameWidgetEntry;

const entries: WidgetEntry[] = [];

/** 보안은 잴 수 있는 값이 아니라 출처로만 가른다(설계 「인라인/iframe 기준」 1번) */
export function effectiveIsolation(e: WidgetEntry): "inline" | "frame" {
  return e.builtIn ? e.def.isolation : "frame";
}

export function isFrameEntry(e: WidgetEntry): e is FrameWidgetEntry {
  return effectiveIsolation(e) === "frame" && typeof (e as Partial<FrameWidgetEntry>).frame === "function";
}

/**
 * 거부하는 것: 같은 id, frame 으로 돌 위젯에 frame() 이 없음, inline 위젯에 load() 가 없음,
 * 제3자가 앱 메시지 앞머리를 씀(앱 글을 읽게 된다), dataFile.ext 가 "." 으로 시작하지 않음
 */
export function registerWidget(e: WidgetEntry): void {
  const id = e.def.id;
  if (findWidget(id)) throw new Error(`widget ${id} is already registered`);
  if (effectiveIsolation(e) === "frame") {
    if (typeof (e as Partial<FrameWidgetEntry>).frame !== "function") throw new Error(`widget ${id}: frame widgets need frame()`);
  } else if (typeof (e as Partial<InlineWidgetEntry>).load !== "function") throw new Error(`widget ${id}: inline widgets need load()`);
  if (!e.builtIn && typeof e.messages === "string") throw new Error(`widget ${id}: third-party widgets bring their own message table`);
  if (e.def.dataFile && !e.def.dataFile.ext.startsWith(".")) throw new Error(`widget ${id}: dataFile.ext must start with "."`);
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

/** 「위젯 넣기」 글 — widget·display·state 만 쓴다(editable 은 없으면 true). state 를 주면 그것으로(데이터 파일 경로를 넣을 때) */
export function widgetInsertText(def: WidgetDefinition, state?: unknown): string {
  const body = serializeWidgetBlock({
    widget: { id: def.id, version: def.version },
    display: def.display,
    state: state === undefined ? def.defaultState() : state,
    extra: [],
  });
  return "```" + KEYRING_WIDGET_LANG + "\n" + body + "\n```";
}

/** 명령 팔레트 「위젯 넣기」 목록. 이름은 화면 언어, 없으면 영어, 없으면 id */
export function widgetPaletteItems(
  lang: string,
  insert: (text: string) => void,
  /** 데이터 파일 위젯 — 있으면 insert 대신 이것이 파일을 만들고 넣는다(Workspace) */
  insertWithFile?: (def: WidgetDefinition) => void,
): { id: string; label: string; detail: string; run: () => void }[] {
  return entries.map((e) => ({
    id: e.def.id,
    label: e.def.title[lang] ?? e.def.title.en ?? e.def.id,
    detail: e.def.id,
    run: () => (e.def.dataFile && insertWithFile ? insertWithFile(e.def) : insert(widgetInsertText(e.def))),
  }));
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
