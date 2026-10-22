/**
 * 제3자 라이선스 고지(`licenses.txt`) 만들기의 순수 부분. 파일·cargo 를 읽는 쪽은 `web/licenses/plugin.ts` 가 하고,
 * 여기는 경로 해석·목록 합치기·글 모양만 맡는다(시험: licenseNotices.test.ts).
 * 어떻게 만들어지는지와 손 목록에 넣는 경우는 docs/guides/development.md 「의존성과 라이선스 고지」 절.
 */

/** 고지가 덮는 배포물 조각. web: 브라우저·앱 창으로 가는 번들, server: Docker 이미지의 Node 실행 의존성, app: 앱 실행 파일의 Rust 크레이트 */
export type NoticePart = "web" | "server" | "app";

/** 고지 한 건: 패키지(또는 손으로 넣은 자료) 하나 */
export type Notice = {
  name: string;
  version: string;
  /** SPDX 식 또는 패키지가 적은 그대로 */
  license: string;
  /** 패키지에 든 라이선스 파일들의 전문. 비면 패키지가 라이선스 파일을 싣지 않은 것 */
  texts: string[];
  parts: NoticePart[];
  /** 원본(소스)을 찾아갈 곳. MPL 구성요소와 표준 전문을 붙인 것은 줄에 함께 적는다 */
  source?: string;
  /** 패키지 메타데이터의 저작권자(author·authors) — 라이선스 파일이 없을 때 표준 전문에 넣는다 */
  holders?: string[];
  /** 여러 라이선스 중 고른 것(손 목록의 LICENSE_CHOICES) */
  chosen?: string;
  /** texts 가 패키지 것이 아니라 표준 전문(SPDX)을 붙인 것 */
  standard?: boolean;
};

/**
 * 모듈 경로(번들러의 모듈 id)에서 그것이 든 패키지의 폴더와 이름. node_modules 밖(이 저장소의 코드)이면 null.
 * pnpm 은 `node_modules/.pnpm/<이름>@<판>/node_modules/<이름>/…` 이라 마지막 `node_modules/` 뒤를 본다.
 */
export function packageOfModule(id: string): { dir: string; name: string } | null {
  const file = id
    .replace(/^\0/, "")
    .replace(/[?#].*$/, "")
    .replace(/\\/g, "/");
  const at = file.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = file.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? rest.slice(0, 2).join("/") : rest[0];
  if (!name || name.startsWith(".") || (name.startsWith("@") && !name.includes("/"))) return null;
  return { dir: `${file.slice(0, at)}/node_modules/${name}`, name };
}

/**
 * 소스맵 `sources` 에서 묶여 실린 다른 패키지의 이름들. 패키지가 자기 배포 파일 안에 남의 코드를 미리 묶어 실으면
 * 번들러의 모듈은 그 패키지 하나로만 보이지만, 동봉한 소스맵의 sources 에는 원래 자리(`…/node_modules/<이름>/…`)가 남는다.
 * node_modules 가 없는 자리(그 패키지 자신의 소스)와 self 는 뺀다.
 */
export function bundledInSourceMap(sources: (string | null)[], self: string): string[] {
  const names = sources.flatMap((s) => {
    const file = (s ?? "").replace(/\\/g, "/");
    const at = file.lastIndexOf("node_modules/");
    if (at < 0) return [];
    const rest = file.slice(at + "node_modules/".length).split("/");
    const name = rest[0]?.startsWith("@") ? rest.slice(0, 2).join("/") : rest[0];
    return name && !name.startsWith(".") && name.includes("/") === name.startsWith("@") && name !== self ? [name] : [];
  });
  return [...new Set(names)].sort();
}

/** 패키지 폴더 맨 위의 라이선스·고지 파일인가(LICENSE, LICENSE-MIT, LICENCE.md, COPYING, NOTICE, UNLICENSE …). 코드 파일은 뺀다 */
export function isLicenseFile(file: string): boolean {
  return /^(un)?licen[cs]e|^copying|^notice/i.test(file) && !/\.(m?[jt]sx?|c[jt]s|json|d\.ts|html?|rs)$/i.test(file);
}

/** package.json 의 license(문자열·{type}·옛 licenses 배열)를 한 줄로 */
export function licenseField(pkg: { license?: unknown; licenses?: unknown }): string {
  const one = (v: unknown): string | null =>
    typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string" ? (v as { type: string }).type : null;
  const direct = one(pkg.license);
  if (direct) return direct;
  if (Array.isArray(pkg.licenses)) {
    const all = pkg.licenses.map(one).filter((v): v is string => !!v);
    if (all.length) return all.length === 1 ? all[0] : `(${all.join(" OR ")})`;
  }
  return "UNKNOWN";
}

/** 패키지 폴더들에서 시작해 의존성을 따라간 모든 폴더(시작 폴더 포함). deps 는 한 폴더가 쓰는 패키지 폴더들 */
export function walkPackages(start: string[], deps: (dir: string) => string[]): string[] {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const dir = queue.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    queue.push(...deps(dir));
  }
  return [...seen];
}

/** `cargo metadata --format-version 1` 에서 쓰는 칸 */
export type CargoMetadata = {
  packages: {
    id: string;
    name: string;
    version: string;
    license: string | null;
    license_file: string | null;
    manifest_path: string;
    repository: string | null;
    source: string | null;
    authors?: string[];
  }[];
  resolve: { root: string | null; nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] };
};

