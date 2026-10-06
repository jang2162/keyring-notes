import { parseFrontmatter, resolveLink } from "./markdown.js";

/**
 * 이름 바꾸기·이동 때 다른 문서의 링크를 고친다(서버 Vault.batch와 앱 LocalVault가 같이 쓴다).
 *
 * 링크마다 이동 전 경로 목록으로 해석한 대상 R0와 이동 후 목록으로 해석한 대상 R1을 구해,
 * 기대 대상(moves.get(R0) ?? R0)과 R1이 다를 때만 고친다. 그래서
 *   - 이동한 문서를 가리키던 링크는 새 위치로,
 *   - 이동한 문서가 더 얕은 같은 이름이 되어 다른 문서의 링크를 가로채는 경우는 원래 대상으로
 * 둘 다 고쳐진다. R0가 없거나(원래 깨진 링크) 기대 대상이 이동 후에 없으면(같은 일괄 쓰기에서 삭제) 그대로 둔다.
 *
 * 고치는 곳: 본문 위키링크 `[[…]]`·`![[…]]`, 프런트매터 sources/source의 `[[…]]`와 경로 값,
 * 상대 경로 마크다운 링크·이미지 `[x](../a.md)`. 펜스 코드 블록과 인라인 코드 안은 건드리지 않는다.
 */
export interface LinkRewriteContext {
  /** 이동: 원래 경로 → 새 경로(같은 일괄 쓰기 안의 연쇄 이동은 합쳐서) */
  moves: Map<string, string>;
  /** 이동 전 경로 목록(링크를 해석할 수 있는 파일 전체, 첨부 포함) */
  before: string[];
  /** 이동 후 경로 목록 */
  after: string[];
  /** 늘 전체 경로로 쓴다(에이전트: 짧은 이름이 되는지로 숨김 문서가 드러나지 않게) */
  fullPaths?: boolean;
}

export interface LinkRewriteResult {
  content: string;
  /** 고친 링크 수 */
  count: number;
}

