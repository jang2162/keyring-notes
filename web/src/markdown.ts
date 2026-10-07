import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import type { StateBlock, StateCore, StateInline, Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import { LinkIndex, stripComments, type DailyLookup } from "@keyring-notes/core";
import { api, type TreeNode } from "./api";
import { t } from "./i18n";

/**
 * DOMPurify 기본 허용 URI에 앱의 첨부 URL을 더한다: 데스크톱·모바일 앱의 파일(asset:), 브라우저 로컬 볼트의 blob:.
 * javascript: 등 나머지는 그대로 막힌다.
 */
export const SAFE_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|asset|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * 위키링크 대상 이름 → 실제 경로. Obsidian처럼 경로 없이 파일 이름만 써도 찾는다. core의 LinkIndex(resolveLink와 같은 규칙):
 * 링크를 쓴 문서(from)의 워크스페이스 안에서 먼저 찾고, 데일리 설정이 있으면 `[[2026-10-07]]`도 그날 데일리 노트로.
 */
export class LinkResolver {
  private index: LinkIndex;

  constructor(
    tree: TreeNode[],
    readonly daily: DailyLookup | null = null,
  ) {
    const paths: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === "dir") walk(n.children ?? []);
        else paths.push(n.path);
      }
    };
    walk(tree);
    this.index = new LinkIndex(paths);
  }

  /** 정확한 경로(대소문자 무시)로만 찾는다(상대 경로 마크다운 링크용) */
  exact(path: string): string | null {
    return this.index.get(path);
  }

  get paths(): string[] {
    return this.index.paths;
  }

  /** from: 링크를 쓴 문서(같은 워크스페이스 먼저) */
  resolve(target: string, from?: string | null): string | null {
    return this.index.resolve(target, { daily: this.daily, from });
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
  /** 각주 id 앞붙임(임베드한 문서의 각주가 본문 것과 겹치지 않게) */
  docId: string;
}

const ctxOf = (env: unknown) => env as RenderEnv;

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
md.inline.ruler.before("link", "wikilink", wikilinkRule);
// ==하이라이트== → <mark>, 각주 [^1]
md.use(mark);
md.use(footnote);

// ── 수식: $…$(인라인), $$…$$(블록). 여기서는 자리만 만들고 KaTeX는 그린 뒤에 불러 채운다(enhance.ts) ──
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  const display = src.charCodeAt(start + 1) === 0x24;
  const open = display ? 2 : 1;
  // 인라인 $: 여는 $ 바로 뒤가 공백이면 수식이 아니다(금액 "$5 and $6" 등)
  if (!display && /\s/.test(src[start + 1] ?? " ")) return false;
  let end = start + open;
  for (;;) {
    end = src.indexOf(display ? "$$" : "$", end);
    if (end < 0) return false;
    if (src[end - 1] === "\\") {
      end++;
      continue;
    }
    break;
  }
  const tex = src.slice(start + open, end);
  if (!tex.trim()) return false;
  // 닫는 $ 앞이 공백이거나 바로 뒤가 숫자면 수식이 아니다
  if (!display && (/\s/.test(tex[tex.length - 1]) || /\d/.test(src[end + 1] ?? ""))) return false;
  if (!silent) {
    const token = state.push(display ? "math_display" : "math_inline", "", 0);
    token.content = tex;
  }
  state.pos = end + open;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineStart = state.bMarks[startLine] + state.tShift[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = state.src.slice(lineStart, state.eMarks[startLine]);
  if (!first.startsWith("$$")) return false;
  if (silent) return true;
  let tex: string;
  let next = startLine;
  const rest = first.slice(2);
  if (rest.trimEnd().endsWith("$$") && rest.trim().length > 2) {
    tex = rest.trimEnd().slice(0, -2);
  } else {
    const lines = [rest];
    let closed = false;
    while (++next < endLine) {
      const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
      const at = line.indexOf("$$");
      if (at >= 0) {
        lines.push(line.slice(0, at));
        closed = true;
        break;
      }
      lines.push(line);
    }
    if (!closed) return false;
    tex = lines.join("\n");
  }
  state.line = next + 1;
  const token = state.push("math_block", "div", 0);
  token.block = true;
  token.content = tex.trim();
  token.map = [startLine, state.line];
  return true;
}

