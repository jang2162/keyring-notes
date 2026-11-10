import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KeyedError, OFFICIAL_REPO_URL, parseMarketplace, PathError, type LockEntry } from "@keyring-notes/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketCache, type MarketCacheOptions } from "../src/marketCache.js";
import type { MarketFetchOptions } from "../src/marketFetch.js";
import { tempDir } from "./helpers.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "market");
const REPO = "https://repo.test/m/";
const index = JSON.parse(await readFile(path.join(fixture, "index.json"), "utf8"));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function lockOf(id: string, version: string, repo = REPO): LockEntry {
  const files = index.packages[id].versions[version].files as { path: string; sha256: string }[];
  return { version, repo, sha256: Object.fromEntries(files.map((f) => [f.path, f.sha256])) };
}
function sizesOf(id: string, version: string): Record<string, number> {
  return Object.fromEntries((index.packages[id].versions[version].files as { path: string; size: number }[]).map((f) => [f.path, f.size]));
}

/** 픽스처 저장소를 내주는 가짜 받기. override 로 주소별 바이트를 바꾼다 */
function fakeFetch(override: Record<string, Uint8Array | Error> = {}) {
  const calls: string[] = [];
  const fn = async (url: string, opts: MarketFetchOptions): Promise<Uint8Array> => {
    calls.push(url);
    const o = override[url];
    if (o instanceof Error) throw o;
    let bytes: Uint8Array;
    if (o) bytes = o;
    else {
      const rel = url.startsWith(REPO) ? url.slice(REPO.length) : url.startsWith(OFFICIAL_REPO_URL) ? url.slice(OFFICIAL_REPO_URL.length) : null;
      if (rel === null) throw new PathError("market_fetch_failed", { reason: "http_404" });
      try {
        bytes = new Uint8Array(await readFile(path.join(fixture, rel)));
      } catch {
        throw new PathError("market_fetch_failed", { reason: "http_404" });
      }
    }
    if (bytes.byteLength > opts.maxBytes) throw new PathError("market_too_large");
    if (opts.expectSize !== undefined && bytes.byteLength !== opts.expectSize) throw new PathError("market_size_mismatch", { path: url });
    return bytes;
  };
  return Object.assign(fn, { calls });
}

let root: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  const t = await tempDir("keyring-market-");
  root = path.join(t.dir, "packages");
  cleanup = t.cleanup;
});
afterEach(() => cleanup());

function cache(opts: Partial<MarketCacheOptions> = {}) {
  return new MarketCache({ root, allowHttp: false, allowPrivate: false, fetch: fakeFetch(), ...opts });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof KeyedError ? e.code : `other: ${String(e)}`;
  }
  return "no error";
}

const leftovers = async () => (await readdir(root).catch(() => [] as string[])).filter((n) => n.startsWith("."));
const frameUrl = (v: string, id = "me/clock") => `${REPO}packages/${id}/${v}/frame.js`;

