import {
  PACKAGE_ID_RE,
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
  /** 받은 위젯만 — 같은 객체 판정·이어받기의 키(`id@version#sha`, marketWidgets.ts) */
  pkgKey?: string;
}

export type WidgetEntry = InlineWidgetEntry | FrameWidgetEntry;

/** 받은 위젯이 등록되지 않은 까닭(마켓 위젯 모듈이 답한다). 기본 판정기는 늘 { kind: "notFound", install: false } */
export type MissingWidget =
  | { kind: "notFound"; install: boolean }
  | { kind: "pending" }
  | { kind: "incompatible" }
  | { kind: "failed"; error: { code: string; params: Record<string, string | number> } };

/** registerWidget 으로 넣은 것(내장 — 등록 순서) */
const entries: WidgetEntry[] = [];
/** 받은 위젯 묶음(setMarketWidgets 가 통째로 바꾼다 — 잠금 순서) */
let marketEntries: FrameWidgetEntry[] = [];
const listeners = new Set<() => void>();
let missingResolver: ((id: string) => MissingWidget) | null = null;

/** 보안은 잴 수 있는 값이 아니라 출처로만 가른다(설계 「인라인/iframe 기준」 1번) */
export function effectiveIsolation(e: WidgetEntry): "inline" | "frame" {
  return e.builtIn ? e.def.isolation : "frame";
}

export function isFrameEntry(e: WidgetEntry): e is FrameWidgetEntry {
  return effectiveIsolation(e) === "frame" && typeof (e as Partial<FrameWidgetEntry>).frame === "function";
}

/**
 * 거부하는 것: frame 으로 돌 위젯에 frame() 이 없음, inline 위젯에 load() 가 없음,
 * 제3자가 앱 메시지 앞머리를 씀(앱 글을 읽게 된다), dataFile.ext 가 "." 으로 시작하지 않음,
 * 내장이 `@` 로 시작하는 id·제3자가 패키지 id 가 아닌 id — 두 이름 공간이 겹치지 않아 받은 위젯은 `keyring/…` 자리에 들어갈 수 없다
 */
function checkEntry(e: WidgetEntry): void {
  const id = e.def.id;
  if (e.builtIn ? id.startsWith("@") : !PACKAGE_ID_RE.test(id)) throw new Error(`widget ${id}: id does not match its origin`);
  if (effectiveIsolation(e) === "frame") {
    if (typeof (e as Partial<FrameWidgetEntry>).frame !== "function") throw new Error(`widget ${id}: frame widgets need frame()`);
  } else if (typeof (e as Partial<InlineWidgetEntry>).load !== "function") throw new Error(`widget ${id}: inline widgets need load()`);
  if (!e.builtIn && typeof e.messages === "string") throw new Error(`widget ${id}: third-party widgets bring their own message table`);
  if (e.def.dataFile && !e.def.dataFile.ext.startsWith(".")) throw new Error(`widget ${id}: dataFile.ext must start with "."`);
}

/** 같은 id 도 거부한다 */
export function registerWidget(e: WidgetEntry): void {
  if (findWidget(e.def.id)) throw new Error(`widget ${e.def.id} is already registered`);
  checkEntry(e);
  entries.push(e);
}

/**
 * 받은 위젯 전부를 바꾼다. 같은 def.id 이고 같은 객체면 그대로 — 바뀐 것이 있을 때만 알린다.
 * 항목마다 registerWidget 과 같은 검사를 하고, 하나라도 틀리면 아무것도 바꾸지 않고 던진다
 */
export function setMarketWidgets(list: FrameWidgetEntry[]): void {
  const seen = new Set<string>();
  for (const e of list) {
    if (e.builtIn) throw new Error(`widget ${e.def.id}: market widgets are not built in`);
    checkEntry(e);
    if (seen.has(e.def.id) || entries.some((b) => b.def.id === e.def.id)) throw new Error(`widget ${e.def.id} is already registered`);
    seen.add(e.def.id);
  }
  const same = list.length === marketEntries.length && list.every((e, i) => e === marketEntries[i]);
  if (same) return;
  marketEntries = list.slice();
  notifyWidgetsChanged();
}

