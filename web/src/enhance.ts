import DOMPurify from "dompurify";
import { section } from "@keyring-notes/core";
import { api } from "./api";
import { renderMarkdown, SAFE_URI, splitFrontmatter, type LinkResolver } from "./markdown";

/**
 * 미리보기를 그린 뒤 채우는 것들: 수식(KaTeX), 다이어그램(Mermaid), 문서 임베드(![[문서]]).
 * KaTeX·Mermaid는 처음 쓸 때만 불러온다(Mermaid는 수 MB). 같은 원문은 결과를 기억해 두어,
 * 입력할 때마다 미리보기가 다시 그려져도 깜빡이지 않게 바로 채운다.
 */
export interface EnhanceContext {
  resolver: LinkResolver;
  docPath: string;
  /** 임베드 깊이(0: 열린 문서) */
  depth?: number;
  /** 임베드 경로(순환 막기) */
  chain?: string[];
}

const MAX_EMBED_DEPTH = 3;

let katexMod: typeof import("./render/katex") | null = null;
let katexLoading: Promise<typeof import("./render/katex")> | null = null;
const mermaidCache = new Map<string, string>();
const embedCache = new Map<string, Promise<string>>();

/** 볼트가 바뀌면 임베드한 문서 내용을 다시 읽게 한다. */
export function invalidateEmbeds() {
  embedCache.clear();
}

const isDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

/** 그린 수식은 KaTeX 출력(HTML+MathML)만 남기고 정화한다 */
function cleanMath(html: string) {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true }, ALLOWED_URI_REGEXP: SAFE_URI });
}

/** Mermaid SVG는 SVG만 허용해 정화한다(라벨은 SVG 글자로 그려 foreignObject가 필요 없다) */
function cleanSvg(svg: string) {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["style"] });
}

function fillMath(el: HTMLElement) {
  if (!katexMod) return false;
  el.innerHTML = cleanMath(katexMod.renderTex(decodeURIComponent(el.dataset.tex ?? ""), el.classList.contains("math-display")));
  el.dataset.done = "1";
  return true;
}

/** `^id`가 붙은 블록(문단·목록 항목, ^id만 있는 줄이면 바로 앞 블록)의 원문 */
export function blockText(content: string, id: string): string | null {
  const lines = content.split("\n");
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const own = new RegExp(`^\\s*\\^${esc}\\s*$`);
  const tail = new RegExp(`\\s\\^${esc}\\s*$`);
  let at = lines.findIndex((l) => tail.test(l) || own.test(l));
  if (at < 0) return null;
  if (own.test(lines[at])) {
    // ^id만 있는 줄: 앞쪽 빈 줄을 건너뛴 바로 앞 블록
    at--;
    while (at >= 0 && !lines[at].trim()) at--;
    if (at < 0) return null;
  } else if (/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[at])) {
    return lines[at].replace(tail, "");
  }
  let start = at;
  let end = at;
  while (start > 0 && lines[start - 1].trim()) start--;
  while (end < lines.length - 1 && lines[end + 1].trim()) end++;
  return lines
    .slice(start, end + 1)
    .map((l) => l.replace(tail, ""))
    .join("\n");
}