describe("ensure·read", () => {
  it("받아 두면 맞는 sha 로 읽힌다, 메타가 있다", async () => {
    const c = cache();
    const e = lockOf("@me/clock", "1.0.0");
    await c.ensure("@me/clock", e, sizesOf("@me/clock", "1.0.0"));
    const b = await c.read("@me/clock", "1.0.0", "frame.js", e.sha256["frame.js"]!);
    expect(Buffer.from(b).equals(await readFile(path.join(fixture, "packages/me/clock/1.0.0/frame.js")))).toBe(true);
    const meta = JSON.parse(await readFile(path.join(root, "@me", "clock", "1.0.0", ".keyring-cache.json"), "utf8"));
    expect(meta).toMatchObject({ id: "@me/clock", version: "1.0.0", repo: REPO, sha256: e.sha256 });
    expect(await codeOf(c.read("@me/clock", "1.0.0", "frame.js", "0".repeat(64)))).toBe("market_not_found");
    expect(c.status()["@me/clock"]).toEqual({ state: "ready", version: "1.0.0" });
  });

  it("sha 가 하나 다르면 market_hash_mismatch{path}, 판 폴더·임시 폴더가 없다", async () => {
    const c = cache();
    const e = lockOf("@me/clock", "1.0.0");
    e.sha256["frame.js"] = "f".repeat(64);
    const err = await c.ensure("@me/clock", e).catch((x: PathError) => x);
    expect(err).toBeInstanceOf(PathError);
    expect((err as PathError).code).toBe("market_hash_mismatch");
    expect((err as PathError).params.path).toBe("frame.js");
    await expect(readdir(path.join(root, "@me", "clock", "1.0.0"))).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
    expect(c.status()["@me/clock"]).toMatchObject({ state: "error", error: { code: "market_hash_mismatch" } });
  });

  it("이미 다른 sha 의 캐시가 있을 때 불일치 → 기존 캐시가 그대로", async () => {
    const c = cache();
    const good = lockOf("@me/clock", "1.0.0");
    await c.ensure("@me/clock", good);
    const bad = { ...good, sha256: { ...good.sha256, "frame.js": "e".repeat(64) } };
    expect(await codeOf(c.ensure("@me/clock", bad))).toBe("market_hash_mismatch");
    expect((await c.read("@me/clock", "1.0.0", "frame.js", good.sha256["frame.js"]!)).byteLength).toBeGreaterThan(0);
    expect(await leftovers()).toEqual([]);
  });

  it("같은 판·다른 sha 로 교체 성공 → 새 파일·새 메타, .old·.tmp 없음", async () => {
    const changed = new TextEncoder().encode("self.keyringWidgetRegister(() => () => {}); // new");
    const good = lockOf("@me/clock", "1.0.0");
    const c1 = cache();
    await c1.ensure("@me/clock", good);
    const c2 = cache({ fetch: fakeFetch({ [frameUrl("1.0.0")]: changed }) });
    const next = { ...good, sha256: { ...good.sha256, "frame.js": sha(changed) } };
    await c2.ensure("@me/clock", next);
    expect(Buffer.from(await c2.read("@me/clock", "1.0.0", "frame.js", sha(changed))).toString()).toContain("// new");
    expect(await codeOf(c2.read("@me/clock", "1.0.0", "frame.js", good.sha256["frame.js"]!))).toBe("market_not_found");
    expect(await leftovers()).toEqual([]);
  });

  it("교체 도중에 멈추면 틀린 바이트를 내지 않고, 다시 시작하면 확인을 마친 새 판을 되살린다(다시 받지 않음)", async () => {
    const changed = new TextEncoder().encode("self.keyringWidgetRegister(() => () => {}); // newer");
    const good = lockOf("@me/clock", "1.0.0");
    await cache().ensure("@me/clock", good);
    // 옛 폴더를 .old-* 로 옮긴 직후 「프로세스가 죽음」: 그 뒤의 이름 바꾸기는 모두 실패한다
    let renames = 0;
    const crashing = async (from: string, to: string) => {
      if (++renames > 1) throw new Error("crash");
      await rename(from, to);
    };
    const f = fakeFetch({ [frameUrl("1.0.0")]: changed });
    const c = cache({ fetch: f, rename: crashing });
    const next = { ...good, sha256: { ...good.sha256, "frame.js": sha(changed) } };
    await c.ensure("@me/clock", next).catch(() => undefined);
    expect(await codeOf(c.read("@me/clock", "1.0.0", "frame.js", sha(changed)))).toBe("market_not_found");
    expect(await codeOf(c.read("@me/clock", "1.0.0", "frame.js", good.sha256["frame.js"]!))).toBe("market_not_found");
    expect((await leftovers()).sort().map((n) => n.slice(0, 5))).toEqual([".old-", ".tmp-"]);
    const f2 = fakeFetch();
    const again = cache({ fetch: f2 });
    expect(Buffer.from(await again.read("@me/clock", "1.0.0", "frame.js", sha(changed))).toString()).toContain("// newer");
    expect(await leftovers()).toEqual([]);
    expect(f2.calls).toEqual([]);
  });

  it("확인을 못 마친 .tmp 는 지우고, 판 폴더가 없으면 .old 를 되돌린다", async () => {
    const good = lockOf("@me/clock", "1.0.0");
    await cache().ensure("@me/clock", good);
    await mkdir(path.join(root, ".tmp-half"), { recursive: true });
    await writeFile(path.join(root, ".tmp-half", "frame.js"), "half");
    await rename(path.join(root, "@me", "clock", "1.0.0"), path.join(root, ".old-x"));
    const c = cache();
    expect((await c.read("@me/clock", "1.0.0", "frame.js", good.sha256["frame.js"]!)).byteLength).toBeGreaterThan(0);
    expect(await leftovers()).toEqual([]);
  });

  it("패키지 합: sizes 합이 16 MiB 를 넘으면 받지 않고, 누적이 넘으면 그 자리에서 멈춘다", async () => {
    const f = fakeFetch();
    const c = cache({ fetch: f });
    const e = lockOf("@me/clock", "1.0.0");
    expect(await codeOf(c.ensure("@me/clock", e, { "keyring-package.json": 10, "frame.js": 8_388_608, "messages/ko.json": 8_388_608 }))).toBe(
      "market_too_large",
    );
    expect(f.calls).toEqual([]);
    const big = new Uint8Array(6 * 1024 * 1024).fill(7);
    const big2 = new Uint8Array(6 * 1024 * 1024).fill(8);
    const big3 = new Uint8Array(6 * 1024 * 1024).fill(9);
    const id = "@me/big";
    const files = { "keyring-package.json": big, "frame.css": big2, "frame.js": big3 };
    const g = fakeFetch(Object.fromEntries(Object.entries(files).map(([p, b]) => [`${REPO}packages/me/big/1.0.0/${p}`, b])));
    const c2 = cache({ fetch: g });
    expect(await codeOf(c2.ensure(id, { version: "1.0.0", repo: REPO, sha256: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha(b)])) }))).toBe(
      "market_too_large",
    );
    expect(g.calls).toHaveLength(3);
    expect(await leftovers()).toEqual([]);
  });

  it("받은 묶음이 매니페스트 검사에 걸리면 market_manifest_invalid, 캐시 없음", async () => {
    const manifest = await readFile(path.join(fixture, "packages/me/clock/1.0.0/keyring-package.json"));
    const frame = await readFile(path.join(fixture, "packages/me/clock/1.0.0/frame.js"));
    const f = fakeFetch({ [`${REPO}packages/me/other/1.0.0/keyring-package.json`]: manifest, [`${REPO}packages/me/other/1.0.0/frame.js`]: frame });
    const c = cache({ fetch: f });
    expect(
      await codeOf(c.ensure("@me/other", { version: "1.0.0", repo: REPO, sha256: { "keyring-package.json": sha(manifest), "frame.js": sha(frame) } })),
    ).toBe("market_manifest_invalid");
    await expect(readdir(path.join(root, "@me", "other"))).rejects.toThrow();
  });

  it("공식이 아닌 repo 의 @keyring/… 는 받지 않는다", async () => {
    const f = fakeFetch();
    expect(await codeOf(cache({ fetch: f }).ensure("@keyring/hello", lockOf("@keyring/hello", "1.0.0")))).toBe("market_scope_reserved");
    expect(f.calls).toEqual([]);
    const g = fakeFetch();
    await cache({ fetch: g }).ensure("@keyring/hello", lockOf("@keyring/hello", "1.0.0", OFFICIAL_REPO_URL));
    expect(g.calls).toHaveLength(1);
  });

  it("http 저장소는 허용할 때만, 잘못된 항목은 market_lock_invalid", async () => {
    const f = fakeFetch();
    expect(await codeOf(cache({ fetch: f }).ensure("@me/clock", lockOf("@me/clock", "1.0.0", "http://repo.test/m/")))).toBe("market_url_protocol");
    expect(await codeOf(cache({ fetch: f }).ensure("@me/clock", { ...lockOf("@me/clock", "1.0.0"), version: "../1" }))).toBe("market_lock_invalid");
    expect(await codeOf(cache({ fetch: f }).ensure("@me/clock", { ...lockOf("@me/clock", "1.0.0"), sha256: { "../x": "a".repeat(64) } }))).toBe(
      "market_lock_invalid",
    );
    expect(f.calls).toEqual([]);
  });

  it("같은 ensure 두 번 동시 → 파일마다 한 번만 받는다", async () => {
    const f = fakeFetch();
    const c = cache({ fetch: f });
    const e = lockOf("@me/clock", "1.0.0");
    await Promise.all([c.ensure("@me/clock", e), c.ensure("@me/clock", e)]);
    expect(f.calls.sort()).toEqual(
      Object.keys(e.sha256)
        .map((p) => `${REPO}packages/me/clock/1.0.0/${p}`)
        .sort(),
    );
  });
});

