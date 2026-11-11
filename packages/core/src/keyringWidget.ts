/**
 * ```keyring-widget 블록 본문(엄격한 JSON)의 파싱·직렬화·판 올리기.
 * 형식의 정본은 docs/superpowers/specs/2026-11-09-keyring-widget-design.md 「블록 형식」.
 */

import { parseFrontmatter } from "./markdown.js";
import { normalizeVaultPath } from "./paths.js";

export const KEYRING_WIDGET_LANG = "keyring-widget";
export const WIDGET_RESERVED_KEYS = ["widget", "display", "editable", "state"] as const;

export interface WidgetRef {
  id: string;
  version: number;
}

/** id 는 내장 `scope/name` 또는 받은 패키지 `@scope/name`(marketFormat 의 PACKAGE_ID_RE 와 같은 조각 꼴) */
const REF_RE = /^(@?[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/;

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

function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(", ")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${oneLine(v)}`)
      .join(", ")}}`;
  return JSON.stringify(value);
}

/**
 * `": "`·`", "` 꼴 한 줄 JSON. 먼저 JSON.stringify 로 값을 정규화한다 — toJSON(Date 등)·undefined·함수를
 * 여러 줄 꼴(JSON.stringify)과 똑같이 다뤄야 80자 경계를 넘나들어도 같은 상태가 같은 값으로 저장된다.
 */
export function widgetOneLine(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? "null" : oneLine(JSON.parse(json));
}

const ONE_LINE_MAX = 80;

function entriesOf(block: KeyringWidgetBlock): [string, unknown][] {
  const items: [string, unknown][] = [["widget", formatWidgetRef(block.widget)]];
  if (block.display !== undefined) items.push(["display", block.display]);
  if (block.editable !== undefined) items.push(["editable", block.editable]);
  if (block.state !== undefined) items.push(["state", block.state]);
  // JSON.stringify 가 객체에서 버리는 값(undefined·함수·심볼)은 두 꼴 모두 키째 뺀다
  return items.concat(block.extra).filter(([, v]) => JSON.stringify(v) !== undefined);
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
  // state 가 없으면 올릴 것이 없다 — 그릴 때는 호스트가 defaultState() 를 쓴다
  if (from < def.version && def.migrate && block.state !== undefined) return { kind: "ok", state: def.migrate(block.state, from), migrated: true };
  // 판이 낮은데 migrate 가 없으면 호환으로 본다 — 다음 적용 때 위젯 판으로 쓴다(설계 「블록 형식」).
  return { kind: "ok", state: block.state, migrated: false };
}

/** 적용 때: 상태를 바꾸고 판을 version 으로. display·editable·extra 는 그대로 */
export function withWidgetState(block: KeyringWidgetBlock, state: unknown, version: number): KeyringWidgetBlock {
  return { ...block, widget: { id: block.widget.id, version }, state, extra: block.extra.slice() };
}

/**
 * 데이터 파일 경로(설계 「데이터 파일(큰 상태)」). 정규형 = normalizeVaultPath 를 거쳐도 그대로인 볼트 상대 경로 —
 * `..`·절대·숨김·빈 칸·백슬래시를 고쳐 주지 않고 거절해야 위젯이 블록에 적힌 것과 다른 파일을 읽지 않는다.
 * ext 는 대소문자를 가리지 않고, ext 만으로 된 이름(".excalidraw.json")은 숨김이라 정규형에서 걸린다.
 */
export function widgetDataPath(state: unknown, ext?: string): string | null {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return null;
  const file = (state as Record<string, unknown>).file;
  if (typeof file !== "string") return null;
  try {
    if (normalizeVaultPath(file) !== file) return null;
  } catch {
    return null;
  }
  if (ext !== undefined && !(file.length > ext.length && file.toLowerCase().endsWith(ext.toLowerCase()))) return null;
  return file;
}

/** links.ts 의 FENCE_RE 와 같은 규칙(0~3칸 들여쓰기) — rewriteLinks 가 펜스로 보는 것과 어긋나면 이동 때 경로를 놓친다 */
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** 프런트매터 밖의 닫힌 keyring-widget 펜스 본문(여는 펜스의 들여쓰기만큼 줄 앞 공백을 걷은 것) */
export function keyringWidgetFenceBodies(content: string): string[] {
  const lines = content.split("\n");
  const out: string[] = [];
  let fence: { mark: string; indent: number; widget: boolean; body: string[] } | null = null;
  for (let i = Math.max(parseFrontmatter(content).lines, 0); i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    const f = FENCE_OPEN_RE.exec(line);
    if (fence === null) {
      if (!f) continue;
      const info = f[3]!.trim().split(/\s+/)[0];
      fence = { mark: f[2]![0]!.repeat(f[2]!.length), indent: f[1]!.length, widget: info === KEYRING_WIDGET_LANG, body: [] };
      continue;
    }
    if (f && f[2]!.startsWith(fence.mark)) {
      if (fence.widget) out.push(fence.body.join("\n"));
      fence = null;
      continue;
    }
    if (fence.widget) fence.body.push(line.replace(new RegExp(`^ {0,${fence.indent}}`), ""));
  }
  return out;
}

/** 프런트매터 밖, 닫힌 keyring-widget 펜스의 state.file 중 정규형인 것. 문서 순서, 중복 없음 */
export function widgetFileRefs(content: string): string[] {
  const out = new Set<string>();
  for (const body of keyringWidgetFenceBodies(content)) {
    const r = parseWidgetBlock(body);
    if (!r.ok) continue;
    const p = widgetDataPath(r.block.state);
    if (p !== null) out.add(p);
  }
  return [...out];
}

const FILE_PROP_RE = /"file"\s*:\s*("(?:[^"\\]|\\.)*")/g;

/**
 * state.file 이 from 일 때만, 본문 안 `"file": "<from>"`(이스케이프로 쓴 것 포함)을 모두 to 로. 본문을 다시 직렬화하지 않는다 —
 * 사람이 쓴 모양을 지킨다. 같은 값의 다른 "file" 키도 바꾸는 것은 같은 첨부를 가리키는 키가 옛 경로로 남지 않게.
 * count 는 펜스 하나라 1.
 */
export function rewriteWidgetFileRefs(body: string, from: string, to: string): { body: string; count: number } | null {
  const r = parseWidgetBlock(body);
  if (!r.ok || widgetDataPath(r.block.state) !== from) return null;
  const next = body.replace(FILE_PROP_RE, (all, lit: string) => {
    let v: unknown;
    try {
      v = JSON.parse(lit);
    } catch {
      return all;
    }
    return v === from ? all.slice(0, all.length - lit.length) + JSON.stringify(to) : all;
  });
  return next === body ? null : { body: next, count: 1 };
}