async function fillEmbed(el: HTMLElement, ctx: EnhanceContext, alive: () => boolean) {
  const path = el.dataset.embed!;
  const anchor = el.dataset.anchor;
  const depth = ctx.depth ?? 0;
  const chain = ctx.chain ?? [ctx.docPath];
  el.dataset.done = "1";
  const key = `${path}#${anchor ?? ""}`;
  if (depth >= MAX_EMBED_DEPTH || chain.includes(key) || (chain.includes(path) && !anchor)) {
    el.classList.add("note-embed-stop");
    el.title = depth >= MAX_EMBED_DEPTH ? "임베드가 너무 깊어 링크로만 보입니다" : "자기 자신을 다시 임베드해 링크로만 보입니다";
    return;
  }
  let content: string;
  try {
    let p = embedCache.get(path);
    if (!p) {
      // 권한 계층을 그대로 지나는 API로 읽는다(로컬 모드면 기기 볼트)
      p = api.read(path).then((d) => d.content);
      embedCache.set(path, p);
      p.catch(() => embedCache.delete(path));
    }
    content = await p;
  } catch {
    // 읽을 수 없거나 없는 문서는 끊어진 링크로
    el.querySelector("a")?.classList.add("unresolved");
    el.querySelector("a")?.setAttribute("data-resolved", "0");
    el.classList.add("note-embed-stop");
    return;
  }
  if (!alive()) return;
  let text: string | null = splitFrontmatter(content).body;
  if (anchor?.startsWith("^")) text = blockText(content, anchor.slice(1));
  else if (anchor) {
    try {
      text = section(content, { heading: anchor }).content;
    } catch {
      text = null;
    }
  }
  if (text === null) {
    el.querySelector("a")?.classList.add("unresolved");
    el.classList.add("note-embed-stop");
    el.title = "가리키는 제목·블록이 없습니다";
    return;
  }
  const r = renderMarkdown(text, { resolver: ctx.resolver, docPath: path, docId: `e${depth + 1}`, hideFrontmatter: true });
  const head = el.querySelector("a")?.outerHTML ?? "";
  el.innerHTML = `<div class="note-embed-head">${head}</div><div class="note-embed-body">${r.html}</div>`;
  const body = el.querySelector<HTMLElement>(".note-embed-body")!;
  // 임베드 안의 위젯·할 일 체크는 원본 문서에서 다룬다(여기서 누르면 열린 문서의 줄이 바뀌므로)
  for (const slot of body.querySelectorAll<HTMLElement>(".widget-slot")) {
    slot.className = "widget-embedded-note meta";
    slot.textContent = "위젯은 원본 문서에서 볼 수 있습니다.";
  }
  for (const box of body.querySelectorAll<HTMLInputElement>("input.task")) {
    box.removeAttribute("data-task-line");
    box.disabled = true;
  }
  enhance(body, { resolver: ctx.resolver, docPath: path, depth: depth + 1, chain: [...chain, key] }, alive);
}

/**
 * root 안의 자리(.math, .mermaid-slot, .note-embed)를 채운다. 돌려준 함수를 부르면 늦게 끝난 작업이 더는 손대지 않는다.
 */
export function enhance(root: HTMLElement, ctx: EnhanceContext, parentAlive?: () => boolean): () => void {
  let live = true;
  const alive = () => live && (parentAlive ? parentAlive() : true);

  const maths = [...root.querySelectorAll<HTMLElement>(".math[data-tex]:not([data-done])")];
  const pending = maths.filter((el) => !fillMath(el));
  if (pending.length) {
    katexLoading ??= import("./render/katex");
    void katexLoading.then((m) => {
      katexMod = m;
      if (alive()) for (const el of pending) fillMath(el);
    });
  }

  const dark = isDark();
  for (const el of root.querySelectorAll<HTMLElement>(".mermaid-slot[data-src]:not([data-done])")) {
    const src = decodeURIComponent(el.dataset.src ?? "");
    const key = `${dark ? "d" : "l"}:${src}`;
    el.dataset.done = "1";
    const cached = mermaidCache.get(key);
    if (cached !== undefined) {
      el.innerHTML = cached;
      continue;
    }
    void import("./render/mermaid")
      .then((m) => m.renderMermaid(src, dark))
      .then((svg) => {
        const clean = `<div class="mermaid-svg">${cleanSvg(svg)}</div>`;
        mermaidCache.set(key, clean);
        if (alive()) el.innerHTML = clean;
      })
      .catch((e) => {
        if (!alive()) return;
        const pre = document.createElement("pre");
        pre.className = "mermaid-error";
        pre.textContent = `다이어그램 오류: ${e instanceof Error ? e.message : String(e)}`;
        el.prepend(pre);
      });
  }

  for (const el of root.querySelectorAll<HTMLElement>(".note-embed[data-embed]:not([data-done])")) {
    void fillEmbed(el, ctx, alive);
  }

  return () => {
    live = false;
  };
}
