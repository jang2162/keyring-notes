/**
 * ```keyring-widget 블록 본문(엄격한 JSON)의 파싱·직렬화·판 올리기.
 * 형식의 정본은 docs/superpowers/specs/2026-11-09-keyring-widget-design.md 「블록 형식」.
 */

export const KEYRING_WIDGET_LANG = "keyring-widget";
export const WIDGET_RESERVED_KEYS = ["widget", "display", "editable", "state"] as const;

export interface WidgetRef {
  id: string;
  version: number;
}

const REF_RE = /^([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/;

export function parseWidgetRef(s: string): WidgetRef | null {
  const m = REF_RE.exec(s);
  if (!m) return null;
  const version = Number(m[2]);
  if (!Number.isSafeInteger(version)) return null;
  return { id: m[1]!, version };
}

export function formatWidgetRef(r: WidgetRef): string {
  return `${r.id}@${r.version}`;
}

export interface KeyringWidgetBlock {
  widget: WidgetRef;
  display?: "block" | "inline";
  editable?: boolean;
  state?: unknown;
  /** 예약 키가 아닌 키, 원래 순서 */
  extra: [string, unknown][];
}

export type WidgetBlockError = "json" | "notObject" | "noWidget" | "badWidget" | "badDisplay" | "badEditable";
export type WidgetBlockParse = { ok: true; block: KeyringWidgetBlock } | { ok: false; error: WidgetBlockError; detail?: string };

const RESERVED = new Set<string>(WIDGET_RESERVED_KEYS);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** body = 펜스 사이 글 */
export function parseWidgetBlock(body: string): WidgetBlockParse {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    return { ok: false, error: "json", detail: e instanceof Error ? e.message : String(e) };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "notObject" };
  const o = raw as Record<string, unknown>;
  if (!has(o, "widget")) return { ok: false, error: "noWidget" };
  const widget = typeof o.widget === "string" ? parseWidgetRef(o.widget) : null;
  if (!widget) return { ok: false, error: "badWidget" };
  const out: KeyringWidgetBlock = { widget, extra: [] };
  if (has(o, "display")) {
    if (o.display !== "block" && o.display !== "inline") return { ok: false, error: "badDisplay" };
    out.display = o.display;
  }
  if (has(o, "editable")) {
    if (typeof o.editable !== "boolean") return { ok: false, error: "badEditable" };
    out.editable = o.editable;
  }
  if (has(o, "state")) out.state = o.state;
  // Object.entries 는 own 키만 돌므로 JSON.parse 가 만든 own "__proto__" 도 잡는다.
  for (const [k, v] of Object.entries(o)) if (!RESERVED.has(k)) out.extra.push([k, v]);
  return { ok: true, block: out };
}

/** `": "`·`", "` 꼴 한 줄 JSON */
export function widgetOneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => widgetOneLine(v === undefined ? null : v)).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const items = Object.entries(value).filter(([, v]) => v !== undefined && typeof v !== "function");
    return `{${items.map(([k, v]) => `${JSON.stringify(k)}: ${widgetOneLine(v)}`).join(", ")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const ONE_LINE_MAX = 80;

function entriesOf(block: KeyringWidgetBlock): [string, unknown][] {
  const items: [string, unknown][] = [["widget", formatWidgetRef(block.widget)]];
  if (block.display !== undefined) items.push(["display", block.display]);
  if (block.editable !== undefined) items.push(["editable", block.editable]);
  if (block.state !== undefined) items.push(["state", block.state]);
  return items.concat(block.extra);
}

/**
 * 펜스 없이, 끝 줄바꿈 없음. 한 줄 꼴이 80자(UTF-16) 이하면 한 줄, 넘으면 2칸 여러 줄.
 * 바깥 층을 객체로 다시 만들지 않는 이유: obj[k] = v 로 채우면 정수꼴 키가 앞으로 가고 "__proto__" 가 사라진다.
 */
export function serializeWidgetBlock(block: KeyringWidgetBlock): string {
  const items = entriesOf(block);
  const one = `{${items.map(([k, v]) => `${JSON.stringify(k)}: ${widgetOneLine(v)}`).join(", ")}}`;
  if (one.length <= ONE_LINE_MAX) return one;
  const lines = items.map(([k, v]) => `  ${JSON.stringify(k)}: ${(JSON.stringify(v, null, 2) ?? "null").replace(/\n/g, "\n  ")}`);
  return `{\n${lines.join(",\n")}\n}`;
}

export type ResolvedWidgetState = { kind: "ok"; state: unknown; migrated: boolean } | { kind: "tooNew" };

export function resolveWidgetState(block: KeyringWidgetBlock, def: { version: number; migrate?(state: unknown, from: number): unknown }): ResolvedWidgetState {
  const from = block.widget.version;
  if (from > def.version) return { kind: "tooNew" };
  if (from < def.version && def.migrate) return { kind: "ok", state: def.migrate(block.state, from), migrated: true };
  // 판이 낮은데 migrate 가 없으면 호환으로 본다 — 다음 적용 때 위젯 판으로 쓴다(설계 「블록 형식」).
  return { kind: "ok", state: block.state, migrated: false };
}

/** 적용 때: 상태를 바꾸고 판을 version 으로. display·editable·extra 는 그대로 */
export function withWidgetState(block: KeyringWidgetBlock, state: unknown, version: number): KeyringWidgetBlock {
  return { ...block, widget: { id: block.widget.id, version }, state, extra: block.extra.slice() };
}
