import { KeyedError, OFFICIAL_REPO_URL, parseMarketplace, type LockEntry, type MarketplaceSettings, type RepoIndexResult } from "@keyring-notes/core";
import { describe, expect, it, vi } from "vitest";
import { memoryPackageCache } from "./cache";
import type { PackageSource } from "./source";
import { createMarketState, type InstalledPackage } from "./state";

const raw = import.meta.glob("../../../server/test/fixtures/market/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PREFIX = "../../../server/test/fixtures/market/";
const index = JSON.parse(raw[`${PREFIX}index.json`]!);
const REPO = "https://repo.test/m/";
const enc = (s: string) => new TextEncoder().encode(s);

function lockOf(id: string, version: string): LockEntry {
  const files = index.packages[id].versions[version].files as { path: string; sha256: string }[];
  return { version, repo: REPO, sha256: Object.fromEntries(files.map((f) => [f.path, f.sha256])) };
}

/** 픽스처를 내주는 가짜 받는 쪽 */
function fakeSource(fail?: unknown): PackageSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    index: async (repo) => ({ repo, index: repo === REPO ? index : null, ignored: [] }) as RepoIndexResult,
    fetch: async (id, entry) => {
      calls.push(`${id}@${entry.version}`);
      if (fail) throw fail;
      return new Map(Object.keys(entry.sha256).map((p) => [p, enc(raw[`${PREFIX}packages/${id.slice(1)}/${entry.version}/${p}`]!)]));
    },
  };
}

function setup(opts: { packages?: Record<string, unknown>; source?: PackageSource | null; appVersion?: string; repos?: string[] } = {}) {
  let settings: MarketplaceSettings | null = parseMarketplace({ repos: opts.repos ?? [REPO], packages: opts.packages ?? {} });
  const listeners = new Set<() => void>();
  const writes: [string, LockEntry | null][] = [];
  const cache = memoryPackageCache();
  const source = opts.source === undefined ? fakeSource() : opts.source;
  const state = createMarketState({
    source: () => source,
    cache,
    settings: () => settings,
    onSettings: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    writeLock: async (id, entry) => {
      writes.push([id, entry]);
      const packages = { ...settings!.packages } as Record<string, unknown>;
      if (entry) packages[id] = entry;
      else delete packages[id];
      settings = parseMarketplace({ repos: settings!.repos, packages });
    },
    appVersion: opts.appVersion ?? "0.12.0",
  });
  const setSettings = (s: MarketplaceSettings | null) => {
    settings = s;
    for (const l of listeners) l();
  };
  return {
    state,
    cache,
    source,
    writes,
    setSettings,
    get settings() {
      return settings;
    },
  };
}

const ids = (l: InstalledPackage[]) => l.map((p) => `${p.id}@${p.version}:${p.status}`);

