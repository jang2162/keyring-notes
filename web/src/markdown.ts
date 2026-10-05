import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import type { StateInline } from "markdown-it";
import { api, type TreeNode } from "./api";

/** 위키링크 대상 이름 → 실제 경로. Obsidian처럼 경로 없이 파일 이름만 써도 찾는다. */
export class LinkResolver {
  private byPath = new Map<string, string>();
  private byName = new Map<string, string[]>();

  constructor(tree: TreeNode[]) {
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "dir") walk(n.children ?? []);
        else {
          const lower = n.path.toLowerCase();
          this.byPath.set(lower, n.path);
          const name = n.name.toLowerCase();
          this.byName.set(name, [...(this.byName.get(name) ?? []), n.path]);
        }
      }
    };
    walk(tree);
  }

  get paths(): string[] {
    return [...this.byPath.values()];
  }

  resolve(target: string): string | null {
    const t = target.trim().replace(/^\/+/, "").toLowerCase();
    if (!t) return null;
    const candidates = /\.[a-z0-9]+$/i.test(t) ? [t] : [`${t}.md`, t];
    for (const c of candidates) {
      const exact = this.byPath.get(c);
      if (exact) return exact;
    }
    for (const c of candidates) {
      const base = c.split("/").pop()!;
      const hits = (this.byName.get(base) ?? []).filter((p) => p.toLowerCase().endsWith(c));
      // 같은 이름이 여러 개면 가장 얕은 경로를 고른다(Obsidian의 최단 경로 규칙).
      if (hits.length) return hits.sort((a, b) => a.split("/").length - b.split("/").length)[0];
    }
    return null;
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** `[[대상#제목|별칭]]`, `![[첨부]]` 를 읽는 인라인 규칙. */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21; /* ! */
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = src.indexOf("]]", pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (!inner || inner.includes("\n") || inner.includes("[[")) return false;
  if (!silent) {
    const [targetPart, alias] = inner.split("|", 2);
    const [target, heading] = targetPart.split("#", 2);
    const token = state.push(embed ? "wikiembed" : "wikilink", "", 0);
    token.meta = { target: target.trim(), heading: heading?.trim(), alias: alias?.trim() };
  }
  state.pos = end + 2;
  return true;
}

function dirname(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function joinRelative(base: string, rel: string): string {
  const out = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

interface WikiMeta {
  target: string;
  heading?: string;
  alias?: string;
}

export interface RenderContext {
  resolver: LinkResolver;
  docPath: string;
}

const ctxOf = (env: unknown) => env as RenderContext;

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
md.inline.ruler.before("link", "wikilink", wikilinkRule);

md.renderer.rules.wikilink = (tokens, idx, _opts, env) => {
  const { resolver, docPath } = ctxOf(env);
  const { target, heading, alias } = tokens[idx].meta as unknown as WikiMeta;
  const resolved = target ? resolver.resolve(target) : docPath;
  const label = alias || (heading ? `${target}${target ? " › " : ""}${heading}` : target);
  const cls = resolved ? "wikilink" : "wikilink unresolved";
  return `<a href="#" class="${cls}" data-wikilink="${escapeHtml(resolved ?? target)}" data-resolved="${resolved ? 1 : 0}">${escapeHtml(label)}</a>`;
};

md.renderer.rules.wikiembed = (tokens, idx, _opts, env) => {
  const { resolver } = ctxOf(env);
  const { target, alias } = tokens[idx].meta as unknown as WikiMeta;
  const resolved = resolver.resolve(target);
  if (resolved && IMAGE_EXT.test(resolved)) {
    // Obsidian의 ![[img.png|300]] 크기 지정
    const width = alias && /^\d+$/.test(alias) ? ` width="${alias}"` : "";
    return `<img src="${escapeHtml(api.rawUrl(resolved))}" alt="${escapeHtml(target)}"${width}>`;
  }
  const cls = resolved ? "wikilink embed" : "wikilink unresolved";
  return `<a href="#" class="${cls}" data-wikilink="${escapeHtml(resolved ?? target)}" data-resolved="${resolved ? 1 : 0}">↪ ${escapeHtml(alias || target)}</a>`;
};

// 상대 경로 이미지(![](img/a.png))는 문서 위치 기준으로 볼트 파일을 가리키게 한다.
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const { resolver, docPath } = ctxOf(env);
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  if (src && !/^[a-z]+:|^\/\//i.test(src)) {
    let decoded = src;
    try {
      decoded = decodeURI(src);
    } catch {
      /* 잘못된 퍼센트 인코딩은 그대로 둔다 */
    }
    const rel = joinRelative(dirname(docPath), decoded);
    token.attrSet("src", api.rawUrl(resolver.resolve(rel) ?? rel));
  }
  return defaultImage(tokens, idx, opts, env, self);
};

// 위젯 블록은 3단계에서 렌더링한다. 지금은 일반 코드 블록과 구분만 해 둔다.
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  if (tokens[idx].info.trim() === "widget") {
    return `<div class="widget-placeholder"><div class="widget-label">위젯 (3단계에서 렌더링)</div><pre>${escapeHtml(tokens[idx].content)}</pre></div>`;
  }
  return defaultFence(tokens, idx, opts, env, self);
};

/** 맨 앞 YAML 프런트매터를 본문과 분리한다. */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(content);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: content.slice(m[0].length) };
}

export function renderMarkdown(content: string, ctx: RenderContext): string {
  const { frontmatter, body } = splitFrontmatter(content);
  let html = "";
  if (frontmatter !== null) {
    html += `<pre class="frontmatter">${escapeHtml(frontmatter)}</pre>`;
  }
  html += md.render(body, { ...ctx });
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}