const WIKILINK_RE = /(!?)\[\[([^\]\n|#]*)((?:#[^\]\n|]*)?)((?:\|[^\]\n]*)?)\]\]/g;
const MDLINK_RE = /(!?)\[((?:[^\]\\\n]|\\.)*)\]\((<[^>\n]*>|[^)\s]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?)\)/g;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** 볼트 상대 경로 정규화(.·.. 처리). 볼트 밖으로 나가면 null. */
function normalizeRel(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

/** from 폴더에서 to 파일로 가는 상대 경로 */
function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

class Rewriter {
  private beforeSet: Set<string>;
  private afterSet: Set<string>;
  count = 0;

  constructor(private ctx: LinkRewriteContext) {
    this.beforeSet = new Set(ctx.before);
    this.afterSet = new Set(ctx.after);
  }

  /** 위키링크식 대상(전역 최단 경로 해석)을 고쳐야 하면 새 대상, 아니면 null */
  wikiTarget(target: string): string | null {
    const t = target.trim();
    if (!t) return null;
    const r0 = resolveLink(t, this.ctx.before);
    if (!r0) return null;
    const expected = this.ctx.moves.get(r0) ?? r0;
    if (!this.afterSet.has(expected)) return null;
    if (resolveLink(t, this.ctx.after) === expected) return null;
    return this.format(expected, t);
  }

  /** 고친 대상의 모양: 원래 /가 있었거나 fullPaths면 전체 경로, 아니면 해석이 맞는 가장 짧은 이름. .md는 원래대로 */
  private format(expected: string, original: string): string {
    const keepMd = /\.md$/i.test(original);
    const strip = (p: string) => (!keepMd && /\.md$/i.test(p) ? p.slice(0, -3) : p);
    if (this.ctx.fullPaths || original.includes("/")) return strip(expected);
    const segs = expected.split("/");
    for (let k = 1; k <= segs.length; k++) {
      const cand = strip(segs.slice(segs.length - k).join("/"));
      if (resolveLink(cand, this.ctx.after) === expected) return cand;
    }
    return strip(expected);
  }

  wikilinks(text: string): string {
    return text.replace(WIKILINK_RE, (all, bang: string, target: string, heading: string, alias: string) => {
      const next = this.wikiTarget(target);
      if (next === null) return all;
      this.count++;
      return `${bang}[[${next}${heading}${alias}]]`;
    });
  }

  /** 상대 경로 마크다운 링크: oldPath(문서의 원래 위치) 기준으로 해석해 실제 파일일 때만, newPath 기준으로 다시 쓴다 */
  mdlinks(text: string, oldPath: string, newPath: string): string {
    return text.replace(MDLINK_RE, (all, bang: string, label: string, url: string, title: string) => {
      const angle = url.startsWith("<");
      const raw = angle ? url.slice(1, -1) : url;
      if (!raw || raw.startsWith("#") || raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return all;
      const hashAt = raw.indexOf("#");
      const pathPart = hashAt < 0 ? raw : raw.slice(0, hashAt);
      const fragment = hashAt < 0 ? "" : raw.slice(hashAt);
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        decoded = pathPart;
      }
      const r0 = normalizeRel(`${dirname(oldPath)}/${decoded}`);
      if (!r0 || !this.beforeSet.has(r0)) return all;
      const expected = this.ctx.moves.get(r0) ?? r0;
      if (!this.afterSet.has(expected)) return all;
      if (normalizeRel(`${dirname(newPath)}/${decoded}`) === expected) return all;
      const rel = relativePath(dirname(newPath), expected);
      const encoded = angle
        ? rel
        : /%[0-9a-f]{2}/i.test(pathPart.replace(/%20|%28|%29/gi, ""))
          ? encodeURI(rel).replace(/\(/g, "%28").replace(/\)/g, "%29")
          : rel.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
      this.count++;
      return `${bang}[${label}](${angle ? `<${encoded}${fragment}>` : `${encoded}${fragment}`}${title})`;
    });
  }

  /** 프런트매터 sources 값 하나(따옴표 포함 가능): [[…]]가 있으면 위키링크로, 아니면 경로 값으로 */
  sourceValue(token: string): string {
    if (token.includes("[[")) return this.wikilinks(token);
    const m = /^(\s*)(["']?)(.*?)\2(\s*)$/.exec(token);
    if (!m || !m[3] || /^[a-z][a-z0-9+.-]*:\/\//i.test(m[3])) return token;
    const v = m[3];
    const target = v.split("|")[0].split("#")[0];
    const next = this.wikiTarget(target);
    if (next === null) return token;
    this.count++;
    return `${m[1]}${m[2]}${next}${v.slice(target.length)}${m[2]}${m[4]}`;
  }
}

/** 코드(인라인 `…`)를 피해 나머지 부분에만 fn을 적용한다 */
function outsideInlineCode(line: string, fn: (s: string) => string): string {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}

/**
 * 문서 하나의 링크를 고친다. oldPath는 이동 전 위치(이동하지 않은 문서는 newPath와 같다).
 * 바뀐 것이 없으면 null.
 */
export function rewriteLinks(content: string, oldPath: string, newPath: string, ctx: LinkRewriteContext): LinkRewriteResult | null {
  // 빠른 거르기: 이동한 이름(원래·새 파일 이름, 인코딩한 형태)이 본문에 없고 자기 위치도 그대로면 건너뛴다
  if (oldPath === newPath) {
    const lower = content.toLowerCase();
    const names = new Set<string>();
    for (const [from, to] of ctx.moves) {
      for (const p of [from, to]) {
        const base = p.split("/").pop()!.toLowerCase();
        const stem = base.replace(/\.md$/i, "");
        const enc = encodeURIComponent(stem).toLowerCase();
        names.add(stem);
        names.add(enc);
        names.add(enc.replace(/\(/g, "%28").replace(/\)/g, "%29"));
        names.add(stem.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29"));
      }
    }
    if (![...names].some((n) => n && lower.includes(n))) return null;
  }
  const rw = new Rewriter(ctx);
  const lines = content.split("\n");
  const fm = parseFrontmatter(content);
  // 프런트매터: sources/source 키 아래 값만
  let inSources = false;
  for (let i = 1; i < fm.lines - 1; i++) {
    const line = lines[i];
    const key = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(line);
    if (key) {
      inSources = key[1] === "sources" || key[1] === "source";
      if (!inSources) continue;
      const value = key[2];
      const head = line.slice(0, line.length - value.length);
      const flow = /^(\s*)\[(.*)\](\s*)$/.exec(value);
      lines[i] = flow
        ? head + flow[1] + "[" + splitFlow(flow[2]).map((t) => rw.sourceValue(t)).join(",") + "]" + flow[3]
        : head + rw.sourceValue(value);
      continue;
    }
    if (!inSources) continue;
    if (!/^\s|^-/.test(line)) {
      inSources = false;
      continue;
    }
    const item = /^(\s*-\s+)(.*)$/.exec(line);
    if (item) lines[i] = item[1] + rw.sourceValue(item[2]);
  }
  // 본문: 펜스 코드 블록 밖, 인라인 코드 밖
  let fence: string | null = null;
  for (let i = Math.max(fm.lines, 0); i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0].repeat(f[1].length);
      else if (f[1].startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    lines[i] = outsideInlineCode(line, (s) => rw.mdlinks(rw.wikilinks(s), oldPath, newPath));
  }
  if (rw.count === 0) return null;
  return { content: lines.join("\n"), count: rw.count };
}

/** YAML 흐름 목록 안의 항목을 쉼표로 나눈다(따옴표·[[ ]] 안의 쉼표는 나누지 않는다) */
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * 연쇄 이동을 합친다: [[A,B],[B,C]] → A→C. 이미 이동한 경로를 다시 옮기면 원래 경로 기준으로 고친다.
 */
export function chainMoves(moves: [string, string][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [from, to] of moves) {
    const origin = [...out.entries()].find(([, cur]) => cur === from)?.[0];
    if (origin !== undefined) out.set(origin, to);
    else out.set(from, to);
  }
  for (const [k, v] of out) if (k === v) out.delete(k);
  return out;
}
