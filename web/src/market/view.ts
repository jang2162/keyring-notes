import {
  compareSemver,
  displayText,
  latestVersion,
  normalizeRepoUrl,
  parseSemver,
  PathError,
  type IndexVersion,
  type LockEntry,
  type PackageType,
  type RepoIndex,
  type RepoIndexResult,
} from "@keyring-notes/core";

/**
 * 마켓 화면의 순수 모델(DOM 없음). 화면(MarketSettings.tsx)은 종류를 이 표로만 가른다 —
 * installNotice 가 있는 종류는 설치(업데이트 아님) 전에 그 글로 묻고, 「설치됨」 묶음 머리에 installNoticeShort 한 줄을 둔다.
 */
export const MARKET_KINDS: Record<PackageType, { label: string; installable: boolean; installNotice?: string; installNoticeShort?: string }> = {
  theme: { label: "market.kind.theme", installable: true },
  language: { label: "market.kind.language", installable: true },
  widget: { label: "market.kind.widget", installable: true, installNotice: "market.widgetNotice", installNoticeShort: "market.widgetNoticeShort" },
};

/** 걸러 보는 id 가 있고 목록을 받았는데 그 행이 어느 저장소에도 없음 */
export function focusMissing(rows: BrowseRow[], only: string | null, loaded: boolean): boolean {
  return !!only && loaded && !rows.some((r) => r.id === only);
}

const KIND_ORDER: PackageType[] = ["theme", "language", "widget"];

export interface BrowseRow {
  id: string;
  type: PackageType;
  repo: string;
  repoName: string;
  /** 이 앱에 맞는 최신 정식 판(없으면 null) */
  version: string | null;
  /** 판은 있으나 이 앱에 맞는 것이 없음 — 가장 높은 판의 engines 범위 */
  incompatible: { range: string } | null;
  /** index 의 표시 필드(둘러보기용 — 설치 뒤에는 매니페스트가 원본) */
  info: { name: string | null; description: string | null; author: string | null; license: string | null };
  /** 같은 id 가 있는 다른 저장소 */
  alsoIn: string[];
  installed: LockEntry | null;
  /** 설치됐고 잠금의 저장소에 더 높은 맞는 판 */
  update: string | null;
}

function highest(pkg: RepoIndex["packages"][string]): string {
  return Object.keys(pkg.versions).sort(compareSemver).at(-1)!;
}

/** 저장소 순서가 우선순위. 설치된 것은 잠금의 저장소 행(우선순위가 바뀌어도 다른 저장소로 넘어가지 않는다) */
export function browseRows(indexes: RepoIndexResult[], lock: Record<string, LockEntry>, appVersion: string, lang: string): BrowseRow[] {
  const ok = indexes.filter((r): r is RepoIndexResult & { index: RepoIndex } => !!r.index);
  const ids = new Set(ok.flatMap((r) => Object.keys(r.index.packages)));
  const rows: BrowseRow[] = [];
  for (const id of ids) {
    const having = ok.filter((r) => r.index.packages[id]);
    const installed = lock[id] ?? null;
    const home = (installed && having.find((r) => r.repo === installed.repo)) || having[0]!;
    const pkg = home.index.packages[id]!;
    const version = latestVersion(home.index, id, appVersion);
    const shown: IndexVersion = pkg.versions[version ?? highest(pkg)]!;
    const update =
      installed && installed.repo === home.repo && version && !parseSemver(version)?.pre.length && compareSemver(version, installed.version) > 0
        ? version
        : null;
    rows.push({
      id,
      type: pkg.type,
      repo: home.repo,
      repoName: home.index.name || home.repo,
      version,
      incompatible: version ? null : { range: pkg.versions[highest(pkg)]!.engines.keyring },
      info: {
        name: displayText(shown.name, lang),
        description: displayText(shown.description, lang),
        author: shown.author ?? null,
        license: shown.license ?? null,
      },
      alsoIn: having.filter((r) => r !== home).map((r) => r.repo),
      installed,
      update,
    });
  }
  return rows.sort((a, b) => KIND_ORDER.indexOf(a.type) - KIND_ORDER.indexOf(b.type) || (a.info.name ?? a.id).localeCompare(b.info.name ?? b.id, lang));
}

type RepoError = "market_url_invalid" | "market_url_protocol" | "market_url_credentials" | "market_repo_duplicate";

function norm(url: string): string {
  try {
    return normalizeRepoUrl(url, { allowHttp: true });
  } catch {
    return url;
  }
}

/** `http:` 는 기록으로는 받는다 — 받을 수 있는지는 받는 쪽(서버 운영자 설정·앱 「이 기기」)이 판정해 그 저장소 줄에 오류로 보인다 */
export function repoAdd(repos: string[], input: string): { repos: string[] } | { error: RepoError } {
  let url: string;
  try {
    url = normalizeRepoUrl(input, { allowHttp: true });
  } catch (e) {
    const code = e instanceof PathError ? e.code : "market_url_invalid";
    return { error: (["market_url_protocol", "market_url_credentials"].includes(code) ? code : "market_url_invalid") as RepoError };
  }
  if (repos.some((r) => norm(r) === url)) return { error: "market_repo_duplicate" };
  return { repos: [...repos, url] };
}

export function repoMove(repos: string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta;
  if (index < 0 || index >= repos.length || to < 0 || to >= repos.length) return repos;
  const next = [...repos];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export function repoRemove(repos: string[], index: number): string[] {
  return repos.filter((_, i) => i !== index);
}
