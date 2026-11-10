import { Readability } from "@mozilla/readability";
import http from "node:http";
import https from "node:https";
import { isIP, type Socket } from "node:net";
import type { Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
// @ts-expect-error 타입 선언이 없는 패키지
import { gfm } from "turndown-plugin-gfm";
import { guardedLookup, isPrivateAddress, type LookupFn } from "./netGuard.js";
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

// 지킴은 마켓 받기와 같다(netGuard.ts, docs/guides/development.md 「마켓 받기와 나가는 요청」): 접속에 쓰는 풀이 자체를 판정,
// IP 글자는 접속 전에, 리다이렉트마다 다시, 소켓 주소를 한 번 더, agent: false 로 프록시 무시.
// 마켓과 다른 것은 URL 수집의 기존 동작이다: http 도 받고, 2xx 면 받고, 압축을 풀고, 시간 제한은 홉마다.

export interface FetchOptions {
  /** 사설·루프백 주소 허용(기본 금지). 사내 위키를 수집하려면 KEYRING_FETCH_ALLOW_PRIVATE=1. */
  allowPrivate?: boolean;
  maxBytes?: number;
  /** 홉(리다이렉트 하나)마다의 상한 */
  timeoutMs?: number;
  /** 시험용: 이름 풀이(기본 시스템 DNS) */
  resolve?: LookupFn;
  /** 시험용: 주소 판정(기본 isPrivateAddress) */
  isPrivate?: (ip: string) => boolean;
}

export interface Fetched {
  url: string;
  contentType: string;
  data: Uint8Array;
}

const MAX_HOPS = 6;

/** 첫 주소와 리다이렉트 주소마다: 스킴·사용자 정보·IP 글자 사설 주소(IP 글자는 lookup 을 타지 않는다) */
function checkClipUrl(url: URL, allowPrivate: boolean, isPrivate: (ip: string) => boolean): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new PathError("url_protocol");
  if (url.username || url.password) throw new PathError("url_credentials");
  // IPv6 글자의 hostname 은 대괄호를 품는다("[::1]") — 벗기지 않으면 isIP 가 0 이다
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(host) && isPrivate(host)) throw new PathError("private_address", { host: url.hostname });
}

type Hop = { redirect: string } | { contentType: string; data: Uint8Array };

function fetchFailed(reason: string): PathError {
  return new PathError("fetch_failed", { reason });
}

function decoder(encoding: string | undefined): Transform | null | undefined {
  const enc = (encoding ?? "identity").trim().toLowerCase();
  if (enc === "identity" || enc === "") return null;
  if (enc === "gzip" || enc === "x-gzip") return createGunzip();
  if (enc === "deflate") return createInflate();
  if (enc === "br") return createBrotliDecompress();
  return undefined;
}

function clipHop(url: URL, opts: FetchOptions, maxBytes: number): Promise<Hop> {
  const allowPrivate = opts.allowPrivate ?? false;
  const isPrivate = opts.isPrivate ?? isPrivateAddress;
  const privateError = () => new PathError("private_address", { host: url.hostname });
  const lookup = guardedLookup({ allowPrivate, resolve: opts.resolve, isPrivate, privateError });
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  return new Promise<Hop>((resolve, reject) => {
    let settled = false;
    const done = (e: unknown, v?: Hop) => {
      if (settled) return;
      settled = true;
      if (e) reject(e);
      else resolve(v!);
    };
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "GET",
        // 전역 agent 는 NODE_USE_ENV_PROXY=1 이면 프록시를 타고 lookup 이 불리지 않는다(시험 clipFetch.test.ts 「프록시 환경 변수」)
        agent: false,
        lookup: lookup as http.RequestOptions["lookup"],
        signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; KeyringNotes/0.4; +clipper)",
          accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          return done(null, { redirect: location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return done(fetchFailed(`HTTP ${status}`));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          req.destroy();
          return done(new PathError("doc_too_large"));
        }
        const unzip = decoder(res.headers["content-encoding"]);
        if (unzip === undefined) {
          req.destroy();
          return done(fetchFailed("content-encoding"));
        }
        // 압축이면 풀린 바이트로 센다 — 압축 폭탄도 상한에서 끊긴다
        const body: Readable = unzip ? res.pipe(unzip) : res;
        const chunks: Buffer[] = [];
        let total = 0;
        body.on("data", (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            req.destroy();
            unzip?.destroy();
            return done(new PathError("doc_too_large"));
          }
          chunks.push(c);
        });
        body.on("end", () => done(null, { contentType: (res.headers["content-type"] ?? "").toLowerCase(), data: new Uint8Array(Buffer.concat(chunks)) }));
        body.on("error", (e: Error & { code?: string }) => done(signal.aborted ? fetchFailed("timeout") : fetchFailed(e.code ?? e.message)));
        res.on("aborted", () => done(fetchFailed(signal.aborted ? "timeout" : "aborted")));
      },
    );
    req.on("socket", (socket: Socket) => {
      if (allowPrivate) return;
      // 둘째 줄: 실제로 붙으려는 주소·붙은 주소를 한 번 더 본다(첫 줄은 lookup 의 판정)
      const guard = (ip: string | undefined) => {
        if (ip && isPrivate(ip)) {
          const e = privateError();
          done(e);
          req.destroy(e);
        }
      };
      socket.on("connectionAttempt", (ip: string) => guard(ip));
      socket.on("lookup", (_e: unknown, address: string) => guard(address));
      socket.on("connect", () => guard(socket.remoteAddress));
    });
    req.on("error", (e: Error & { code?: string }) => {
      if (e instanceof PathError) return done(e);
      done(fetchFailed(signal.aborted ? "timeout" : (e.code ?? e.message)));
    });
    req.end();
  });
}

/** http(s) 문서를 가져온다. 리다이렉트마다 주소를 다시 검사하고, 크기·시간을 제한한다. */
export async function fetchUrl(input: string, opts: FetchOptions = {}): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  const isPrivate = opts.isPrivate ?? isPrivateAddress;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PathError("url_invalid");
  }
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    checkClipUrl(url, opts.allowPrivate ?? false, isPrivate);
    const r = await clipHop(url, opts, maxBytes);
    if ("data" in r) return { url: url.href, contentType: r.contentType, data: r.data };
    try {
      url = new URL(r.redirect, url);
    } catch {
      throw new PathError("url_invalid");
    }
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
