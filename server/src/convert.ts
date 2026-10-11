import { Readability } from "@mozilla/readability";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
// @ts-expect-error 타입 선언이 없는 패키지
import { gfm } from "turndown-plugin-gfm";
import { PathError } from "./paths.js";
import { vaultText, type VaultText } from "@keyring-notes/core";

export interface Converted {
  title: string;
  markdown: string;
  /** 원문 정보(있으면 프런트매터로 남긴다). */
  meta: Record<string, string>;
}

function turndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);
  td.remove(["script", "style", "noscript", "iframe", "form", "button", "input", "select", "textarea"] as never);
  return td;
}

/** 상대 링크·이미지 주소를 원문 기준 절대 주소로 바꾼다. */
function absolutize(doc: Document, base: string | undefined) {
  if (!base) return;
  for (const [sel, attr] of [
    ["a[href]", "href"],
    ["img[src]", "src"],
  ] as const) {
    for (const el of Array.from(doc.querySelectorAll(sel))) {
      const v = el.getAttribute(attr);
      if (!v || v.startsWith("#") || /^(data|javascript):/i.test(v)) continue;
      try {
        el.setAttribute(attr, new URL(v, base).href);
      } catch {
        /* 잘못된 주소는 그대로 */
      }
    }
  }
  for (const el of Array.from(doc.querySelectorAll("a[href^='javascript:']"))) el.removeAttribute("href");
}

/** "기사 제목 | 경제신문" → "기사 제목". 꼬리가 메타데이터의 사이트 이름이거나, 짧고(12자 이하) 앞부분보다 짧을 때만. */
export function cleanTitle(title: string, site?: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  const m = /^(.*\S)\s+[|\-–—·:]\s+([^|\-–—·:]+)$/.exec(t);
  if (!m) return t;
  const tail = m[2].trim();
  if ((site && tail === site.trim()) || (!site && [...tail].length <= 12 && [...m[1]].length >= 4 && [...m[1]].length > [...tail].length)) return m[1].trim();
  return t;
}

function tidy(md: string): string {
  return (
    md
      .replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, "$1$2 ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
      .trim() + "\n"
  );
}

/**
 * 웹 페이지 HTML → 마크다운. Readability로 본문만 뽑고(실패하면 body 전체) Turndown으로 변환한다.
 * selection이 있으면(웹 클리퍼에서 선택한 부분) 그 HTML만 변환한다.
 */
/** text: 볼트 언어의 글(기본 제목 등). 주지 않으면 영어 */
export function htmlToMarkdown(html: string, opts: { url?: string; selectionHtml?: string; text?: VaultText } = {}): Converted {
  const T = opts.text ?? vaultText("en");
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() ?? "";
  const metaOf = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const meta: Record<string, string> = {};
  const site = metaOf('meta[property="og:site_name"]');
  const author = metaOf('meta[name="author"]');
  const published = metaOf('meta[property="article:published_time"]');
  if (site) meta.site = site;
  if (author) meta.author = author;
  if (published) meta.published = published;

  if (opts.selectionHtml) {
    const { document: sel } = parseHTML(`<!doctype html><html><body>${opts.selectionHtml}</body></html>`);
    absolutize(sel as unknown as Document, opts.url);
    return { title: cleanTitle(pageTitle, meta.site) || T.ingest.webClip, markdown: tidy(turndown().turndown(sel.body.innerHTML)), meta };
  }

  absolutize(document as unknown as Document, opts.url);
  let title = pageTitle;
  let bodyHtml = document.body?.innerHTML ?? "";
  try {
    const article = new Readability(document.cloneNode(true) as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.content && (article.textContent ?? "").trim().length > 0) {
      bodyHtml = article.content;
      title = article.title?.trim() || title;
      if (article.byline && !meta.author) meta.author = article.byline.trim();
      if (article.siteName && !meta.site) meta.site = article.siteName.trim();
    }
  } catch {
    // 본문 추출 실패 시 body 전체를 쓴다
  }
  return { title: cleanTitle(title, meta.site) || T.untitled, markdown: tidy(turndown().turndown(bodyHtml)), meta };
}

/** PDF → 마크다운(페이지별 텍스트). 표·그림 구조는 남지 않는다. */
export async function pdfToMarkdown(data: Uint8Array, fallbackTitle: string, T: VaultText = vaultText("en")): Promise<Converted> {
  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  let title = fallbackTitle;
  const meta: Record<string, string> = { pages: String(totalPages) };
  try {
    const m = await getMeta(pdf);
    const info = m.info as Record<string, unknown>;
    if (typeof info?.Title === "string" && info.Title.trim()) title = info.Title.trim();
    if (typeof info?.Author === "string" && info.Author.trim()) meta.author = info.Author.trim();
  } catch {
    /* 메타데이터가 없어도 된다 */
  }
  const pages = (text as string[]).map((t, i) => {
    const body = t
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return totalPages > 1 ? `## ${T.ingest.page(i + 1)}\n\n${body || T.ingest.noText}` : body;
  });
  return { title, markdown: tidy(pages.join("\n\n")), meta };
}

// ── URL 가져오기(SSRF 방지) ──

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export interface FetchOptions {
  /** 사설·루프백 주소 허용(기본 금지). 사내 위키를 수집하려면 KEYRING_FETCH_ALLOW_PRIVATE=1. */
  allowPrivate?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface Fetched {
  url: string;
  contentType: string;
  data: Uint8Array;
}

async function assertPublicHost(url: URL, allowPrivate: boolean) {
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) {
    throw new PathError("private_address", { host: url.hostname });
  }
}

/** http(s) 문서를 가져온다. 리다이렉트마다 주소를 다시 검사하고, 크기·시간을 제한한다. */
export async function fetchUrl(input: string, opts: FetchOptions = {}): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PathError("url_invalid");
  }
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new PathError("url_protocol");
    if (url.username || url.password) throw new PathError("url_credentials");
    await assertPublicHost(url, opts.allowPrivate ?? false);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; KeyringNotes/0.4; +clipper)", accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5" },
    }).catch((e) => {
      throw new PathError("fetch_failed", { reason: String(e?.cause?.code ?? e?.message ?? e) });
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new PathError("fetch_failed", { reason: `HTTP ${res.status}` });
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new PathError("doc_too_large");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new PathError("doc_too_large");
        }
        chunks.push(value);
      }
    }
    const data = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      data.set(c, off);
      off += c.byteLength;
    }
    return { url: url.href, contentType: (res.headers.get("content-type") ?? "").toLowerCase(), data };
  }
  throw new PathError("too_many_redirects");
}

/** 응답 바이트를 문자열로(Content-Type이나 meta charset의 인코딩을 따른다). */
export function decodeText(data: Uint8Array, contentType: string): string {
  let charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim();
  if (!charset) {
    const head = new TextDecoder("latin1").decode(data.slice(0, 4096));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}