/** 이어받기·같은 객체 판정의 키. 내장은 def.id, 받은 위젯은 항목의 pkgKey */
export function widgetEntryKey(e: WidgetEntry): string {
  return (e as Partial<FrameWidgetEntry>).pkgKey ?? e.def.id;
}

export function onWidgetsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** 판정기의 답이 바뀌었을 수 있을 때(마켓 상태 바뀜) — 알림만 */
export function notifyWidgetsChanged(): void {
  // 사본으로 돈다 — 알림 안에서 다시 그린 위젯이 새로 구독해도 이번 알림을 두 번 받지 않게
  for (const fn of Array.from(listeners)) fn();
}

export function setMissingWidgetResolver(fn: ((id: string) => MissingWidget) | null): void {
  missingResolver = fn;
}

export function findWidget(id: string): WidgetEntry | null {
  return entries.find((e) => e.def.id === id) ?? marketEntries.find((e) => e.def.id === id) ?? null;
}

/** 내장(등록 순서) → 받은 것(잠금 순서) */
export function widgetList(): WidgetEntry[] {
  return [...entries, ...marketEntries];
}

export function resetWidgetsForTest(): void {
  entries.length = 0;
  marketEntries = [];
  missingResolver = null;
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
  return widgetList().map((e) => ({
    id: e.def.id,
    label: e.def.title[lang] ?? e.def.title.en ?? e.def.id,
    detail: e.def.id,
    run: () => (e.def.dataFile && insertWithFile ? insertWithFile(e.def) : insert(widgetInsertText(e.def))),
  }));
}

export type WidgetView =
  | {
      kind: "widget";
      entry: WidgetEntry;
      block: KeyringWidgetBlock;
      state: unknown;
      /** 지금 state 의 판 — 부모가 올렸거나 기본 상태면 def.version, 받은 위젯은 블록 판(iframe 이 올린다) */
      from: number;
      editable: boolean;
      display: "block" | "inline";
    }
  | {
      kind: "error";
      key: string;
      vars?: Record<string, string>;
      /** 오류 줄 옆 단추(「설치」·「마켓에서 보기」) */
      action?: { kind: "install" | "market"; id: string };
      /** kw.packageFailed 의 까닭 — 화면이 error.<code> 글(params 로 채움)로 {error} 를 채운다 */
      error?: { code: string; params: Record<string, string | number> };
    };

function missingView(id: string): WidgetView {
  const m: MissingWidget = missingResolver?.(id) ?? { kind: "notFound", install: false };
  switch (m.kind) {
    case "notFound":
      return m.install
        ? { kind: "error", key: "kw.notFound", vars: { id }, action: { kind: "install", id } }
        : { kind: "error", key: "kw.notFound", vars: { id } };
    case "pending":
      return { kind: "error", key: "kw.pending" };
    case "incompatible":
      return { kind: "error", key: "kw.needsAppUpdate" };
    case "failed":
      return { kind: "error", key: "kw.packageFailed", error: m.error, action: { kind: "market", id } };
  }
}

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
  if (!entry) return missingView(block.widget.id);
  let state: unknown;
  let from = entry.def.version;
  try {
    // 받은 위젯의 migrate 는 iframe 안에서 돈다 — 부모는 tooNew 만 가르고 블록 상태를 그대로 건넨다
    const resolved = resolveWidgetState(block, entry.builtIn ? entry.def : { version: entry.def.version });
    if (resolved.kind === "tooNew") return { kind: "error", key: "kw.tooNew" };
    // state 가 없으면 그릴 때만 기본값을 쓴다 — 파일은 적용 때만 바뀐다
    if (block.state === undefined) state = entry.def.defaultState();
    else {
      state = resolved.state;
      if (!entry.builtIn) from = block.widget.version;
    }
  } catch {
    // 위젯 코드(migrate·defaultState)가 던져도 그 칸의 그리기를 깨지 않는다 — 원문과 오류 한 줄로 고칠 길을 남긴다
    return { kind: "error", key: "kw.migrateFailed" };
  }
  return { kind: "widget", entry, block, state, from, editable: block.editable ?? true, display: block.display ?? entry.def.display };
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