md.inline.ruler.after("escape", "math_inline", mathInline);
md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
// 원문은 속성에 퍼센트 인코딩해 넣는다: DOMPurify가 "-->" 같은 값이 든 속성을 지우기 때문(SAFE_FOR_XML)
const srcAttr = (s: string) => escapeHtml(encodeURIComponent(s));
md.renderer.rules.math_inline = (tokens, idx) => `<span class="math" data-tex="${srcAttr(tokens[idx].content)}">${escapeHtml(tokens[idx].content)}</span>`;
md.renderer.rules.math_display = (tokens, idx) =>
  `<span class="math math-display" data-tex="${srcAttr(tokens[idx].content)}">${escapeHtml(tokens[idx].content)}</span>`;
md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="math math-display" data-tex="${srcAttr(tokens[idx].content)}">${escapeHtml(tokens[idx].content)}</div>\n`;

/** `#제목`·`#^블록` 부분을 링크 속성으로(문서를 연 뒤 그 위치로 이동) */
function anchorAttrs(heading?: string): string {
  if (!heading) return "";
  return heading.startsWith("^") ? ` data-block="${escapeHtml(heading.slice(1))}"` : ` data-heading="${escapeHtml(heading.toLowerCase())}"`;
}

md.renderer.rules.wikilink = (tokens, idx, _opts, env) => {
  const { resolver, docPath } = ctxOf(env);
  const { target, heading, alias } = tokens[idx].meta as unknown as WikiMeta;
  const resolved = target ? resolver.resolve(target, docPath) : docPath;
  const label = alias || (heading ? `${target}${target ? " › " : ""}${heading.replace(/^\^/, "")}` : target);
  const cls = resolved ? "wikilink" : "wikilink unresolved";
  return `<a href="#" class="${cls}" data-wikilink="${escapeHtml(resolved ?? target)}" data-resolved="${resolved ? 1 : 0}"${anchorAttrs(heading)}>${escapeHtml(label)}</a>`;
};

md.renderer.rules.wikiembed = (tokens, idx, _opts, env) => {
  const { resolver, docPath } = ctxOf(env);
  const token = tokens[idx];
  const { target, heading, alias } = token.meta as unknown as WikiMeta;
  const resolved = target ? resolver.resolve(target, docPath) : heading ? docPath : null;
  if (resolved && IMAGE_EXT.test(resolved)) {
    // Obsidian의 ![[img.png|300]] 크기 지정
    const width = alias && /^\d+$/.test(alias) ? ` width="${alias}"` : "";
    return `<img src="${escapeHtml(api.rawUrl(resolved))}" alt="${escapeHtml(target)}"${width}>`;
  }
  const cls = resolved ? "wikilink embed" : "wikilink unresolved";
  const link = `<a href="#" class="${cls}" data-wikilink="${escapeHtml(resolved ?? target)}" data-resolved="${resolved ? 1 : 0}"${anchorAttrs(heading)}>↪ ${escapeHtml(alias || target || heading || "")}</a>`;
  // 문단에 임베드만 있으면(standalone) 문서 내용을 끼워 넣을 자리를 만든다. 내용은 enhance.ts가 권한 계층(API)으로 읽어 채운다.
  if (resolved && /\.md$/i.test(resolved) && token.meta?.standalone) {
    return `<div class="note-embed" data-embed="${escapeHtml(resolved)}"${heading ? ` data-anchor="${escapeHtml(heading)}"` : ""}>${link}</div>`;
  }
  return link;
};

// 상대 경로 마크다운 링크([x](a.md))는 문서 위치 기준으로 볼트 문서를 열게 한다(외부 주소·#앵커는 그대로).
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const { resolver, docPath } = ctxOf(env);
  const token = tokens[idx];
  const href = String(token.attrGet("href") ?? "");
  if (href && !/^[a-z][a-z0-9+.-]*:|^\/\/|^#|^\//i.test(href)) {
    const hashAt = href.indexOf("#");
    const pathPart = hashAt < 0 ? href : href.slice(0, hashAt);
    let decoded = pathPart;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      /* 잘못된 퍼센트 인코딩은 그대로 둔다 */
    }
    const rel = joinRelative(dirname(docPath), decoded);
    const resolved = resolver.exact(rel);
    const anchor = hashAt < 0 ? undefined : decodeURIComponent(href.slice(hashAt + 1));
    token.attrSet("href", "#");
    token.attrSet("data-wikilink", resolved ?? rel);
    token.attrSet("data-resolved", resolved ? "1" : "0");
    token.attrJoin("class", resolved ? "wikilink mdlink" : "wikilink mdlink unresolved");
    if (anchor) token.attrSet(anchor.startsWith("^") ? "data-block" : "data-heading", anchor.startsWith("^") ? anchor.slice(1) : anchor.toLowerCase());
  }
  return self.renderToken(tokens, idx, opts);
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
    token.attrSet("src", api.rawUrl(resolver.resolve(rel, docPath) ?? rel));
  }
  return defaultImage(tokens, idx, opts, env, self);
};

