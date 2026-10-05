import DOMPurify from "dompurify";

/**
 * DOMPurify 기본 허용 URI에 앱의 첨부 URL을 더한다: 데스크톱·모바일 앱의 파일(asset:), 브라우저 로컬 볼트의 blob:.
 * javascript: 등 나머지는 그대로 막힌다.
 */
const SAFE_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|asset|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
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

interface RenderEnv extends RenderContext {
  widgets: string[];
  lineOffset: number;
}

const ctxOf = (env: unknown) => env as RenderEnv;

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

// ```widget 블록은 자리만 만들고, 실제 위젯은 React가 그 자리에 그린다.
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  if (tokens[idx].info.trim() === "widget") {
    const ctx = ctxOf(env);
    ctx.widgets.push(tokens[idx].content);
    return `<div class="widget-slot" data-widget="${ctx.widgets.length - 1}"></div>`;
  }
  return defaultFence(tokens, idx, opts, env, self);
};

// "- [ ] 할 일" 목록을 체크박스로. data-task-line은 문서 전체 기준 줄 번호(1부터).
md.core.ruler.push("tasks", (state) => {
  const offset = ctxOf(state.env).lineOffset;
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const m = /^\[([ xX])\]\s+/.exec(t.content);
    const first = t.children?.[0];
    if (!m || !first || first.type !== "text" || !first.content.startsWith(m[0].trimEnd()) || !t.map) continue;
    first.content = first.content.slice(m[0].trimEnd().length).replace(/^\s+/, "");
    const box = new state.Token("html_inline", "", 0);
    const checked = m[1] !== " ";
    box.content = `<input type="checkbox" class="task" data-task-line="${offset + t.map[0] + 1}"${checked ? " checked" : ""}> `;
    t.children!.unshift(box);
    tokens[i - 2].attrJoin("class", "task-item");
  }
});

/** 맨 앞 YAML 프런트매터를 본문과 분리한다. */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(content);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: content.slice(m[0].length) };
}

export interface Rendered {
  html: string;
  /** 위젯 블록 원문. html 안의 .widget-slot[data-widget=i] 자리와 순서가 같다. */
  widgets: string[];
}

export function renderMarkdown(content: string, ctx: RenderContext): Rendered {
  const { frontmatter, body } = splitFrontmatter(content);
  let html = "";
  if (frontmatter !== null) {
    html += `<pre class="frontmatter">${escapeHtml(frontmatter)}</pre>`;
  }
  const lineOffset = content.slice(0, content.length - body.length).split("\n").length - 1;
  const env: RenderEnv = { ...ctx, widgets: [], lineOffset };
  html += md.render(body, env as unknown as Record<string, unknown>);
  return { html: DOMPurify.sanitize(html, { ADD_ATTR: ["target"], ALLOWED_URI_REGEXP: SAFE_URI }), widgets: env.widgets };
}
