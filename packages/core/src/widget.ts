import { parse as parseYaml } from "yaml";
import type { DocMeta, TaskRow } from "./types.js";
import { PathError } from "./paths.js";

/**
 * 위젯 블록(```widget) 안의 YAML.
 *
 *   type: query | table | tasks | chart
 *   from: 업무/프로젝트A | "#태그" | [여러 개]     (생략하면 볼트 전체)
 *   where: "status != done" | [조건 여러 개]       (모두 만족)
 *   show: [title, due]
 *   sort: due | -due | "due desc" | [여러 개]
 *   limit: 50
 *   status: open | done | all                       (tasks)
 *   chart: bar | line, x: 필드, y: 필드, agg: sum | count | avg   (chart)
 *   data: [{label, value}]                          (chart, 직접 입력)
 */
export interface WidgetSpec {
  type: "query" | "table" | "tasks" | "chart" | "plugin";
  /** type: plugin일 때 플러그인 이름(plugins/<이름>.js) */
  plugin?: string;
  /** type: plugin일 때 플러그인에 그대로 넘길 설정 */
  options?: Record<string, unknown>;
  from: string[];
  where: Condition[];
  show: string[];
  sort: { field: string; desc: boolean }[];
  limit: number;
  status: "open" | "done" | "all";
  chart: "bar" | "line";
  x?: string;
  y?: string;
  agg: "sum" | "count" | "avg";
  data?: { label: string; value: number }[];
  title?: string;
}

type Op = "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "!contains" | "exists" | "!exists";

interface Condition {
  field: string;
  op: Op;
  value?: unknown;
}

export interface QueryRow {
  path: string;
  title: string;
  values: Record<string, unknown>;
}

export type WidgetResult =
  | { type: "query" | "table"; title?: string; columns: string[]; rows: QueryRow[]; total: number }
  | { type: "tasks"; title?: string; groups: { path: string; title: string; hash: string; tasks: TaskRow[] }[]; total: number }
  | { type: "chart"; title?: string; chart: "bar" | "line"; x: string; y: string; series: { label: string; value: number }[] }
  | { type: "plugin"; plugin: string; options: Record<string, unknown>; title?: string; columns: string[]; rows: QueryRow[]; total: number };

export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

const asList = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (v === "today") return today();
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export function parseCondition(src: string): Condition {
  const s = src.trim();
  if (!s) throw new PathError("빈 조건입니다");
  const m = /^([^\s!=<>]+)\s*(!=|>=|<=|==|=|>|<|\s!?contains\s)\s*(.*)$/.exec(s);
  if (m) {
    const op = (m[2].trim() === "==" ? "=" : m[2].trim()) as Op;
    return { field: m[1], op, value: parseValue(m[3]) };
  }
  if (/^!\S+$/.test(s)) return { field: s.slice(1), op: "!exists" };
  if (/^\S+$/.test(s)) return { field: s, op: "exists" };
  throw new PathError(`조건을 이해할 수 없습니다: ${src}`);
}

