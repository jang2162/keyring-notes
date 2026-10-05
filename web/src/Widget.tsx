import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { api, ApiError, type WidgetResult } from "./api";

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
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

interface Props {
  source: string;
  onOpen: (path: string) => void;
  /** 위젯에서 다른 문서(또는 현재 문서)를 바꿨을 때. */
  onChanged: (path: string) => void;
}

export function Widget({ source, onOpen, onChanged }: Props) {
  const [, setTick] = useState(0);
  const [state, setState] = useState<{ result?: WidgetResult; error?: string }>({});

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    subscribers.add(fn);
    return () => void subscribers.delete(fn);
  }, []);

  const currentEpoch = epoch;
  useEffect(() => {
    let alive = true;
    load(source)
      .then((result) => alive && setState({ result }))
      .catch((e) => alive && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [source, currentEpoch]);

  const link = (path: string, label: string) => (
    <a
      href={`#/${encodeURIComponent(path)}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen(path);
      }}
    >
      {label}
    </a>
  );

  if (state.error) return <div className="widget widget-error">위젯 오류: {state.error}</div>;
  const r = state.result;
  if (!r) return <div className="widget widget-loading">불러오는 중…</div>;

  return (
    <div className="widget" onClick={(e) => e.stopPropagation()}>
      {r.title && <div className="widget-title">{r.title}</div>}
      {r.type === "query" &&
        (r.rows.length === 0 ? (
          <div className="widget-empty">조건에 맞는 문서가 없습니다.</div>
        ) : (
          <ul className="widget-list">
            {r.rows.map((row) => (
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
              {r.rows.map((row) => (
                <tr key={row.path}>
                  {r.columns.map((c, i) => (
                    <td key={c} className={typeof row.values[c] === "number" ? "num" : undefined}>
                      {c === "title" || (i === 0 && !r.columns.includes("title"))
                        ? link(row.path, formatValue(row.values[c]) || row.title)
                        : formatValue(row.values[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {r.rows.length === 0 && (
                <tr>
                  <td colSpan={r.columns.length} className="widget-empty">
                    조건에 맞는 문서가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {r.type === "tasks" && <TaskList result={r} link={link} onChanged={onChanged} />}
      {r.type === "chart" && <Chart result={r} />}
      {(r.type === "query" || r.type === "table") && r.total > r.rows.length && (
        <div className="widget-more">
          {r.total}개 중 {r.rows.length}개 표시
        </div>
      )}
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
  if (result.groups.length === 0) return <div className="widget-empty">할 일이 없습니다.</div>;
  const toggle = async (path: string, hash: string, line: number, done: boolean) => {
    setBusy(`${path}:${line}`);
    setError(null);
    try {
      await api.setTask(path, line, done, hash);
      onChanged(path);
      invalidateWidgets();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "그 사이 문서가 바뀌었습니다. 다시 시도하세요." : String((e as Error).message));
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
            {g.tasks.map((t) => (
              <li key={t.line} className={t.done ? "done" : undefined}>
                <label>
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={busy !== null}
                    onChange={(e) => toggle(g.path, g.hash, t.line, e.target.checked)}
                  />{" "}
                  {t.text}
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
  if (data.length === 0) return <div className="widget-empty">표시할 데이터가 없습니다.</div>;

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
            차트로 보기
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
        aria-label={`${result.title ?? result.y} 차트`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.l - 6} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
              {formatValue(t)}
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
        {hover !== null && (
          <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} className="chart-hover-band" />
        )}
        {result.chart === "bar"
          ? data.map((d, i) => <path key={d.label} d={barPath(cx(i) - barW / 2, y(d.value), barW, y(0) - y(d.value))} className="chart-mark" />)
          : (
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
          표로 보기
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
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { max, ticks };
}