export type Crate = {
  name: string;
  version: string;
  license: string;
  dir: string;
  licenseFile: string | null;
  repository: string | null;
  authors: string[];
};

/**
 * 앱 실행 파일에 들어가는 크레이트: 루트에서 일반 의존성(kind null)만 따라간다.
 * 빌드 의존성(build.rs 용)과 개발 의존성은 실행 파일에 들어가지 않으므로 뺀다. 경로 의존성(source null, 이 저장소의 코드)도 뺀다.
 * 플랫폼은 cargo metadata 의 --filter-platform 이 이미 거른 상태로 받는다.
 */
export function cratesFromMetadata(meta: CargoMetadata): Crate[] {
  const root = meta.resolve.root;
  if (!root) throw new Error("cargo metadata: resolve.root 가 없다(작업 공간 매니페스트가 아니라 패키지 매니페스트를 준다)");
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const reach = walkPackages([root], (id) => (nodes.get(id)?.deps ?? []).filter((d) => d.dep_kinds.some((k) => k.kind === null)).map((d) => d.pkg));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  return reach
    .map((id) => byId.get(id))
    .filter((p): p is CargoMetadata["packages"][number] => !!p && p.source !== null)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? `SEE LICENSE IN ${p.license_file}` : "UNKNOWN"),
      dir: p.manifest_path.replace(/\\/g, "/").replace(/\/Cargo\.toml$/, ""),
      licenseFile: p.license_file,
      repository: p.repository,
      authors: p.authors ?? [],
    }));
}

/** cargo metadata --filter-platform 에 줄 대상들. Tauri 의 universal 빌드는 두 아키텍처를 한 실행 파일에 담는다 */
export function cargoTargets(triple: string): string[] {
  return triple === "universal-apple-darwin" ? ["aarch64-apple-darwin", "x86_64-apple-darwin"] : [triple];
}

/** SPDX 식에 나오는 라이선스 id(OR·AND 모두, 옛 `MIT/Apache-2.0` 표기 포함). WITH 뒤의 예외 id 는 뺀다 */
export function spdxIds(expr: string): string[] {
  const tokens = expr
    .replace(/\//g, " OR ")
    .split(/[\s()]+/)
    .filter(Boolean);
  const ids = tokens.filter((t, i) => !/^(OR|AND|WITH)$/i.test(t) && !/^WITH$/i.test(tokens[i - 1] ?? ""));
  return [...new Set(ids)];
}

/** package.json 의 author·contributors 나 Cargo 의 authors 한 칸에서 이름만(전자 우편·주소는 뺀다) */
export function holderNames(people: unknown[]): string[] {
  const names = people
    .map((p) =>
      typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string" ? (p as { name: string }).name : "",
    )
    .map((p) => p.replace(/<[^>]*>|\([^)]*\)/g, "").trim())
    .filter(Boolean);
  return [...new Set(names)];
}

