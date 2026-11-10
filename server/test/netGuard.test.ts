import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PathError } from "@keyring-notes/core";
import { guardedLookup, isPrivateAddress, type LookupFn } from "../src/netGuard.js";

// 공통 벡터 — Rust market.rs 시험도 같은 파일을 읽는다(한쪽만 고치지 않게)
const vectors = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "address-vectors.json"), "utf8")) as {
  blocked: string[];
  allowed: string[];
};
const BLOCKED = vectors.blocked;
const ALLOWED = vectors.allowed;

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