describe("맞추기", () => {
  it("잠금의 둘을 받아 ready, 적용 자리에 종류별로, 다시 맞추면 받지 않는다", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0"), "@me/sea": lockOf("@me/sea", "0.1.0") } });
    const widgets = vi.fn();
    const themes = vi.fn();
    t.state.registerPackageKind("widget", { apply: widgets });
    t.state.registerPackageKind("theme", { apply: themes });
    await t.state.reconcile();
    expect(ids(t.state.installedPackages())).toEqual(["@me/clock@1.0.0:ready", "@me/sea@0.1.0:ready"]);
    expect(widgets).toHaveBeenLastCalledWith([expect.objectContaining({ id: "@me/clock", status: "ready" })]);
    expect(themes).toHaveBeenLastCalledWith([expect.objectContaining({ id: "@me/sea" })]);
    expect(t.state.installedPackages()[0]!.manifest?.name.en).toBe("Clock");
    const n = (t.source as ReturnType<typeof fakeSource>).calls.length;
    await t.state.reconcile();
    expect((t.source as ReturnType<typeof fakeSource>).calls.length).toBe(n);
  });

  it("설정 화면을 거치지 않은 잠금 변경(동기화로 온 새 판): 새 판을 받고 옛 판을 지우고 다시 알린다", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0") } });
    const widgets = vi.fn();
    t.state.registerPackageKind("widget", { apply: widgets });
    await t.state.reconcile();
    const changed = new Promise<void>((r) => t.state.onPackagesChange(() => r()));
    t.setSettings(parseMarketplace({ repos: [REPO], packages: { "@me/clock": lockOf("@me/clock", "1.1.0") } }));
    await changed;
    await t.state.reconcile();
    expect(ids(t.state.installedPackages())).toEqual(["@me/clock@1.1.0:ready"]);
    expect((await t.cache.list()).map((c) => c.version)).toEqual(["1.1.0"]);
    expect(widgets).toHaveBeenLastCalledWith([expect.objectContaining({ version: "1.1.0" })]);
    t.setSettings(parseMarketplace({ repos: [REPO], packages: {} }));
    await t.state.reconcile();
    expect(await t.cache.list()).toEqual([]);
    expect(widgets).toHaveBeenLastCalledWith([]);
  });

  it("오프라인: 캐시에 있는 것은 ready, 없는 것은 error, 캐시를 지우지 않는다. 설정을 읽지 못하면 아무것도 지우지 않는다", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0") } });
    await t.state.reconcile();
    const offline = setup({
      packages: { "@me/clock": lockOf("@me/clock", "1.0.0"), "@me/sea": lockOf("@me/sea", "0.1.0") },
      source: fakeSource(new TypeError("Failed to fetch")),
    });
    const files = new Map(Object.keys(lockOf("@me/clock", "1.0.0").sha256).map((p) => [p, enc(raw[`${PREFIX}packages/me/clock/1.0.0/${p}`]!)]));
    await offline.cache.put("@me/clock", "1.0.0", lockOf("@me/clock", "1.0.0"), files);
    await offline.state.reconcile();
    expect(ids(offline.state.installedPackages())).toEqual(["@me/clock@1.0.0:ready", "@me/sea@0.1.0:error"]);
    expect(offline.state.installedPackages()[1]!.error?.code).toBe("market_fetch_failed");
    offline.setSettings(null);
    await offline.state.reconcile();
    expect((await offline.cache.list()).map((c) => c.id)).toEqual(["@me/clock"]);
  });

  it("받는 쪽이 없으면(브라우저 기기 볼트, 동기화 없음) unavailable — 캐시에 있는 것만 쓴다", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0"), "@me/sea": lockOf("@me/sea", "0.1.0") }, source: null });
    const files = new Map(Object.keys(lockOf("@me/clock", "1.0.0").sha256).map((p) => [p, enc(raw[`${PREFIX}packages/me/clock/1.0.0/${p}`]!)]));
    await t.cache.put("@me/clock", "1.0.0", lockOf("@me/clock", "1.0.0"), files);
    expect(t.state.marketAvailability()).toBe("unavailable");
    await t.state.reconcile();
    expect(ids(t.state.installedPackages())).toEqual(["@me/clock@1.0.0:ready", "@me/sea@0.1.0:error"]);
    expect(t.state.installedPackages()[1]!.error?.code).toBe("market_unavailable");
    await expect(t.state.installPackage("@me/sea")).rejects.toMatchObject({ code: "market_unavailable" });
  });

  it("engines 가 맞지 않으면 받아 두되 incompatible, 적용 자리에 넘기지 않고 잠금은 그대로", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0") }, appVersion: "0.0.1" });
    const widgets = vi.fn();
    t.state.registerPackageKind("widget", { apply: widgets });
    await t.state.reconcile();
    expect(ids(t.state.installedPackages())).toEqual(["@me/clock@1.0.0:incompatible"]);
    expect(widgets).toHaveBeenLastCalledWith([]);
    expect(t.writes).toEqual([]);
    expect(await t.cache.list()).toHaveLength(1);
  });

  it("잘못된 잠금 항목은 market_lock_invalid, 받지도 지우지도 않는다", async () => {
    const t = setup({ packages: { "@me/bad": { ...lockOf("@me/clock", "1.0.0"), version: "../../x" } } });
    await t.state.reconcile();
    expect(t.state.installedPackages()).toEqual([
      expect.objectContaining({ id: "@me/bad", status: "error", error: { code: "market_lock_invalid", params: { id: "@me/bad" } } }),
    ]);
    expect((t.source as ReturnType<typeof fakeSource>).calls).toEqual([]);
  });

  it("개인 저장소의 @keyring/… 잠금 항목은 그 판이 캐시에 있어도 market_scope_reserved, 적용자에 넘기지 않는다", async () => {
    const t = setup({ packages: { "@keyring/hello": lockOf("@keyring/hello", "1.0.0") } });
    const entry = lockOf("@keyring/hello", "1.0.0");
    const files = new Map(Object.keys(entry.sha256).map((p) => [p, enc(raw[`${PREFIX}packages/keyring/hello/1.0.0/${p}`]!)]));
    await t.cache.put("@keyring/hello", "1.0.0", entry, files);
    const widgets = vi.fn();
    t.state.registerPackageKind("widget", { apply: widgets });
    await t.state.reconcile();
    expect(t.state.installedPackages()).toEqual([
      expect.objectContaining({ id: "@keyring/hello", status: "error", error: { code: "market_scope_reserved", params: { id: "@keyring/hello" } } }),
    ]);
    expect(widgets).toHaveBeenLastCalledWith([]);
    expect((t.source as ReturnType<typeof fakeSource>).calls).toEqual([]);
  });
});