describe("경로 탈출", () => {
  it("검사를 지난 이름으로만 잇고, 루트 밖을 읽지 않는다", async () => {
    const c = cache();
    const e = lockOf("@me/clock", "1.0.0");
    await c.ensure("@me/clock", e);
    await writeFile(path.join(path.dirname(root), "bait.json"), "secret");
    const s = "a".repeat(64);
    for (const [id, v, p] of [
      ["@me/clock", "1.0.0", "../../bait.json"],
      ["@me/clock", "1.0.0", "../../../config/keyring.json"],
      ["@me/..", "1.0.0", "frame.js"],
      ["@me/clock", "../1", "frame.js"],
      ["@me/clock", "1.0.0", "/etc/passwd"],
    ] as const) {
      const r = await c.read(id, v, p, s).catch((x: unknown) => x);
      expect(r, `${id} ${v} ${p}`).toBeInstanceOf(KeyedError);
    }
  });

  it("판 폴더를 밖을 가리키는 링크로 바꿔도 읽지 않는다", async () => {
    const c = cache();
    const e = lockOf("@me/clock", "1.0.0");
    await c.ensure("@me/clock", e);
    const outside = path.join(path.dirname(root), "outside");
    await rename(path.join(root, "@me", "clock", "1.0.0"), outside);
    await symlink(outside, path.join(root, "@me", "clock", "1.0.0"));
    expect(await codeOf(c.read("@me/clock", "1.0.0", "frame.js", e.sha256["frame.js"]!))).toBe("market_not_found");
  });
});