// ```widget 블록은 자리만 만들고, 실제 위젯은 React가 그 자리에 그린다.
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const info = tokens[idx].info.trim().split(/\s+/)[0];
  if (info === "widget") {
    const ctx = ctxOf(env);
    ctx.widgets.push(tokens[idx].content);
    return `<div class="widget-slot" data-widget="${ctx.widgets.length - 1}"></div>`;
  }
  // Mermaid: 원문을 먼저 보이고, 다이어그램은 enhance.ts가 필요할 때만 불러 그린다
  if (info === "mermaid") {
    const src = tokens[idx].content;
    return `<div class="mermaid-slot" data-src="${srcAttr(src)}"><pre><code>${escapeHtml(src)}</code></pre></div>\n`;
  }
  return defaultFence(tokens, idx, opts, env, self);
};

// ── 콜아웃 > [!note] 제목 (+/-로 접기), 블록 ID ^id, 제목 위치 속성, 단독 임베드 ──
const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

md.core.ruler.push("callouts", (state: StateCore) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;
    const p = tokens[i + 1];
    const inline = tokens[i + 2];
    if (p?.type !== "paragraph_open" || inline?.type !== "inline" || !inline.children) continue;
    const m = CALLOUT_RE.exec(inline.content);
    if (!m) continue;
    // 첫 줄(첫 줄바꿈까지)은 제목, 나머지는 본문
    const kids = inline.children;
    const br = kids.findIndex((k) => k.type === "softbreak" || k.type === "hardbreak");
    const titleKids = br < 0 ? kids : kids.slice(0, br);
    const bodyKids = br < 0 ? [] : kids.slice(br + 1);
    if (titleKids[0]?.type !== "text" || !CALLOUT_RE.test(titleKids[0].content)) continue;
    titleKids[0].content = titleKids[0].content.replace(CALLOUT_RE, "");
    inline.children = bodyKids;
    if (bodyKids.length === 0) {
      p.hidden = true;
      tokens[i + 3].hidden = true;
    }
    // 짝이 되는 blockquote_close
    let depth = 0;
    let close = -1;
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === "blockquote_open") depth++;
      else if (tokens[j].type === "blockquote_close" && --depth === 0) {
        close = j;
        break;
      }
    }
    const kind = m[1].toLowerCase();
    const meta = { kind, fold: m[2], title: titleKids };
    tokens[i].meta = { callout: meta };
    if (close >= 0) tokens[close].meta = { callout: meta };
  }
});

/** 콜아웃 기본 제목: 종류 → 메시지 키(같은 뜻은 한 키로) */
const CALLOUT_LABEL: Record<string, string> = {
  note: "note", info: "info", todo: "todo", abstract: "summary", summary: "summary", tldr: "summary", tip: "tip", hint: "tip", important: "important",
  success: "success", check: "success", done: "success", question: "question", help: "question", faq: "faq", warning: "warning", caution: "warning",
  attention: "warning", failure: "failure", fail: "failure", missing: "missing", danger: "danger", error: "error", bug: "bug", example: "example",
  quote: "quote", cite: "quote",
};
/** 콜아웃 종류 → 색 묶음(styles.css의 .callout-*) */
const CALLOUT_GROUP: Record<string, string> = {
  note: "blue", info: "blue", todo: "blue", abstract: "teal", summary: "teal", tldr: "teal", tip: "green", hint: "green", important: "green",
  success: "green", check: "green", done: "green", question: "yellow", help: "yellow", faq: "yellow", warning: "orange", caution: "orange",
  attention: "orange", failure: "red", fail: "red", missing: "red", danger: "red", error: "red", bug: "red", example: "purple", quote: "gray", cite: "gray",
};

md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
  const c = tokens[idx].meta?.callout as { kind: string; fold: string; title: Token[] } | undefined;
  if (!c) return self.renderToken(tokens, idx, opts);
  const title = md.renderer.renderInline(c.title, opts, env).trim() || escapeHtml(CALLOUT_LABEL[c.kind] ? t(`callout.${CALLOUT_LABEL[c.kind]}`) : c.kind);
  const cls = `callout callout-${CALLOUT_GROUP[c.kind] ?? "blue"}`;
  const line = tokens[idx].attrGet("data-line");
  const at = line ? ` data-line="${escapeHtml(String(line))}"` : "";
  if (c.fold) return `<details class="${cls}" data-callout="${escapeHtml(c.kind)}"${c.fold === "+" ? " open" : ""}><summary class="callout-title">${title}</summary><div class="callout-body">\n`;
  return `<div class="${cls}" data-callout="${escapeHtml(c.kind)}"${at}><div class="callout-title">${title}</div><div class="callout-body">\n`;
};
md.renderer.rules.blockquote_close = (tokens, idx, opts, _env, self) => {
  const c = tokens[idx].meta?.callout as { fold: string } | undefined;
  if (!c) return self.renderToken(tokens, idx, opts);
  return c.fold ? "</div></details>\n" : "</div></div>\n";
};

