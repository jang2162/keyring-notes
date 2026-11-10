import { describe, expect, it } from "vitest";
import { PathError } from "@keyring-notes/core";
import { guardedLookup, isPrivateAddress, type LookupFn } from "../src/netGuard.js";

// 계획 「주소 판정 표」 의 공통 벡터 — Rust market.rs 시험이 같은 목록을 쓴다
export const BLOCKED = [
  "127.0.0.1",
  "10.1.2.3",
  "100.64.0.1",
  "169.254.169.254",
  "172.31.255.255",
  "192.168.0.1",
  "198.19.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "0:0:0:0:0:0:0:1",
  "::7f00:1",
  "fd00::1",
  "fe80::1",
  "fe80::1%en0",
  "fec0::1",
  "ff02::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:0:7f00:1",
  "::ffff:0:127.0.0.1",
  "64:ff9b::a00:1",
  "64:ff9b:1::a00:1",
  "2002:c0a8:1::1",
  "[::1]",
  "",
  "abc",
  "1.2.3",
  "256.1.1.1",
  "::g",
  "010.0.0.1",
  "01.1.1.1",
  "1:2:3:4:5:6:7:8:9",
  "1::2::3",
];
export const ALLOWED = [
  "1.1.1.1",
  "93.184.216.34",
  "172.32.0.1",
  "100.128.0.1",
  "2606:4700::1111",
  "::ffff:1.1.1.1",
  "::ffff:0:101:101",
  "64:ff9b::101:101",
  "[2606:4700::1111]",
  "2606:4700::1111%25en0",
];

describe("isPrivateAddress", () => {
  it("막음", () => {
    for (const ip of BLOCKED) expect(isPrivateAddress(ip), JSON.stringify(ip)).toBe(true);
  });
  it("통과", () => {
    for (const ip of ALLOWED) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

type Cb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function call(fn: ReturnType<typeof guardedLookup>, options: unknown): Promise<{ err: unknown; address: unknown; family: unknown }> {
  return new Promise((resolve) =>
    (fn as unknown as (h: string, o: unknown, cb: Cb) => void)("repo.test", options, (err, address, family) => resolve({ err, address, family })),
  );
}

describe("guardedLookup", () => {
  const pub: LookupFn = async () => [
    { address: "1.1.1.1", family: 4 },
    { address: "2606:4700::1111", family: 6 },
  ];
  it("all: false 면 (address, family), all: true 면 목록", async () => {
    expect(await call(guardedLookup({ allowPrivate: false, resolve: pub }), {})).toEqual({ err: null, address: "1.1.1.1", family: 4 });
    expect(await call(guardedLookup({ allowPrivate: false, resolve: pub }), { all: true })).toEqual({
      err: null,
      address: [
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700::1111", family: 6 },
      ],
      family: undefined,
    });
    expect((await call(guardedLookup({ allowPrivate: false, resolve: pub }), { family: 6 })).address).toBe("2606:4700::1111");
  });
  it("하나라도 사설이면 오류(허용이 아니면)", async () => {
    const mixed: LookupFn = async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    const r = await call(guardedLookup({ allowPrivate: false, resolve: mixed }), { all: true });
    expect(r.err).toBeInstanceOf(PathError);
    expect((r.err as PathError).code).toBe("market_private_address");
    expect((await call(guardedLookup({ allowPrivate: true, resolve: mixed }), {})).err).toBeNull();
    const zone: LookupFn = async () => [{ address: "fe80::1%en0", family: 6 }];
    expect(((await call(guardedLookup({ allowPrivate: false, resolve: zone }), {})).err as PathError).code).toBe("market_private_address");
    const none: LookupFn = async () => [];
    expect((await call(guardedLookup({ allowPrivate: false, resolve: none }), {})).err).toBeTruthy();
  });
});