/** 표준 전문의 저작권 자리(`Copyright (c) <year> <copyright holders>` 류) */
const HOLDER_SLOT = /^Copyright \(c\) <year> <[^>\n]+>\.?[ \t]*$/m;

/**
 * 라이선스 파일을 싣지 않은 패키지에 표준 전문(SPDX)을 붙인다. MIT·BSD 는 저작권 고지가 조건의 일부라
 * 패키지 메타데이터의 저작권자를 표준 전문의 저작권 자리에 넣는다(자리가 없는 전문이면 맨 앞에 한 줄).
 * 저작권자를 못 찾으면 그 사실과 소스 주소를 그 자리에 적는다. 표준 전문이 없는 id 는 missing 으로 돌려준다(빌드가 멈춘다).
 */
export function withStandardText(n: Notice, standard: Record<string, string>): { notice: Notice; missing: string[] } {
  if (n.texts.length) return { notice: n, missing: [] };
  const ids = spdxIds(n.chosen ?? n.license);
  const missing = ids.filter((id) => !standard[id]);
  if (missing.length) return { notice: n, missing };
  const holder = n.holders?.length ? `Copyright (c) ${n.holders.join(", ")}` : `Copyright holder not stated in the package metadata; see ${n.source ?? n.name}`;
  const filled = ids.map((id) => standard[id]);
  const slotted = filled.some((t) => HOLDER_SLOT.test(t));
  const texts = [
    "This package does not include a license file. The standard text of its declared license (SPDX License List) is reproduced below.",
    ...(slotted ? [] : [holder]),
    ...filled.map((t) => t.replace(HOLDER_SLOT, holder)),
  ];
  return { notice: { ...n, texts, standard: true }, missing: [] };
}

/** 손 목록의 패키지별 칸(LICENSE_CHOICES·HOLDERS)이 덮는 조각. 그 조각을 싣지 않는 빌드(앱 빌드의 server 등)에서는 없어도 된다 */
export type Choice = { license: string; part: NoticePart };
export type Holders = { holders: string[]; part: NoticePart };

/**
 * 고른 라이선스(손 목록의 LICENSE_CHOICES)를 붙인다. 이 빌드가 싣는 조각(parts)의 패키지가 목록에 없거나 고른 id 가 그 패키지의 식에 없으면
 * problems 로 돌려준다 — 의존성이 빠졌거나 라이선스가 바뀌었는데 선택이 남은 것.
 */
export function applyChoices(list: Notice[], choices: Record<string, Choice>, parts: NoticePart[]): { notices: Notice[]; problems: string[] } {
  const problems: string[] = [];
  for (const [name, c] of Object.entries(choices)) {
    const hits = list.filter((n) => n.name === name);
    if (!hits.length && parts.includes(c.part)) problems.push(`${name}: 목록에 없다`);
    for (const n of hits) if (!spdxIds(n.license).includes(c.license)) problems.push(`${name} ${n.version}: ${n.license} 에 ${c.license} 가 없다`);
  }
  return { notices: list.map((n) => (choices[n.name] ? { ...n, chosen: choices[n.name].license } : n)), problems };
}

/**
 * 손으로 찾은 저작권자(손 목록의 HOLDERS)를 붙인다 — 라이선스 파일도 메타데이터의 저작권자도 없어 표준 전문의 저작권 자리가 비는 패키지.
 * 이 빌드가 싣는 조각의 패키지가 목록에 없거나, 패키지가 이제 라이선스 파일을 싣는다면(손 칸이 필요 없다) problems 로 돌려준다.
 */
export function applyHolders(list: Notice[], holders: Record<string, Holders>, parts: NoticePart[]): { notices: Notice[]; problems: string[] } {
  const problems: string[] = [];
  for (const [name, h] of Object.entries(holders)) {
    const hits = list.filter((n) => n.name === name);
    if (!hits.length && parts.includes(h.part)) problems.push(`${name}: 목록에 없다`);
    for (const n of hits) if (n.texts.length) problems.push(`${name} ${n.version}: 이제 라이선스 파일을 싣는다 — 손 칸을 지운다`);
  }
  return { notices: list.map((n) => (holders[n.name] ? { ...n, holders: holders[n.name].holders } : n)), problems };
}

