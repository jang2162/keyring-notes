import { useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { DocIcon, IconLookup } from "./IconPicker";
import { BUILTIN_FIELDS, parseFieldInput, setFrontmatterField } from "@keyring-notes/core";
import { api, ApiError, appMode, type ListWidgetResult, type WidgetResult, type WidgetRow } from "./api";
import { fmtNumber, t } from "./i18n";
import { errorText } from "./toast";

// 미리보기는 타이핑할 때마다 다시 그려지므로, 같은 위젯 원문의 결과를 저장 전까지 재사용한다.
const cache = new Map<string, Promise<WidgetResult>>();
let epoch = 0;
const subscribers = new Set<() => void>();

/** 볼트 내용이 바뀌었을 때(저장·이동·삭제·체크) 모든 위젯을 다시 불러오게 한다. */
export function invalidateWidgets() {
  cache.clear();
  epoch++;
  subscribers.forEach((fn) => fn());
}

function load(source: string): Promise<WidgetResult> {
  let p = cache.get(source);
  if (!p) {
    p = api.widget(source);
    cache.set(source, p);
    p.catch(() => cache.delete(source));
  }
  return p;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number") return fmtNumber(v);
  return String(v);
}

/**
 * 위젯에서 문서의 프런트매터 필드 하나를 고친다. 위젯을 그린 때의 해시와 같을 때만(덮어쓰기 금지),
 * 다른 필드·본문은 그대로 둔다. value가 null이면 필드를 지운다.
 */
async function setField(row: WidgetRow, field: string, value: unknown): Promise<void> {
  const doc = await api.read(row.path, { fresh: true });
  if (doc.hash !== row.hash) throw new ApiError(409, "conflict", t("widget.changedRetry"), doc.hash);
  await api.write(row.path, setFrontmatterField(doc.content, field, value), row.hash);
}

/** 내장 필드(title·path·tags 등)가 아니면 고칠 수 있다 */
const editable = (field: string) => !BUILTIN_FIELDS.has(field);

const groupKey = (v: unknown) => formatValue(v) || t("widget.noValue");

interface Props {
  source: string;
  onOpen: (path: string) => void;
  /** 위젯에서 다른 문서(또는 현재 문서)를 바꿨을 때. */
  onChanged: (path: string) => void;
}

export function Widget({ source, onOpen, onChanged }: Props) {
  const [, setTick] = useState(0);
  const [state, setState] = useState<{ result?: WidgetResult; error?: string }>({});
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    subscribers.add(fn);
    return () => void subscribers.delete(fn);
  }, []);

  const currentEpoch = epoch;
  useEffect(() => {
    let alive = true;
    load(source)
      .then((result) => alive && setState({ result }))
      .catch((e) => alive && setState({ error: errorText(e) }));
    return () => {
      alive = false;
    };
  }, [source, currentEpoch]);

  const iconOf = useContext(IconLookup);
  const link = (path: string, label: string) => (
    <a
      href={`#/${encodeURIComponent(path)}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen(path);
      }}
    >
      <DocIcon icon={iconOf(path)} />
      {label}
    </a>
  );

  if (state.error) return <div className="widget widget-error">{t("widget.error", { error: state.error })}</div>;
  const r = state.result;
  if (!r) return <div className="widget widget-loading">{t("common.loading")}</div>;

  const edit = async (row: WidgetRow, field: string, value: unknown) => {
    try {
      await setField(row, field, value);
      setEditError(null);
      onChanged(row.path);
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      invalidateWidgets();
    }
  };

  /** 묶음: group 필드 값별 행(나온 순서) */
  const grouped = (rows: WidgetRow[], field?: string): [string, WidgetRow[]][] => {
    if (!field) return [["", rows]];
    const m = new Map<string, WidgetRow[]>();
    for (const row of rows) {
      const k = groupKey(row.values[field]);
      m.set(k, [...(m.get(k) ?? []), row]);
    }
    return [...m.entries()];
  };

  return (
    <div className="widget" onClick={(e) => e.stopPropagation()}>
      {r.title && <div className="widget-title">{r.title}</div>}
      {editError && (
        <div className="widget-error" onClick={() => setEditError(null)}>
          {editError}
        </div>
      )}
      {r.type === "query" &&
        (r.rows.length === 0 ? (
          <div className="widget-empty">{t("widget.noMatch")}</div>
        ) : (
          grouped(r.rows, r.group).map(([key, rows]) => (
            <ul className="widget-list" key={key}>
              {r.group && <li className="widget-group">{key}</li>}
              {rows.map((row) => (
                <li key={row.path}>
                  {link(row.path, row.title)}
                  {r.columns
                    .filter((c) => c !== "title")
                    .map((c) =>
                      row.values[c] === null || row.values[c] === undefined ? null : (
                        <span key={c} className="widget-field">
                          {c}: {formatValue(row.values[c])}
                        </span>
                      ),
                    )}
                </li>
              ))}
            </ul>
          ))
        ))}
      {r.type === "table" && (
        <div className="widget-table-wrap">
          <table className="widget-table">
            <thead>
              <tr>
                {r.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped(r.rows, r.group).flatMap(([key, rows]) => [
                ...(r.group
                  ? [
                      <tr key={`g:${key}`} className="widget-group-row">
                        <th colSpan={r.columns.length}>
                          {key} <span className="count">{rows.length}</span>
                        </th>
                      </tr>,
                    ]
                  : []),
                ...rows.map((row) => (
                  <tr key={row.path}>
                    {r.columns.map((c, i) => (
                      <td key={c} className={typeof row.values[c] === "number" ? "num" : undefined}>
                        {c === "title" || (i === 0 && !r.columns.includes("title")) ? (
                          link(row.path, formatValue(row.values[c]) || row.title)
                        ) : editable(c) ? (
                          <FieldCell value={row.values[c]} label={`${row.title} · ${c}`} onSave={(v) => edit(row, c, v)} />
                        ) : (
                          formatValue(row.values[c])
                        )}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
              {r.rows.length === 0 && (
                <tr>
                  <td colSpan={r.columns.length} className="widget-empty">
                    {t("widget.noMatch")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {r.type === "cards" &&
        (r.rows.length === 0 ? (
          <div className="widget-empty">{t("widget.noMatch")}</div>
        ) : (
          grouped(r.rows, r.group).map(([key, rows]) => (
            <div key={key}>
              {r.group && <div className="widget-group">{key}</div>}
              <div className="widget-cards">
                {rows.map((row) => (
                  <Card key={row.path} row={row} columns={r.columns} link={link} edit={edit} />
                ))}
              </div>
            </div>
          ))
        ))}
      {r.type === "kanban" && <Kanban result={r} link={link} edit={edit} />}
      {r.type === "tasks" && <TaskList result={r} link={link} onChanged={onChanged} />}
      {r.type === "chart" && <Chart result={r} />}
      {r.type === "plugin" && <PluginWidget result={r} onOpen={onOpen} />}
      {(r.type === "query" || r.type === "table" || r.type === "cards" || r.type === "kanban") && r.total > r.rows.length && (
        <div className="widget-more">{t("widget.showing", { shown: fmtNumber(r.rows.length), total: fmtNumber(r.total) })}</div>
      )}
    </div>
  );
}

/** 눌러서 고치는 칸: Enter·바깥 누르기로 저장, Esc로 취소. 빈 칸으로 저장하면 필드를 지운다 */
function FieldCell({ value, label, onSave }: { value: unknown; label: string; onSave: (v: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const start = () => {
    setText(Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value));
    setEditing(true);
  };
  const commit = async () => {
    const next = parseFieldInput(text, value);
    setEditing(false);
    if (JSON.stringify(next ?? null) === JSON.stringify(value ?? null)) return;
    setBusy(true);
    await onSave(next);
    setBusy(false);
  };
  if (editing) {
    return (
      <input
        className="field-input"
        autoFocus
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button className={`field-cell${busy ? " busy" : ""}`} title={t("widget.clickToEdit", { label })} onClick={start} disabled={busy}>
      {formatValue(value) || <span className="field-empty">—</span>}
    </button>
  );
}

function Card({
  row,
  columns,
  link,
  edit,
  draggable,
  extra,
}: {
  row: WidgetRow;
  columns: string[];
  link: (path: string, label: string) => ReactElement;
  edit: (row: WidgetRow, field: string, value: unknown) => Promise<void>;
  draggable?: boolean;
  extra?: ReactElement;
}) {
  return (
    <div className="widget-card" draggable={draggable} onDragStart={draggable ? (e) => e.dataTransfer.setData("text/x-keyring-path", row.path) : undefined}>
      <div className="widget-card-title">{link(row.path, row.title)}</div>
      {row.summary && <div className="widget-card-summary">{row.summary}</div>}
      {columns
        .filter((c) => c !== "title")
        .map((c) => (
          <div key={c} className="widget-card-field">
            <span className="meta">{c}</span>{" "}
            {editable(c) ? <FieldCell value={row.values[c]} label={`${row.title} · ${c}`} onSave={(v) => edit(row, c, v)} /> : formatValue(row.values[c])}
          </div>
        ))}
      {extra}
    </div>
  );
}

/** 칸반: group 필드 값이 칸. 카드를 다른 칸으로 끌거나(또는 고르기 상자로) 옮기면 그 필드가 바뀐다 */
function Kanban({
  result,
  link,
  edit,
}: {
  result: ListWidgetResult;
  link: (path: string, label: string) => ReactElement;
  edit: (row: WidgetRow, field: string, value: unknown) => Promise<void>;
}) {
  const field = result.group ?? "status";
  const [over, setOver] = useState<string | null>(null);
  const none = groupKey(null);
  const seen = result.rows.map((r) => groupKey(r.values[field]));
  const lanes = [...new Set([...(result.lanes ?? []), ...seen.filter((k) => k !== none), ...(seen.includes(none) ? [none] : [])])];
  const move = (path: string, lane: string) => {
    const row = result.rows.find((r) => r.path === path);
    if (!row || groupKey(row.values[field]) === lane) return;
    void edit(row, field, lane === none ? null : lane);
  };
  return (
    <div className="widget-kanban">
      {lanes.map((lane) => {
        const rows = result.rows.filter((r) => groupKey(r.values[field]) === lane);
        return (
          <section
            key={lane}
            className={`kanban-lane${over === lane ? " over" : ""}`}
            aria-label={`${field}: ${lane}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/x-keyring-path")) return;
              e.preventDefault();
              setOver(lane);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              move(e.dataTransfer.getData("text/x-keyring-path"), lane);
            }}
          >
            <h5>
              {lane} <span className="count">{rows.length}</span>
            </h5>
            {rows.map((row) => (
              <Card
                key={row.path}
                row={row}
                columns={result.columns.filter((c) => c !== field)}
                link={link}
                edit={edit}
                draggable
                extra={
                  <select
                    className="kanban-move"
                    aria-label={t("widget.moveCard", { title: row.title })}
                    value={lane}
                    onChange={(e) => move(row.path, e.target.value)}
                  >
                    {lanes.map((l) => (
                      <option key={l} value={l}>
                        → {l}
                      </option>
                    ))}
                  </select>
                }
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function TaskList({
  result,
  link,
  onChanged,
}: {
  result: Extract<WidgetResult, { type: "tasks" }>;
  link: (path: string, label: string) => ReactElement;
  onChanged: (path: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (result.groups.length === 0) return <div className="widget-empty">{t("widget.noTasks")}</div>;
  const toggle = async (path: string, hash: string, line: number, done: boolean) => {
    setBusy(`${path}:${line}`);
    setError(null);
    try {
      await api.setTask(path, line, done, hash);
      onChanged(path);
      invalidateWidgets();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("widget.changedRetry") : errorText(e));
      invalidateWidgets();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="widget-tasks">
      {error && <div className="widget-error">{error}</div>}
      {result.groups.map((g) => (
        <div key={g.path}>
          <div className="widget-task-doc">{link(g.path, g.title)}</div>
          <ul>
            {g.tasks.map((task) => (
              <li key={task.line} className={task.done ? "done" : undefined}>
                <label>
                  <input type="checkbox" checked={task.done} disabled={busy !== null} onChange={(e) => toggle(g.path, g.hash, task.line, e.target.checked)} />{" "}
                  {task.text}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 단일 계열 막대·선 차트. 한 가지 색, 범례 없음(제목·축 이름이 대신), 호버 툴팁, 표 보기 제공. */
function Chart({ result }: { result: Extract<WidgetResult, { type: "chart" }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const data = result.series;
  // 실제 폭으로 그려 글자 크기가 화면 폭에 따라 커지지 않게 한다.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const W = width;
  const H = Math.round(Math.min(260, Math.max(180, W * 0.38)));
  const pad = { l: 44, r: 12, t: 12, b: 36 };
  const { max, ticks } = useMemo(() => niceTicks(Math.max(0, ...data.map((d) => d.value))), [data]);
  if (data.length === 0) return <div className="widget-empty">{t("widget.noData")}</div>;

  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const band = iw / data.length;
  const y = (v: number) => pad.t + ih - (max === 0 ? 0 : (v / max) * ih);
  const cx = (i: number) => pad.l + band * i + band / 2;
  const barW = Math.min(24, band * 0.6);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((x - pad.l) / band);
    setHover(i >= 0 && i < data.length ? i : null);
  };

  if (asTable) {
    return (
      <div>
        <table className="widget-table">
          <thead>
            <tr>
              <th>{result.x}</th>
              <th>{result.y}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="num">{formatValue(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="widget-footer">
          <button className="widget-toggle" onClick={() => setAsTable(false)}>
            {t("widget.showChart")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chart" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("widget.chartLabel", { title: result.title ?? result.y })}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tick)} y2={y(tick)} className="chart-grid" />
            <text x={pad.l - 6} y={y(tick)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.label} x={cx(i)} y={H - pad.b + 16} className="chart-axis" textAnchor="middle">
              {d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label}
            </text>
          ) : null,
        )}
        {hover !== null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} className="chart-hover-band" />}
        {result.chart === "bar" ? (
          data.map((d, i) => <path key={d.label} d={barPath(cx(i) - barW / 2, y(d.value), barW, y(0) - y(d.value))} className="chart-mark" />)
        ) : (
          <>
            <polyline points={data.map((d, i) => `${cx(i)},${y(d.value)}`).join(" ")} className="chart-line" />
            {data.map((d, i) => (
              <circle key={d.label} cx={cx(i)} cy={y(d.value)} r={hover === i ? 5 : 4} className="chart-dot" />
            ))}
          </>
        )}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="chart-baseline" />
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${(cx(hover) / W) * 100}%` }}>
          <div className="chart-tooltip-label">{data[hover].label}</div>
          <div>
            {result.y}: <strong>{formatValue(data[hover].value)}</strong>
          </div>
        </div>
      )}
      <div className="widget-footer">
        <button className="widget-toggle" onClick={() => setAsTable(true)}>
          {t("widget.showTable")}
        </button>
      </div>
    </div>
  );
}

/** 위쪽 끝만 4px 둥근 막대(기준선 쪽은 각짐). */
function barPath(x: number, top: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
}

function niceTicks(maxValue: number): { max: number; ticks: number[] } {
  if (maxValue <= 0) return { max: 1, ticks: [0, 1] };
  const rough = maxValue / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { max, ticks };
}

/** DOM 만들기 도우미(플러그인용): h("a", { href, onclick, class }, "글자", 자식요소…) */
function h(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class" || k === "className") el.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

type PluginModule = { default?: { render?: (el: HTMLElement, data: unknown, api: unknown) => void | (() => void) } };

/** 위젯 플러그인: /plugins/<이름>.js 모듈의 render(el, data, api)를 부른다. */
function PluginWidget({ result, onOpen }: { result: Extract<WidgetResult, { type: "plugin" }>; onOpen: (path: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cleanup: void | (() => void);
    let alive = true;
    setError(null);
    if (appMode.local) {
      // 플러그인 모듈은 서버의 plugins 폴더에 있다. 기기 볼트에서는 쿼리 결과만 표로 보여 준다.
      setError(t("widget.pluginLocal", { name: result.plugin, count: result.total }));
      return;
    }
    import(/* @vite-ignore */ `/plugins/${result.plugin}.js`)
      .then((mod: PluginModule) => {
        if (!alive || !host.current) return;
        const render = mod.default?.render;
        if (typeof render !== "function") throw new Error(t("widget.pluginNoRender"));
        host.current.replaceChildren();
        cleanup = render(
          host.current,
          { rows: result.rows, columns: result.columns, total: result.total, title: result.title, options: result.options },
          { open: onOpen, h },
        );
      })
      .catch((e) => alive && setError(t("widget.pluginError", { name: result.plugin, error: errorText(e) })));
    return () => {
      alive = false;
      try {
        if (typeof cleanup === "function") cleanup();
      } catch {
        /* 플러그인 정리 오류는 무시 */
      }
    };
  }, [result, onOpen]);
  return (
    <>
      {error && <div className="widget-error">{error}</div>}
      <div ref={host} className="plugin-host" />
    </>
  );
}