describe("설치·제거·파일", () => {
  it("installPackage: 받기 → 캐시 → 잠금 쓰기 순서, 받지 못하면 잠금을 쓰지 않는다", async () => {
    const t = setup();
    const p = await t.state.installPackage("@me/clock");
    expect(p).toMatchObject({ id: "@me/clock", version: "1.1.0", status: "ready", type: "widget" });
    expect(t.writes).toEqual([["@me/clock", lockOf("@me/clock", "1.1.0")]]);
    const failing = setup({ source: fakeSource(new KeyedError("market_hash_mismatch", { path: "frame.js" })) });
    await expect(failing.state.installPackage("@me/clock")).rejects.toMatchObject({ code: "market_hash_mismatch" });
    expect(failing.writes).toEqual([]);
    await expect(t.state.installPackage("@me/none")).rejects.toMatchObject({ code: "market_not_found" });
    await expect(t.state.installPackage("@keyring/hello", { repo: REPO })).rejects.toMatchObject({ code: "market_scope_reserved" });
  });

  it("uninstallPackage: 잠금에서 뺀 뒤 캐시에서 지운다", async () => {
    const t = setup();
    await t.state.installPackage("@me/sea");
    await t.state.uninstallPackage("@me/sea");
    expect(t.writes.at(-1)).toEqual(["@me/sea", null]);
    expect(await t.cache.list()).toEqual([]);
    expect(t.state.installedPackages()).toEqual([]);
  });

  it("readPackageFile: 잠금의 sha 로 다시 재고, 상했으면 던지고 다시 받게 한다", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0") } });
    await t.state.reconcile();
    expect(await t.state.readPackageText("@me/clock", "messages/ko.json")).toContain("시계");
    const e = lockOf("@me/clock", "1.0.0");
    await t.cache.put(
      "@me/clock",
      "1.0.0",
      e,
      new Map([
        ["keyring-package.json", enc("x")],
        ["frame.js", enc("tampered")],
        ["messages/ko.json", enc("{}")],
      ]),
    );
    await expect(t.state.readPackageFile("@me/clock", "frame.js")).rejects.toMatchObject({ code: "market_hash_mismatch" });
    expect(t.state.installedPackages()[0]!.status).toBe("error");
    await t.state.reconcile();
    expect(t.state.installedPackages()[0]!.status).toBe("ready");
    expect((await t.state.readPackageFile("@me/clock", "frame.js")).byteLength).toBeGreaterThan(0);
    await expect(t.state.readPackageFile("@me/none", "frame.js")).rejects.toBeInstanceOf(KeyedError);
  });

  it("readPackageFileAt: 붙잡은 잠금 항목과 지금 잠금이 판·repo·sha 모두 같을 때만, 아니면 market_stale", async () => {
    const t = setup({ packages: { "@me/clock": lockOf("@me/clock", "1.0.0") } });
    await t.state.reconcile();
    const held = t.state.lockEntry("@me/clock")!;
    expect(held).toEqual(lockOf("@me/clock", "1.0.0"));
    expect(await t.state.readPackageTextAt("@me/clock", held, "frame.js")).toContain("keyringWidgetRegister");
    // 같은 판인데 sha 만 다른 항목(손으로 고침·다른 저장소)
    const otherSha = { ...held, sha256: { ...held.sha256, "frame.js": "0".repeat(64) } };
    await expect(t.state.readPackageFileAt("@me/clock", otherSha, "frame.js")).rejects.toMatchObject({ code: "market_stale" });
    await expect(t.state.readPackageFileAt("@me/clock", { ...held, repo: "https://other.test/" }, "frame.js")).rejects.toMatchObject({
      code: "market_stale",
    });
    // 잠금이 다른 판으로 바뀐 뒤 옛 항목으로
    t.setSettings(parseMarketplace({ repos: [REPO], packages: { "@me/clock": lockOf("@me/clock", "1.1.0") } }));
    await t.state.reconcile();
    await expect(t.state.readPackageFileAt("@me/clock", held, "frame.js")).rejects.toMatchObject({ code: "market_stale", params: { id: "@me/clock" } });
    expect(t.state.lockEntry("@me/clock")!.version).toBe("1.1.0");
    expect(t.state.lockEntry("@me/none")).toBeNull();
  });

  it("repoIndexes 는 저장소 순서대로", async () => {
    const t = setup({ repos: [OFFICIAL_REPO_URL, REPO] });
    expect((await t.state.repoIndexes()).map((r) => r.repo)).toEqual([OFFICIAL_REPO_URL, REPO]);
  });

  it("repoIndexes({ fresh }) 는 받는 쪽에 fresh 를 넘긴다", async () => {
    const seen: (boolean | undefined)[] = [];
    const src = fakeSource();
    const t = setup({ source: { ...src, index: (repo, opts) => (seen.push(opts?.fresh), src.index(repo)) } });
    await t.state.repoIndexes();
    await t.state.repoIndexes({ fresh: true });
    expect(seen).toEqual([undefined, true]);
  });
});