/** 손 목록 한 건(web/licenses/manual.ts). 자동 수집(import 그래프·의존성 목록)이 못 보는 것만 넣는다 */
export type ManualNotice =
  /** node_modules 의 패키지: 판·라이선스·전문은 설치된 패키지에서 읽는다 */
  | { kind: "package"; package: string; parts: NoticePart[]; why: string }
  /** 패키지가 아닌 자료: 전문은 저장소의 파일에서 읽고, 판은 그 자료를 싣고 오는 패키지(via)의 판으로 적는다 */
  | { kind: "data"; name: string; license: string; textFile: string; via: string; parts: NoticePart[]; why: string }
  /**
   * 다른 패키지(via)가 자기 배포 파일 안에 미리 묶어 싣는 코드나 네이티브 바이너리에 정적으로 링크한 라이브러리.
   * 묶인 쪽은 설치돼 있지 않거나 판이 다를 수 있어 전문은 원래 패키지에서 받아 둔 파일(licenses/bundled/)에서 읽고, 판은 via 의 판으로 적는다
   */
  | { kind: "bundled"; name: string; license: string; textFile: string; via: string; parts: NoticePart[]; why: string };

/** 이 빌드가 싣는 조각(parts)만 남긴 손 목록. 다른 조각만 덮는 항목(앱 빌드의 server 항목 등)은 뺀다 */
export function manualForParts(manual: ManualNotice[], parts: NoticePart[]): ManualNotice[] {
  return manual.flatMap((m) => {
    const kept = m.parts.filter((p) => parts.includes(p));
    return kept.length ? [{ ...m, parts: kept }] : [];
  });
}

/**
 * 묶여 실린 것의 어긋남. found 는 소스맵이 찾은 묶인 패키지(이름 → 싣고 온 패키지들, plugin.ts 의 bundledPackages).
 * ① 찾았는데 고지(자동 수집이든 손 목록이든)에 이름이 없으면 손 목록에 넣으라고 ② 손 목록의 bundled 항목인데 싣고 온 패키지(via)가
 * 이 빌드의 그 조각에 없으면 손 목록에서 지우라고 알린다.
 */
export function bundledProblems(found: Map<string, Set<string>>, notices: Notice[], manual: ManualNotice[]): string[] {
  const names = new Set(notices.map((n) => n.name));
  const missing = [...found]
    .filter(([name]) => !names.has(name))
    .map(([name, via]) => `${name}(${[...via].sort().join(", ")} 안에 묶여 있다) 가 고지에 없다 — kind "bundled" 로 넣는다`);
  const stale = manual
    .filter((m): m is Extract<ManualNotice, { kind: "bundled" }> => m.kind === "bundled")
    .filter((m) => !notices.some((n) => n.name === m.via && n.parts.some((p) => m.parts.includes(p))))
    .map((m) => `${m.name} 를 싣고 오는 ${m.via} 가 [${m.parts.join(", ")}] 에 없다 — 손 목록에서 지운다`);
  return [...missing, ...stale];
}

/**
 * 손 목록이 실제와 어긋났는지. 자동 수집이 이미 찾은 패키지가 손 목록에도 있으면 손 목록에서 지우라고 알린다
 * (경로가 바뀌어 import 그래프에 들어왔다는 뜻이고, 그대로 두면 손 목록이 왜 있는지 아무도 모르게 된다).
 * 패키지가 아예 없어진 것은 플러그인이 설치본을 못 찾아 따로 알린다.
 */
export function manualConflicts(manual: ManualNotice[], auto: Notice[]): string[] {
  const found = new Set(auto.map((n) => n.name));
  return manual.filter((m) => m.kind === "package" && found.has(m.package)).map((m) => (m as { package: string }).package);
}

/** 같은 이름·판은 하나로 합친다(웹 번들과 서버가 같이 쓰는 패키지 등). 덮는 조각은 합치고, 전문은 먼저 찾은 것 */
export function mergeNotices(list: Notice[]): Notice[] {
  const map = new Map<string, Notice>();
  for (const n of list) {
    const key = `${n.name}@${n.version}`;
    const had = map.get(key);
    if (!had) map.set(key, { ...n, parts: [...n.parts] });
    else {
      for (const p of n.parts) if (!had.parts.includes(p)) had.parts.push(p);
      if (!had.texts.length) had.texts = n.texts;
    }
  }
  return [...map.values()];
}

