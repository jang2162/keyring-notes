import { resolveLink } from "./markdown.js";
import { dailyOfPath, dailyTagMismatch, type DailyLookup } from "./daily.js";
import { isVaultSettingsPath } from "./settings.js";
import type { DocMeta, LinkRow } from "./types.js";

export type LintKind = "broken_link" | "broken_source" | "orphan" | "no_sources" | "missing_frontmatter" | "stale" | "unprocessed_raw" | "daily_mismatch";

export interface LintIssue {
  kind: LintKind;
  path: string;
  /** 설명에 끼워 넣을 값(화면·에이전트가 kind로 문장을 만든다) */
  params?: Record<string, string | number>;
  target?: string;
}

export interface LintReport {
  checkedAt: string;
  folder: string | null;
  counts: Partial<Record<LintKind, number>>;
  issues: LintIssue[];
}

export interface GraphData {
  nodes: { id: string; title: string; topic: string; degree: number }[];
  edges: { source: string; target: string; kind: "link" | "source" }[];
}

/** 위키 토픽 판정(서버는 Wiki, 앱은 로컬 볼트가 준다). */
export interface WikiTopics {
  isGenerated(rel: string): boolean;
  topicOf(rel: string): string | null;
}

/**
 * 구조적 정리(W7). docs·files는 읽을 수 있는 것만, links는 전체(읽을 수 없는 출발 문서는 canRead로 거른다).
 * - 모든 문서: 깨진 위키링크, 깨진 출처(볼 수 없는 대상도 "없거나 볼 수 없음"으로 같이 센다)
 * - 위키 페이지(<토픽>/wiki/): 고아(아무 데서도 링크·인용 안 됨), 출처 없음, 필수 프런트매터 누락, 오래됨
 * - 위키 원본(<토픽>/raw/): 어느 위키 페이지에서도 인용되지 않음
 * - 데일리 노트: 자동 태그(데일리/연/월/일·월-일·주차·요일)가 이름의 날짜와 다름
 */