describe("ready", () => {
  it("설정을 못 읽은 동안 거짓, 첫 맞추기 뒤 참(받지 못한 것이 있어도)", async () => {
    const t = setup({ packages: { "@me/sea": lockOf("@me/sea", "0.1.0") }, source: fakeSource(new Error("down")) });
    const s = t.settings;
    t.setSettings(null);
    await t.state.reconcile();
    expect(t.state.ready()).toBe(false);
    t.setSettings(s);
    await t.state.reconcile();
    expect(ids(t.state.installedPackages())).toEqual(["@me/sea@0.1.0:error"]);
    expect(t.state.ready()).toBe(true);
    // 한 번 참이면 계속 참
    t.setSettings(null);
    await t.state.reconcile();
    expect(t.state.ready()).toBe(true);
  });

  it("첫 맞추기의 notify 가 부른 적용자는 이미 ready() 가 참이다", async () => {
    const t = setup({ packages: { "@me/sea": lockOf("@me/sea", "0.1.0") } });
    const seen: [boolean, string[]][] = [];
    t.state.registerPackageKind("theme", { apply: (pkgs) => void seen.push([t.state.ready(), pkgs.map((p) => p.id)]) });
    await t.state.reconcile();
    expect(seen[0]).toEqual([false, []]);
    expect(seen.find(([, l]) => l.includes("@me/sea"))).toEqual([true, ["@me/sea"]]);
  });
});