/** 전문 비교·출력용: 줄 끝(CRLF·뒤 공백)과 앞뒤 빈 줄만 맞춘다. 글은 바꾸지 않는다 */
export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+|\n+$/g, "");
}

const PART_TITLE: Record<NoticePart, string> = {
  web: "Web app (JavaScript, CSS, fonts and data loaded in the browser or app window)",
  server: "Server (Node.js runtime packages in the Docker image)",
  app: "Desktop app (Rust crates compiled into the app)",
};

export const RULE = "=".repeat(80);
const THIN = "-".repeat(80);

/** 원본 주소를 줄에 함께 적는가: MPL-2.0 은 실행 형태로 배포할 때 소스를 얻는 법을 알려야 하고(§3.2), 표준 전문을 붙인 것은 원본에서 확인하게 */
const showsSource = (n: Notice) => n.standard || spdxIds(n.chosen ?? n.license).includes("MPL-2.0");

/** 줄의 라이선스 칸. 고른 것이 있으면 함께, package.json 에 적지 않았으면 그렇다고(전문은 파일에서 읽었다) */
function licenseLabel(n: Notice): string {
  if (n.chosen) return `${n.license}, used under ${n.chosen}`;
  return n.license === "UNKNOWN" ? "license not declared in package metadata (see text below)" : n.license;
}

/**
 * licenses.txt 의 글. 전문이 같은 패키지끼리 묶어 전문을 한 번만 싣는다(MIT·Apache 전문이 수백 번 되풀이되지 않게).
 * 묶음 머리에 패키지마다 「이름 판 — 라이선스 [조각]」 한 줄. 전문이 없는 고지는 받지 않는다(withStandardText 를 먼저 거친다).
 */
export function renderNotices(notices: Notice[], appVersion: string): string {
  const bare = notices.filter((n) => !n.texts.length).map((n) => n.name);
  if (bare.length) throw new Error(`라이선스 전문이 없는 고지: ${bare.join(", ")}`);
  const parts = (["web", "server", "app"] as const).filter((p) => notices.some((n) => n.parts.includes(p)));
  const groups = new Map<string, Notice[]>();
  for (const n of notices) {
    const key = n.texts.map(normalizeText).join("\n\n");
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const byName = (a: Notice, b: Notice) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en");
  const line = (n: Notice) => `${n.name} ${n.version} — ${licenseLabel(n)}  [${n.parts.join(", ")}]${showsSource(n) && n.source ? `  ${n.source}` : ""}`;
  const blocks = [...groups.entries()]
    .map(([key, list]) => ({ list: list.sort(byName), key }))
    .sort((a, b) => byName(a.list[0], b.list[0]))
    .map(({ list, key }) => [RULE, ...list.map(line), THIN, key].join("\n"));
  const head = [
    `Keyring Notes ${appVersion} — third-party software notices`,
    "",
    "Keyring Notes is released under the MIT License (LICENSE in the source repository).",
    "This build includes the third-party software listed below, each under its own license.",
    "Packages that share the same license text are listed together above that text.",
    ...(notices.some((n) => spdxIds(n.chosen ?? n.license).includes("MPL-2.0"))
      ? ["The source code of each MPL-2.0 component is available at the address listed next to it."]
      : []),
    "",
    "Parts covered by this file:",
    ...parts.map((p) => `  [${p}] ${PART_TITLE[p]}: ${notices.filter((n) => n.parts.includes(p)).length}`),
  ];
  return `${[head.join("\n"), ...blocks].join("\n\n")}\n`;
}

/** licenses.txt 를 묶음(RULE 줄로 시작) 단위로 나눈다 — 화면이 묶음마다 따로 그려 큰 고지에서도 레이아웃을 한 번에 하지 않게. 이어 붙이면 원래 글이다 */
export function splitNoticeBlocks(text: string): string[] {
  const at = text.split(new RegExp(`(?=^${RULE}$)`, "m"));
  return at.filter((b) => b.length);
}