export function lintVault(input: {
  docs: DocMeta[];
  files: string[];
  links: LinkRow[];
  canRead: (p: string) => boolean;
  wiki?: WikiTopics;
  folder: string;
  staleDays?: number;
  required?: string[];
  now?: number;
  /** 출처가 가리키는 제목·블록(`#^id`)이 대상 문서에 없는 것(부르는 쪽이 내용을 읽어 확인해 넘긴다) */
  missingAnchors?: { src: string; target: string; anchor: string }[];
  /** 워크스페이스별 데일리 설정(날짜 링크 해석·자동 속성 점검) */
  daily?: DailyLookup | null;
}): LintReport {
  const { files, links, canRead, wiki } = input;
  const f = input.folder;
  const staleDays = input.staleDays ?? 180;
  const required = input.required ?? ["title", "summary"];
  const docs = input.docs.filter((d) => !wiki?.isGenerated(d.path) && !isVaultSettingsPath(d.path));
  const inScope = (p: string) => !f || p === f || p === `${f}.md` || p.startsWith(f + "/");
  const isWikiPage = (p: string) => {
    const t = wiki?.topicOf(p);
    return !!t && p.startsWith(`${t}/wiki/`);
  };
  const isRaw = (p: string) => {
    const t = wiki?.topicOf(p);
    return !!t && p.startsWith(`${t}/raw/`) && !p.startsWith(`${t}/raw/assets/`);
  };

  // 들어오는 링크·인용(볼 수 있는 문서에서, 자기 자신 제외)
  const incoming = new Map<string, number>();
  const citedByWiki = new Set<string>();
  const issues: LintIssue[] = [];
  for (const r of links) {
    if (!canRead(r.src) || wiki?.isGenerated(r.src)) continue;
    const to = resolveLink(r.target, files, { daily: input.daily, from: r.src });
    if (to && to !== r.src) {
      incoming.set(to, (incoming.get(to) ?? 0) + 1);
      if (isWikiPage(r.src)) citedByWiki.add(to);
    }
    if (!to && inScope(r.src)) {
      issues.push(
        r.kind === "source" ? { kind: "broken_source", path: r.src, target: r.target } : { kind: "broken_link", path: r.src, target: r.target },
      );
    }
  }

  for (const m of input.missingAnchors ?? []) {
    if (!inScope(m.src)) continue;
    issues.push({ kind: "broken_source", path: m.src, target: `${m.target}#${m.anchor}`, params: { anchor: m.anchor } });
  }

  const now = input.now ?? Date.now();
  for (const d of docs) {
    if (!inScope(d.path)) continue;
    if (isWikiPage(d.path)) {
      if (!incoming.get(d.path)) issues.push({ kind: "orphan", path: d.path });
      const src = d.frontmatter?.sources;
      if (!src || (Array.isArray(src) && src.length === 0)) issues.push({ kind: "no_sources", path: d.path });
      const missing = required.filter((k) => {
        const v = d.frontmatter?.[k];
        return v === undefined || v === null || (typeof v === "string" && !v.trim());
      });
      if (missing.length) issues.push({ kind: "missing_frontmatter", path: d.path, params: { fields: missing.join(", ") } });
      const updatedRaw = d.frontmatter?.updated;
      const updated = typeof updatedRaw === "string" && !Number.isNaN(Date.parse(updatedRaw)) ? Date.parse(updatedRaw) : d.mtime;
      const age = Math.floor((now - updated) / 86400_000);
      if (age > staleDays) issues.push({ kind: "stale", path: d.path, params: { days: age, limit: staleDays } });
    } else if (isRaw(d.path) && !citedByWiki.has(d.path)) {
      issues.push({ kind: "unprocessed_raw", path: d.path });
    }
    const daily = dailyOfPath(d.path, input.daily);
    if (daily) {
      const cfg = input.daily?.of(d.path.split("/")[0]);
      const tags = dailyTagMismatch(d.frontmatter, daily.date, cfg?.weekStart);
      if (tags.length) issues.push({ kind: "daily_mismatch", path: d.path, params: { date: daily.ymd, tags: tags.join(", ") } });
    }
  }

  const order: LintKind[] = ["broken_link", "broken_source", "missing_frontmatter", "no_sources", "orphan", "stale", "unprocessed_raw", "daily_mismatch"];
  issues.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path, "ko"));
  const counts: Partial<Record<LintKind, number>> = {};
  for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return { checkedAt: new Date(now).toISOString(), folder: f || null, counts, issues };
}

/**
 * 그래프 뷰(W9): 볼 수 있는 문서(자동 생성 문서 제외)와 그 사이의 링크(본문 링크·출처).
 * docs는 읽을 수 있는 문서만. 숨김 문서로 가는 링크는 아예 빠진다.
 */
export function linkGraph(input: { docs: DocMeta[]; links: LinkRow[]; wiki?: WikiTopics; folder: string; daily?: DailyLookup | null }): GraphData {
  const f = input.folder;
  const docs = input.docs.filter((d) => !input.wiki?.isGenerated(d.path) && !isVaultSettingsPath(d.path) && (!f || d.path === `${f}.md` || d.path.startsWith(f + "/")));
  const ids = new Set(docs.map((d) => d.path));
  const paths = [...ids];
  const seen = new Set<string>();
  const edges: GraphData["edges"] = [];
  const degree = new Map<string, number>();
  for (const r of input.links) {
    if (!ids.has(r.src)) continue;
    const to = resolveLink(r.target, paths, { daily: input.daily, from: r.src });
    if (!to || to === r.src) continue;
    const key = `${r.src}\0${to}\0${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: r.src, target: to, kind: r.kind });
    degree.set(r.src, (degree.get(r.src) ?? 0) + 1);
    degree.set(to, (degree.get(to) ?? 0) + 1);
  }
  return {
    nodes: docs.map((d) => ({ id: d.path, title: d.title, topic: graphTopic(d.path), degree: degree.get(d.path) ?? 0 })),
    edges,
  };
}

/** 그래프 색 묶음: 워크스페이스 바로 아래 노드(업무/경제), 워크스페이스 노트·바로 아래 잎 노드는 워크스페이스 */
export function graphTopic(path: string): string {
  const segs = path.replace(/\.md$/i, "").split("/");
  return segs.length >= 3 ? `${segs[0]}/${segs[1]}` : segs[0];
}
