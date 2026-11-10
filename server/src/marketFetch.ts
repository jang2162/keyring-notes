import http from "node:http";
import https from "node:https";
import { isIP, type Socket } from "node:net";
import { MARKET_LIMITS, PathError } from "@keyring-notes/core";
import { guardedLookup, isPrivateAddress, type LookupFn } from "./netGuard.js";

/**
 * 마켓 저장소로 나가는 요청 하나(리다이렉트 포함). 규칙은 계획 docs/superpowers/plans/2026-11-10-marketplace-phase1.md
 * 「Global Constraints」 의 나가는 요청 줄: https 만·사설 주소 거부(접속에 쓰는 풀이로)·리다이렉트마다 다시·쿠키·인증·프록시 없음·
 * identity 만·크기는 받는 동안 센다·시간은 요청 전체에.
 */
export interface MarketFetchOptions {
  allowHttp: boolean;
  allowPrivate: boolean;
  maxBytes: number;
  /** 첫 접속부터 마지막 리다이렉트의 본문 끝까지 전체(홉마다가 아니다) */
  timeoutMs: number;
  /** 저장소 목록이 적은 크기. 받는 바이트가 이것과 다르면 market_size_mismatch */
  expectSize?: number;
  resolve?: LookupFn;
  /** 시험용: 주소 판정 함수(기본 isPrivateAddress) */
  isPrivate?: (ip: string) => boolean;
  /** 시험용: 홉마다 부르는 판정(기본 checkUrl) */
  check?: typeof checkUrl;
}

/** 첫 주소와 리다이렉트 주소마다 같은 판정: 프로토콜·사용자 정보·IP 글자 사설 주소 */
export function checkUrl(url: URL, opts: { allowHttp: boolean; allowPrivate: boolean; isPrivate?: (ip: string) => boolean }): void {
  if (url.protocol !== "https:" && !(url.protocol === "http:" && opts.allowHttp)) throw new PathError("market_url_protocol", { url: url.href });
  if (url.username || url.password) throw new PathError("market_url_credentials", { url: `${url.protocol}//${url.host}${url.pathname}` });
  // IPv6 글자의 hostname 은 대괄호를 품는다("[::1]") — 벗기지 않으면 isIP 가 0 이라 판정을 건너뛰고,
  // IP 글자는 lookup 을 타지 않으므로 그대로 접속된다
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !opts.allowPrivate && (opts.isPrivate ?? isPrivateAddress)(host)) throw new PathError("market_private_address", { host });
}

function fail(reason: string): PathError {
  return new PathError("market_fetch_failed", { reason });
}

interface Hop {
  redirect?: string;
  body?: Uint8Array;
}

function hop(url: URL, opts: MarketFetchOptions, signal: AbortSignal): Promise<Hop> {
  const isPrivate = opts.isPrivate ?? isPrivateAddress;
  const lookup = guardedLookup({ allowPrivate: opts.allowPrivate, resolve: opts.resolve, isPrivate });
  const limit = Math.min(opts.maxBytes, opts.expectSize ?? Number.POSITIVE_INFINITY);
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
        // agent: false 가 프록시 방어선이다 — 전역 agent 는 NODE_USE_ENV_PROXY=1 이면 HTTP(S)_PROXY 를 타고,
        // 그때는 lookup 이 불리지 않아 프록시가 이름을 풀고 판정이 무의미해진다(시험 marketFetch.test.ts 「프록시 환경 변수」)
        agent: false,
        lookup: lookup as http.RequestOptions["lookup"],
        signal,
        headers: { "accept-encoding": "identity", "user-agent": "keyring-notes-market" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          const loc = res.headers.location;
          return loc ? done(null, { redirect: loc }) : done(fail(`http_${status}`));
        }
        if (status !== 200) {
          res.resume();
          return done(fail(`http_${status}`));
        }
        const enc = res.headers["content-encoding"];
        if (enc !== undefined && enc.trim().toLowerCase() !== "identity") {
          req.destroy();
          return done(fail("content-encoding"));
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          req.destroy();
          return done(new PathError("market_too_large"));
        }
        if (opts.expectSize !== undefined && Number.isFinite(declared) && declared !== opts.expectSize) {
          req.destroy();
          return done(new PathError("market_size_mismatch", { path: url.pathname }));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > limit) {
            req.destroy();
            done(total > opts.maxBytes ? new PathError("market_too_large") : new PathError("market_size_mismatch", { path: url.pathname }));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (opts.expectSize !== undefined && total !== opts.expectSize) return done(new PathError("market_size_mismatch", { path: url.pathname }));
          done(null, { body: new Uint8Array(Buffer.concat(chunks)) });
        });
        res.on("error", (e) => done(e));
        res.on("aborted", () => done(fail("aborted")));
      },
    );
    req.on("socket", (socket: Socket) => {
      if (opts.allowPrivate) return;
      // 지킴 둘째 줄: 실제로 붙으려는 주소·붙은 주소를 한 번 더 본다(첫 줄은 lookup 의 판정)
      const guard = (ip: string | undefined) => {
        if (ip && isPrivate(ip)) {
          const e = new PathError("market_private_address", { host: url.hostname });
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
      if (signal.aborted) return done(new PathError("market_timeout"));
      done(fail(e.code ?? "network"));
    });
    req.end();
  });
}

/** 실패는 PathError(market_url_* · market_private_address · market_fetch_failed{reason} · market_timeout · market_too_large · market_too_many_redirects · market_size_mismatch) */
export async function marketFetch(input: string, opts: MarketFetchOptions): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PathError("market_url_invalid", { url: String(input) });
  }
  const check = opts.check ?? checkUrl;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  for (let redirects = 0; ; redirects++) {
    check(url, opts);
    if (signal.aborted) throw new PathError("market_timeout");
    let r: Hop;
    try {
      r = await hop(url, opts, signal);
    } catch (e) {
      if (signal.aborted && !(e instanceof PathError && e.code === "market_private_address")) throw new PathError("market_timeout");
      throw e;
    }
    if (r.body) return r.body;
    if (redirects >= MARKET_LIMITS.redirects) throw new PathError("market_too_many_redirects");
    try {
      url = new URL(r.redirect!, url);
    } catch {
      throw new PathError("market_url_invalid", { url: r.redirect! });
    }
  }
}