export function parseWidget(source: string): WidgetSpec {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    throw new PathError(`위젯 YAML 오류: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PathError("위젯 내용은 YAML 객체여야 합니다");
  const r = raw as Record<string, unknown>;
  const type = (r.type ?? "query") as WidgetSpec["type"];
  if (!["query", "table", "tasks", "chart", "plugin"].includes(type)) throw new PathError(`알 수 없는 위젯 종류입니다: ${String(r.type)}`);
  if (type === "plugin" && (typeof r.plugin !== "string" || !PLUGIN_NAME_RE.test(r.plugin))) {
    throw new PathError("plugin 위젯에는 plugin: <이름>(영문 소문자·숫자·-)이 필요합니다");
  }
  if (r.options !== undefined && (typeof r.options !== "object" || r.options === null || Array.isArray(r.options))) {
    throw new PathError("options는 YAML 객체여야 합니다");
  }
  const sort = asList(r.sort).map((s) => {
    const str = String(s).trim();
    const m = /^(-)?(\S+)(?:\s+(asc|desc))?$/i.exec(str);
    if (!m) throw new PathError(`정렬 기준을 이해할 수 없습니다: ${str}`);
    return { field: m[2], desc: m[1] === "-" || m[3]?.toLowerCase() === "desc" };
  });
  const data = r.data === undefined ? undefined : asList(r.data).map((d) => {
    const o = d as Record<string, unknown>;
    const value = Number(o?.value);
    if (!o || o.label === undefined || Number.isNaN(value)) throw new PathError("data 항목은 {label, value} 형식이어야 합니다");
    return { label: String(o.label), value };
  });
  const status = String(r.status ?? "open");
  if (!["open", "done", "all"].includes(status)) throw new PathError("status는 open, done, all 중 하나입니다");
  const chart = String(r.chart ?? "bar");
  if (!["bar", "line"].includes(chart)) throw new PathError("chart는 bar, line 중 하나입니다");
  const agg = String(r.agg ?? (r.y ? "sum" : "count"));
  if (!["sum", "count", "avg"].includes(agg)) throw new PathError("agg는 sum, count, avg 중 하나입니다");
  const limit = r.limit === undefined ? 100 : Number(r.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new PathError("limit은 1~1000 사이 정수입니다");
  if (type === "chart" && !data && !r.x) throw new PathError("chart 위젯에는 x(묶을 필드) 또는 data가 필요합니다");
  return {
    type,
    from: asList(r.from).map((f) => String(f).trim()).filter(Boolean),
    where: asList(r.where).map((w) => parseCondition(String(w))),
    show: asList(r.show).map(String),
    sort,
    limit,
    status: status as WidgetSpec["status"],
    chart: chart as WidgetSpec["chart"],
    x: r.x === undefined ? undefined : String(r.x),
    y: r.y === undefined ? undefined : String(r.y),
    agg: agg as WidgetSpec["agg"],
    data,
    title: typeof r.title === "string" ? r.title : undefined,
    plugin: type === "plugin" ? (r.plugin as string) : undefined,
    options: type === "plugin" ? ((r.options as Record<string, unknown> | undefined) ?? {}) : undefined,
  };
}

/** 문서의 필드 값. 내장 필드(path, title, folder, name, tags, modified)가 프런트매터보다 앞선다. */
export function fieldOf(doc: DocMeta, field: string): unknown {
  switch (field) {
    case "path":
      return doc.path;
    case "title":
      return doc.title;
    case "folder":
      return doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : "";
    case "name":
      return doc.path.split("/").pop()!.replace(/\.md$/i, "");
    case "tags":
      return doc.tags;
    case "modified":
      return new Date(doc.mtime).toISOString().slice(0, 10);
  }
  return doc.frontmatter?.[field] ?? doc.frontmatter?.[field.toLowerCase()];
}

function norm(v: unknown): unknown {
  return typeof v === "string" ? v.toLowerCase() : v;
}

function compare(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return null;
  const sa = String(a);
  const sb = String(b);
  // 숫자처럼 보이는 문자열끼리는 숫자로
  if (sa.trim() !== "" && sb.trim() !== "" && !Number.isNaN(Number(sa)) && !Number.isNaN(Number(sb))) return Number(sa) - Number(sb);
  return sa.localeCompare(sb, "ko");
}

function matches(doc: DocMeta, c: Condition): boolean {
  const v = fieldOf(doc, c.field);
  const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  switch (c.op) {
    case "exists":
      return !empty && v !== false;
    case "!exists":
      return empty || v === false;
    case "=":
    case "!=": {
      const eq = Array.isArray(v)
        ? v.some((x) => norm(x) === norm(c.value) || String(norm(x)) === String(norm(c.value)))
        : norm(v) === norm(c.value) || (v !== undefined && v !== null && String(norm(v)) === String(norm(c.value)));
      return c.op === "=" ? eq : !eq;
    }
    case "contains":
    case "!contains": {
      const needle = String(norm(c.value));
      const has = Array.isArray(v) ? v.some((x) => String(norm(x)).includes(needle)) : !empty && String(norm(v)).includes(needle);
      return c.op === "contains" ? has : !has;
    }
    default: {
      const r = compare(v, c.value);
      if (r === null) return false;
      return c.op === ">" ? r > 0 : c.op === ">=" ? r >= 0 : c.op === "<" ? r < 0 : r <= 0;
    }
  }
}

function inFrom(doc: DocMeta, from: string[]): boolean {
  if (from.length === 0) return true;
  return from.some((f) => {
    if (f.startsWith("#")) {
      const t = f.slice(1).toLowerCase();
      return doc.tags.some((x) => x === t || x.startsWith(t + "/"));
    }
    const folder = f.replace(/^\/+|\/+$/g, "");
    return folder === "" || doc.path === folder || doc.path.startsWith(folder + "/");
  });
}

function sortDocs(docs: DocMeta[], sort: WidgetSpec["sort"]): DocMeta[] {
  if (sort.length === 0) return [...docs].sort((a, b) => a.title.localeCompare(b.title, "ko"));
  return [...docs].sort((a, b) => {
    for (const s of sort) {
      const r = compare(fieldOf(a, s.field), fieldOf(b, s.field));
      // 값이 없는 문서는 정렬 방향과 상관없이 뒤로
      if (r === null) {
        const av = fieldOf(a, s.field);
        const bv = fieldOf(b, s.field);
        const an = av === undefined || av === null;
        const bn = bv === undefined || bv === null;
        if (an !== bn) return an ? 1 : -1;
        continue;
      }
      if (r !== 0) return s.desc ? -r : r;
    }
    return a.path.localeCompare(b.path, "ko");
  });
}

/** docs·tasks는 이미 권한으로 걸러진 목록이어야 한다. */
export function runWidget(spec: WidgetSpec, docs: DocMeta[], tasks: TaskRow[]): WidgetResult {
  if (spec.type === "chart" && spec.data) {
    return { type: "chart", title: spec.title, chart: spec.chart, x: "label", y: "value", series: spec.data };
  }
  const selected = sortDocs(
    docs.filter((d) => inFrom(d, spec.from) && spec.where.every((c) => matches(d, c))),
    spec.sort,
  );

  if (spec.type === "tasks") {
    const byPath = new Map(selected.map((d) => [d.path, d]));
    const groups = new Map<string, TaskRow[]>();
    let total = 0;
    for (const t of tasks) {
      if (!byPath.has(t.path)) continue;
      if (spec.status === "open" && t.done) continue;
      if (spec.status === "done" && !t.done) continue;
      if (total >= spec.limit) break;
      total++;
      groups.set(t.path, [...(groups.get(t.path) ?? []), t]);
    }
    return {
      type: "tasks",
      title: spec.title,
      total,
      groups: selected.filter((d) => groups.has(d.path)).map((d) => ({ path: d.path, title: d.title, hash: d.hash, tasks: groups.get(d.path)! })),
    };
  }

  if (spec.type === "chart") {
    const x = spec.x!;
    const buckets = new Map<string, number[]>();
    for (const d of selected) {
      const xv = fieldOf(d, x);
      const keys = Array.isArray(xv) ? xv.map(String) : xv === undefined || xv === null || xv === "" ? [] : [String(xv)];
      for (const k of keys) {
        const yv = spec.y ? Number(fieldOf(d, spec.y)) : 1;
        if (spec.y && Number.isNaN(yv)) continue;
        buckets.set(k, [...(buckets.get(k) ?? []), yv]);
      }
    }
    const series = [...buckets.entries()].map(([label, vals]) => ({
      label,
      value:
        spec.agg === "count" ? vals.length : spec.agg === "avg" ? vals.reduce((a, b) => a + b, 0) / vals.length : vals.reduce((a, b) => a + b, 0),
    }));
    // x가 날짜·숫자처럼 순서가 있으면 그 순서, 아니면 값 큰 순
    const ordered = series.every((s) => !Number.isNaN(Number(s.label)) || /^\d{4}-\d{2}/.test(s.label));
    series.sort((a, b) => (ordered ? (compare(a.label, b.label) ?? 0) : b.value - a.value));
    return {
      type: "chart",
      title: spec.title,
      chart: spec.chart,
      x,
      y: spec.y ? `${spec.y} (${spec.agg})` : "count",
      series: series.slice(0, spec.limit),
    };
  }

  const columns = spec.show.length > 0 ? spec.show : spec.type === "table" ? ["title", "modified"] : [];
  const rows = selected.slice(0, spec.limit).map((d) => ({
    path: d.path,
    title: d.title,
    values: Object.fromEntries(columns.map((c) => [c, fieldOf(d, c) ?? null])),
  }));
  if (spec.type === "plugin") {
    return { type: "plugin", plugin: spec.plugin!, options: spec.options ?? {}, title: spec.title, columns, rows, total: selected.length };
  }
  return { type: spec.type as "query" | "table", title: spec.title, columns, rows, total: selected.length };
}