const BLOCK_ID_RE = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/;
const BLOCK_ID_ONLY_RE = /^\^([A-Za-z0-9-]+)$/;

md.core.ruler.push("blocks", (state: StateCore) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 제목: 위치 이동용 속성
    if (t.type === "heading_open" && tokens[i + 1]?.type === "inline") {
      t.attrSet("data-heading", tokens[i + 1].content.replace(BLOCK_ID_RE, "").trim().toLowerCase());
      continue;
    }
    if (t.type !== "inline" || !t.children?.length || tokens[i - 1]?.type !== "paragraph_open") continue;
    const open = tokens[i - 1];
    // 단독 임베드: 문단에 ![[…]] 하나만
    const real = t.children.filter((k) => !(k.type === "text" && !k.content.trim()));
    if (real.length === 1 && real[0].type === "wikiembed") {
      real[0].meta = { ...real[0].meta, standalone: true };
      open.hidden = true;
      tokens[i + 1].hidden = true;
    }
    // 줄 끝 ^id: 표시는 숨기고 그 블록(문단, 목록 항목이면 그 항목)의 위치로 쓴다
    const last = t.children[t.children.length - 1];
    if (last.type === "text") {
      const only = BLOCK_ID_ONLY_RE.exec(t.content.trim());
      if (only && t.children.length === 1) {
        // ^id만 있는 줄: 바로 앞 블록(표·인용 등)의 위치
        last.content = "";
        open.hidden = true;
        tokens[i + 1].hidden = true;
        for (let j = i - 2; j >= 0; j--) {
          if (tokens[j].nesting === 1 && tokens[j].level === open.level) {
            tokens[j].attrSet("data-block", only[1]);
            break;
          }
        }
        continue;
      }
      const m = BLOCK_ID_RE.exec(last.content);
      if (m) {
        last.content = last.content.slice(0, m.index);
        const owner = tokens[i - 2]?.type === "list_item_open" ? tokens[i - 2] : open;
        owner.attrSet("data-block", m[1]);
      }
    }
  }
});

// 접기(folds.ts)에 쓰는 줄 번호: 제목·목록 항목·표·코드 블록·인용(콜아웃)의 첫 줄(문서 전체 기준, 1부터)
md.core.ruler.push("fold_lines", (state: StateCore) => {
  const offset = ctxOf(state.env).lineOffset;
  for (const t of state.tokens) {
    if (!t.map) continue;
    if (t.type === "heading_open" || t.type === "list_item_open" || t.type === "table_open" || t.type === "fence" || t.type === "blockquote_open") {
      t.attrSet("data-line", String(offset + t.map[0] + 1));
    }
  }
});

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

export function renderMarkdown(content: string, ctx: RenderContext & { docId?: string; hideFrontmatter?: boolean }): Rendered {
  const split = splitFrontmatter(content);
  const frontmatter = ctx.hideFrontmatter ? null : split.frontmatter;
  // 주석 %%…%%은 미리보기에서 숨긴다(줄 수는 그대로라 할 일 줄 번호가 맞는다)
  const body = stripComments(split.body);
  let html = "";
  if (frontmatter !== null) {
    html += `<pre class="frontmatter">${escapeHtml(frontmatter)}</pre>`;
  }
  const lineOffset = content.slice(0, content.length - split.body.length).split("\n").length - 1;
  const env: RenderEnv = { ...ctx, widgets: [], lineOffset, docId: ctx.docId ?? "d" };
  html += md.render(body, env as unknown as Record<string, unknown>);
  // DOMPurify 기본 설정(HTML·SVG·MathML, data-* 허용)에 링크 target과 앱 첨부 URL(asset:·blob:)만 더한다.
  // 수식·다이어그램은 여기서는 원문 자리뿐이고, 그린 결과는 enhance.ts에서 따로 정화한다.
  return { html: DOMPurify.sanitize(html, { ADD_ATTR: ["target"], ALLOWED_URI_REGEXP: SAFE_URI }), widgets: env.widgets };
}