describe("reconcile", () => {
  const H = 3600 * 1000;
  const settings = (packages: Record<string, LockEntry>) => ({ ...parseMarketplace({}), packages });

  it("잠금에 있고 없는 것은 받고, 잠금에 없는 판은 마지막으로 받은 지 24시간이 지났을 때만 지운다", async () => {
    let now = 1_000_000;
    const c = cache({ now: () => now });
    await c.reconcile(settings({ "@me/clock": lockOf("@me/clock", "1.0.0") }));
    expect(c.status()["@me/clock"]).toMatchObject({ state: "ready", version: "1.0.0" });
    now += 23 * H;
    await c.reconcile(settings({ "@me/clock": lockOf("@me/clock", "1.1.0") }));
    expect(await readdir(path.join(root, "@me", "clock"))).toEqual(["1.0.0", "1.1.0"]);
    now += 2 * H;
    await c.reconcile(settings({ "@me/clock": lockOf("@me/clock", "1.1.0") }));
    expect(await readdir(path.join(root, "@me", "clock"))).toEqual(["1.1.0"]);
    await c.reconcile(null);
    expect(await readdir(path.join(root, "@me", "clock"))).toEqual(["1.1.0"]);
    now += 25 * H;
    await c.reconcile(null);
    expect(await readdir(path.join(root, "@me", "clock"))).toEqual(["1.1.0"]);
    await c.reconcile(settings({}));
    await expect(readdir(path.join(root, "@me"))).rejects.toThrow();
    expect(c.status()).toEqual({});
  });

  it("실패한 항목은 status 에 error, 다음 reconcile 에서 다시", async () => {
    const e = lockOf("@me/clock", "1.0.0");
    const failing = fakeFetch({ [frameUrl("1.0.0")]: new PathError("market_timeout") });
    const c = cache({ fetch: failing });
    await c.reconcile(settings({ "@me/clock": e }));
    expect(c.status()["@me/clock"]).toEqual({ state: "error", version: "1.0.0", error: { code: "market_timeout", params: {} } });
    const c2 = cache();
    await c2.reconcile(settings({ "@me/clock": e }));
    expect(c2.status()["@me/clock"]).toMatchObject({ state: "ready" });
  });
});

describe("index", () => {
  it("5분 안에는 한 번만 받고, 실패는 30초 동안 같은 오류", async () => {
    let now = 0;
    const f = fakeFetch();
    const c = cache({ fetch: f, now: () => now });
    const r = await c.index(REPO);
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.index!.packages).sort()).toEqual(["@me/clock", "@me/sea"]);
    expect(r.ignored).toEqual(["@keyring/hello: scope_reserved"]);
    now += 4 * 60 * 1000;
    await c.index("https://repo.test/m");
    expect(f.calls).toHaveLength(1);
    now += 2 * 60 * 1000;
    await c.index(REPO);
    expect(f.calls).toHaveLength(2);

    const bad = fakeFetch({ "https://down.test/index.json": new PathError("market_timeout") });
    const d = cache({ fetch: bad, now: () => now });
    expect((await d.index("https://down.test/")).error).toEqual({ code: "market_timeout", params: {} });
    now += 20 * 1000;
    expect((await d.index("https://down.test/")).error?.code).toBe("market_timeout");
    expect(bad.calls).toHaveLength(1);
    now += 15 * 1000;
    await d.index("https://down.test/");
    expect(bad.calls).toHaveLength(2);
  });

  it("JSON 이 아니면 market_index_invalid, 주소가 틀리면 그 오류", async () => {
    const c = cache({ fetch: fakeFetch({ "https://bad.test/index.json": new TextEncoder().encode("<html>") }) });
    expect((await c.index("https://bad.test/")).error?.code).toBe("market_index_invalid");
    expect((await c.index("http://bad.test/")).error?.code).toBe("market_url_protocol");
  });
});
