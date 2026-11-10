import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { PathError } from "@keyring-notes/core";

/**
 * 마켓 받기의 나가는 요청 지킴. 판정은 **접속에 쓰는 이름 풀이 결과 자체**로 한다(guardedLookup 을 http.request 의
 * lookup 으로 준다) — 판정한 뒤 접속이 이름을 다시 풀면 둘째 풀이가 사설 주소를 줄 수 있다(DNS 재바인딩).
 * 웹 클립(convert.ts)의 판정은 이 꼴이 아니다 — docs/guides/development.md 「알려진 한계」.
 *
 * 주소 판정 표의 원본은 계획 docs/superpowers/plans/2026-11-10-marketplace-phase1.md 「주소 판정 표」이고,
 * Rust market_fetch(app/src-tauri) 가 같은 표·같은 시험 벡터를 쓴다. 한쪽을 고치면 다른 쪽도 고친다.
 */

/** 앞뒤 `[`·`]`, 뒤의 zone id(`%en0`·URL 꼴 `%25en0`)를 벗긴다 */
function bare(ip: string): string {
  let s = ip.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const z = s.indexOf("%");
  return z >= 0 ? s.slice(0, z) : s;
}

/** 10진 네 조각, 각 0..255, 앞 0 없음(`010` 은 8진으로 읽는 구현이 있어 막는다). 아니면 null */
function parseV4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** 16바이트. `::` 펼침, 끝의 점 IPv4 꼴. 아니면 null */
function parseV6(s: string): number[] | null {
  if (!s.includes(":")) return null;
  let tail: number[] = [];
  let head = s;
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = parseV4(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    head = s.slice(0, lastColon + 1);
    // "::1.2.3.4" 처럼 :: 바로 뒤면 head 가 "::" 로 끝나고, 그 밖이면 ":" 하나가 남는다
    if (!head.endsWith("::")) head = head.slice(0, -1);
  }
  const dbl = head.split("::");
  if (dbl.length > 2) return null;
  const groups = (x: string) => (x === "" ? [] : x.split(":"));
  const left = groups(dbl[0]!);
  const right = dbl.length === 2 ? groups(dbl[1]!) : [];
  const words = (list: string[]) => {
    const out: number[] = [];
    for (const g of list) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      const n = parseInt(g, 16);
      out.push(n >> 8, n & 0xff);
    }
    return out;
  };
  const l = words(left);
  const r = words(right);
  if (!l || !r) return null;
  const have = l.length + r.length + tail.length;
  if (dbl.length === 1) return have === 16 ? [...l, ...r, ...tail] : null;
  if (have > 14) return null; // `::` 는 적어도 한 묶음(2바이트)을 채운다
  return [...l, ...Array.from({ length: 16 - have }, () => 0), ...r, ...tail];
}

function privateV4(v: number[]): boolean {
  const [a, b, c] = v as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateV6(x: number[]): boolean {
  const zero = (from: number, to: number) => x.slice(from, to).every((v) => v === 0);
  // ::/96 — ::, ::1, 옛 IPv4 호환 ::a.b.c.d. 받을 일이 없으니 품은 IPv4 와 상관없이 막는다
  if (zero(0, 12)) return true;
  if ((x[0]! & 0xfe) === 0xfc) return true; // fc00::/7
  if (x[0] === 0xfe && (x[1]! & 0xc0) === 0x80) return true; // fe80::/10
  if (x[0] === 0xfe && (x[1]! & 0xc0) === 0xc0) return true; // fec0::/10
  if (x[0] === 0xff) return true; // ff00::/8
  // 64:ff9b:1::/48 — RFC 8215 지역용 NAT64
  if (x[0] === 0 && x[1] === 0x64 && x[2] === 0xff && x[3] === 0x9b && x[4] === 0 && x[5] === 1) return true;
  // IPv4 를 품은 꼴은 품은 IPv4 로 다시 판정
  if (zero(0, 10) && x[10] === 0xff && x[11] === 0xff) return privateV4(x.slice(12)); // ::ffff:0:0/96 사상
  if (zero(0, 8) && x[8] === 0xff && x[9] === 0xff && zero(10, 12)) return privateV4(x.slice(12)); // ::ffff:0:0:0/96 SIIT
  if (x[0] === 0 && x[1] === 0x64 && x[2] === 0xff && x[3] === 0x9b && zero(4, 12)) return privateV4(x.slice(12)); // 64:ff9b::/96 NAT64
  if (x[0] === 0x20 && x[1] === 0x02) return privateV4(x.slice(2, 6)); // 2002::/16 6to4
  return false;
}

/** 사설·특수 주소인가. 파싱하지 못하면 막는다(fail-closed) */
export function isPrivateAddress(ip: string): boolean {
  if (typeof ip !== "string") return true;
  const s = bare(ip);
  const v4 = parseV4(s);
  if (v4) return privateV4(v4);
  const v6 = parseV6(s);
  if (v6) return privateV6(v6);
  return true;
}

export type LookupFn = (host: string) => Promise<{ address: string; family: 4 | 6 }[]>;

const systemResolve: LookupFn = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/**
 * http.request 의 lookup 옵션. 풀이 결과 중 하나라도 사설이면(허용이 아니면) 오류 — 이 결과가 곧 접속 주소다.
 * Node 는 autoSelectFamily(기본 켜짐) 때 `{ all: true }` 로 부르고 콜백에 목록을 기대한다. 두 꼴 다 받는다.
 */
export function guardedLookup(opts: { allowPrivate: boolean; resolve?: LookupFn; isPrivate?: (ip: string) => boolean }): LookupFunction {
  const resolve = opts.resolve ?? systemResolve;
  const isPrivate = opts.isPrivate ?? isPrivateAddress;
  return ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const o = (typeof options === "object" && options !== null ? options : { family: options }) as { all?: boolean; family?: number | string };
    const family = o.family === 6 || o.family === "IPv6" ? 6 : o.family === 4 || o.family === "IPv4" ? 4 : 0;
    resolve(hostname).then(
      (all) => {
        const list = family ? all.filter((a) => a.family === family) : all;
        if (list.length === 0) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
        if (!opts.allowPrivate && all.some((a) => isPrivate(a.address))) return callback(new PathError("market_private_address", { host: hostname }));
        if (o.all) callback(null, list);
        else callback(null, list[0]!.address, list[0]!.family);
      },
      (e: unknown) => callback(e),
    );
  }) as unknown as LookupFunction;
}
