import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent } from "react";
import { api, type GraphData } from "./api";

interface Node extends SimulationNodeDatum {
  id: string;
  title: string;
  topic: string;
  degree: number;
  color: string;
  r: number;
}
interface Link extends SimulationLinkDatum<Node> {
  kind: "link" | "source";
}

/**
 * 그래프 뷰(W9). 산점도처럼 모든 점이 서로 이웃하므로, 검증된 범주 팔레트 중 모든 쌍을 통과하는
 * 앞의 3색만 쓰고(문서 수가 많은 토픽 3개) 나머지 토픽은 회색 "기타"로 묶는다. 범례를 늘 보이고,
 * 색만으로 구분하지 않도록 호버 툴팁·제목 라벨을 함께 쓴다.
 */
const SLOT_VARS = ["--cat-1", "--cat-2", "--cat-3"];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function neighborhood(data: GraphData, center: string, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of data.edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }
  const seen = new Set([center]);
  let frontier = [center];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), next.push(m));
    frontier = next;
  }
  return seen;
}

export function GraphView({ current, folders, onClose, onOpen }: { current: string | null; folders: string[]; onClose: () => void; onOpen: (p: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [local, setLocal] = useState<0 | 1 | 2>(current ? 2 : 0);
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const view = useRef({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const sim = useRef<{ nodes: Node[]; links: Link[]; draw: () => void } | null>(null);
  /** 캔버스 안의 호버 강조(다시 그리기)를 바꾼다 */
  const highlight = useRef<(id: string | null) => void>(() => undefined);

  useEffect(() => {
    api
      .graph(folder || undefined)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [folder]);

  // 토픽별 색: 문서 수 상위 3개만 색, 나머지는 "기타"
  const legend = useMemo(() => {
    if (!data) return [];
    const count = new Map<string, number>();
    for (const n of data.nodes) count.set(n.topic, (count.get(n.topic) ?? 0) + 1);
    const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
    const top = ranked.slice(0, 3).map(([topic, n], i) => ({ topic, n, slot: SLOT_VARS[i] }));
    const rest = ranked.slice(3).reduce((s, [, n]) => s + n, 0);
    return rest ? [...top, { topic: `기타 ${ranked.length - 3}개 토픽`, n: rest, slot: "--cat-other" }] : top;
  }, [data]);

  useEffect(() => {
    if (!data || !canvas.current || !wrap.current) return;
    const keep = local && current ? neighborhood(data, current, local) : null;
    const colorOf = new Map(legend.slice(0, 3).map((l) => [l.topic, cssVar(l.slot)]));
    const other = cssVar("--cat-other");
    const nodes: Node[] = data.nodes
      .filter((n) => !keep || keep.has(n.id))
      .map((n) => ({ ...n, color: colorOf.get(n.topic) ?? other, r: 4 + Math.min(10, Math.sqrt(n.degree) * 2) }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: Link[] = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
    const el = canvas.current;
    const dpr = window.devicePixelRatio || 1;
    const size = () => {
      const r = wrap.current!.getBoundingClientRect();
      el.width = r.width * dpr;
      el.height = r.height * dpr;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      return r;
    };
    let rect = size();
    view.current = { k: 1, x: rect.width / 2, y: rect.height / 2 };
    const edgeColor = cssVar("--axis");
    const textColor = cssVar("--fg");
    const mutedText = cssVar("--muted");
    const bg = cssVar("--bg");
    let hoverId: string | null = null;
    const draw = () => {
      const ctx = el.getContext("2d")!;
      const { k, x, y } = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.translate(x, y);
      ctx.scale(k, k);
      const near = new Set<string>();
      if (hoverId) {
        near.add(hoverId);
        for (const l of links) {
          const s = (l.source as Node).id;
          const t = (l.target as Node).id;
          if (s === hoverId) near.add(t);
          if (t === hoverId) near.add(s);
        }
      }
      for (const l of links) {
        const s = l.source as Node;
        const t = l.target as Node;
        const lit = hoverId && (s.id === hoverId || t.id === hoverId);
        ctx.globalAlpha = hoverId && !lit ? 0.15 : 0.7;
        ctx.strokeStyle = lit ? textColor : edgeColor;
        ctx.lineWidth = (lit ? 1.5 : 1) / k;
        ctx.setLineDash(l.kind === "source" ? [4 / k, 3 / k] : []);
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        ctx.globalAlpha = hoverId && !near.has(n.id) ? 0.25 : 1;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        // 겹쳐도 구분되도록 배경색 테두리, 현재 문서는 글자색 고리
        ctx.lineWidth = (n.id === current ? 3 : 2) / k;
        ctx.strokeStyle = n.id === current ? textColor : bg;
        ctx.stroke();
      }
      // 라벨: 현재 문서·호버 이웃·연결이 많은 문서, 확대하면 전부
      ctx.font = `${12 / k}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      for (const n of nodes) {
        const show = n.id === current || near.has(n.id) || n.degree >= 4 || k >= 1.6 || nodes.length <= 30;
        if (!show) continue;
        ctx.globalAlpha = hoverId && !near.has(n.id) ? 0.3 : 1;
        ctx.fillStyle = n.id === current || near.has(n.id) ? textColor : mutedText;
        ctx.fillText(n.title.length > 24 ? n.title.slice(0, 23) + "…" : n.title, n.x!, n.y! + n.r + 13 / k);
      }
      ctx.globalAlpha = 1;
    };
    const simulation = forceSimulation(nodes)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance(60).strength(0.4))
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<Node>().radius((d) => d.r + 6))
      // 떨어진 무리가 화면 밖으로 흩어지지 않게 약하게 가운데로 당긴다
      .force("x", forceX(0).strength(0.06))
      .force("y", forceY(0).strength(0.06))
      .on("tick", draw);
    sim.current = { nodes, links, draw };
    const onResize = () => {
      rect = size();
      draw();
    };
    window.addEventListener("resize", onResize);
    highlight.current = (id) => {
      hoverId = id;
      draw();
    };
    return () => {
      simulation.stop();
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, local, current, legend]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    const { k, x, y } = view.current;
    return { x: (e.clientX - r.left - x) / k, y: (e.clientY - r.top - y) / k, sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const pick = (e: { clientX: number; clientY: number }) => {
    const p = toWorld(e);
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of sim.current?.nodes ?? []) {
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d < n.r + 6 / view.current.k && d < bestD) (best = n), (bestD = d);
    }
    return { node: best, p };
  };
  const setHoverId = (id: string | null) => highlight.current(id);

  const onMove = (e: ReactMouseEvent) => {
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
      view.current.x = drag.current.vx + dx;
      view.current.y = drag.current.vy + dy;
      sim.current?.draw();
      return;
    }
    const { node, p } = pick(e);
    setHover(node ? { node, x: p.sx, y: p.sy } : null);
    setHoverId(node?.id ?? null);
  };
  const onWheel = (e: WheelEvent) => {
    const p = toWorld(e);
    const k = Math.min(6, Math.max(0.2, view.current.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    view.current = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
    sim.current?.draw();
  };

  return (
    <div className="admin" role="dialog" aria-label="그래프">
      <div className="admin-head">
        <strong>그래프</strong>
        <nav>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="폴더">
            <option value="">볼트 전체</option>
            {folders
              .filter((f) => !f.includes("/"))
              .map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
          </select>
          <select value={local} onChange={(e) => setLocal(Number(e.target.value) as 0 | 1 | 2)} disabled={!current} aria-label="범위">
            <option value={0}>모든 문서</option>
            <option value={1}>현재 문서와 바로 이웃</option>
            <option value={2}>현재 문서에서 두 단계</option>
          </select>
        </nav>
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="graph-legend">
        {legend.map((l) => (
          <span key={l.topic}>
            <i style={{ background: `var(${l.slot})` }} /> {l.topic} <span className="meta">{l.n}</span>
          </span>
        ))}
        <span className="meta">— 본문 링크 · ┄ 출처 · 크기 = 연결 수 · 휠로 확대, 끌어서 이동, 누르면 열기</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="graph-wrap" ref={wrap}>
        <canvas
          ref={canvas}
          onMouseMove={onMove}
          onMouseLeave={() => {
            setHover(null);
            setHoverId(null);
            drag.current = null;
          }}
          onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false })}
          onMouseUp={(e) => {
            const moved = drag.current?.moved;
            drag.current = null;
            if (moved) return;
            const { node } = pick(e);
            if (node) onOpen(node.id);
          }}
          onWheel={onWheel}
          role="img"
          aria-label={`문서 ${data?.nodes.length ?? 0}개, 링크 ${data?.edges.length ?? 0}개의 그래프`}
        />
        {hover && (
          <div className="chart-tooltip graph-tooltip" style={{ left: hover.x, top: hover.y + 14 }}>
            <div>{hover.node.title}</div>
            <div className="chart-tooltip-label">
              {hover.node.id} · 연결 {hover.node.degree}
            </div>
          </div>
        )}
        {data && data.nodes.length === 0 && <p className="graph-empty meta">보여 줄 문서가 없습니다.</p>}
      </div>
    </div>
  );
}
